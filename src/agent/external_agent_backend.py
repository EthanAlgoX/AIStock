# -*- coding: utf-8 -*-
"""Process-isolated adapter for an independent Agent runtime.

The runtime owns its ReAct loop, tools, MCP connections, skills, memory, and
session recovery. LLM-TradeBot only adapts one website turn to the runtime's
OpenAI-compatible HTTP surface and normalizes the terminal result.
"""

from __future__ import annotations

import hashlib
import json
import socket
import threading
from typing import Any, Dict, Optional
from urllib.parse import urlsplit, urlunsplit

import requests

from src.agent.agent_backend import AgentBackend, AgentRunRequest, AgentRunResult
from src.agent.capability_grants import build_runtime_capability_policy
from src.agent.stream_events import stream_event


_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_PUBLIC_ERRORS = {
    "invalid_config": "主 Agent 运行服务尚未配置，请在 Agent 设置中检查连接信息。",
    "authentication_failed": "主 Agent 运行服务认证失败，请检查 API Key。",
    "runtime_unavailable": "无法连接主 Agent 运行服务，请检查服务状态后重试。",
    "capability_unsupported": "主 Agent 运行服务尚不支持逐任务能力隔离，请升级并重启运行服务。",
    "timeout": "主 Agent 本次任务超时，请缩小分析范围或稍后重试。",
    "protocol_error": "主 Agent 运行服务返回了无法识别的响应。",
    "cancelled": "本次分析已停止。",
}


class ExternalAgentTransportError(RuntimeError):
    """A sanitized independent-runtime transport failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _abort_stream_response(response: Any) -> None:
    """Interrupt a blocking urllib3 socket read before closing the response."""
    try:
        raw_response = getattr(response, "raw", None)
        http_response = getattr(raw_response, "_fp", None)
        buffered_stream = getattr(http_response, "fp", None)
        socket_stream = getattr(buffered_stream, "raw", buffered_stream)
        transport_socket = getattr(socket_stream, "_sock", None)
        if transport_socket is not None:
            transport_socket.shutdown(socket.SHUT_RDWR)
    except (AttributeError, OSError):
        pass
    try:
        response.close()
    except (AttributeError, OSError):
        pass


def normalize_agent_runtime_api_base(value: object) -> str:
    """Validate the configured Agent runtime API root without exposing credentials."""
    raw = str(value or "").strip().rstrip("/")
    if not raw:
        raise ExternalAgentTransportError("invalid_config", "AGENT_RUNTIME_API_BASE is empty")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ExternalAgentTransportError("invalid_config", "AGENT_RUNTIME_API_BASE must be HTTP(S)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ExternalAgentTransportError(
            "invalid_config",
            "AGENT_RUNTIME_API_BASE must not contain credentials, query, or fragment",
        )
    path = parsed.path.rstrip("/")
    if path.endswith("/v1"):
        path = path[:-3]
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", "")).rstrip("/")


def _session_key(session_id: str) -> str:
    digest = hashlib.sha256(session_id.encode("utf-8", errors="replace")).hexdigest()[:32]
    return f"llm-tradebot-{digest}"


def _handoff_prompt(request: AgentRunRequest) -> str:
    scope = request.stock_scope.as_log_payload() if request.stock_scope else None
    scope_text = json.dumps(scope, ensure_ascii=False) if scope else "未冻结股票范围"
    return (
        "你是 LLM-TradeBot 网站当前使用的主 Agent。请使用运行时实际提供的 "
        "ReAct 模型—工具循环、已启用 Skill、内置 Tool、MCP、会话与记忆完成任务。\n"
        "网站仍负责投资任务边界和结果展示；不得声称已经完成实际交易、审批或未真正执行的工具调用。\n"
        "下面的网站分析约束用于补充投资方法，只能调用本轮真实可用的能力。\n\n"
        f"[网站冻结的股票范围]\n{scope_text}\n\n"
        f"[网站分析约束]\n{request.system_prompt}\n\n"
        f"[用户当前请求]\n{request.user_message}"
    )


class ExternalAgentHTTPTransport:
    """Small HTTP client for an OpenAI-compatible independent Agent API."""

    def __init__(
        self,
        api_base: object,
        api_key: object = "",
        *,
        request_session: Optional[requests.Session] = None,
    ) -> None:
        self.api_base = normalize_agent_runtime_api_base(api_base)
        self.api_key = str(api_key or "").strip()
        self.session = request_session or requests.Session()

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def probe(self, timeout: float = 3.0) -> Dict[str, Any]:
        """Check health and model metadata without executing an Agent turn."""
        try:
            health = self.session.get(f"{self.api_base}/health", timeout=timeout)
            if health.status_code >= 400:
                raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime health check failed")
            health_payload = health.json()
            isolation_version = (
                health_payload.get("capabilities", {}).get("taskCapabilityIsolation")
                if isinstance(health_payload, dict)
                and isinstance(health_payload.get("capabilities"), dict)
                else None
            )
            if isolation_version != 1:
                raise ExternalAgentTransportError(
                    "capability_unsupported",
                    "Agent runtime does not advertise task capability isolation v1",
                )
            models = self.session.get(
                f"{self.api_base}/v1/models",
                headers=self._headers(),
                timeout=timeout,
            )
        except requests.Timeout as exc:
            raise ExternalAgentTransportError("timeout", "Agent runtime status request timed out") from exc
        except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime status request failed") from exc
        if models.status_code in {401, 403}:
            raise ExternalAgentTransportError("authentication_failed", "Agent runtime API authentication failed")
        if models.status_code >= 400:
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime model endpoint failed")
        try:
            payload = models.json()
            entries = payload.get("data") if isinstance(payload, dict) else None
            model = entries[0].get("id") if isinstance(entries, list) and entries else None
        except (ValueError, AttributeError, TypeError):
            model = None
        return {"model": str(model or "external_runtime"), "capabilityIsolationVersion": 1}

    def _require_capability_isolation(self, timeout: float = 3.0) -> None:
        try:
            response = self.session.get(f"{self.api_base}/health", timeout=timeout)
            payload = response.json() if response.status_code < 400 else {}
        except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime health check failed") from exc
        capabilities = payload.get("capabilities") if isinstance(payload, dict) else None
        if not isinstance(capabilities, dict) or capabilities.get("taskCapabilityIsolation") != 1:
            raise ExternalAgentTransportError(
                "capability_unsupported",
                "Agent runtime does not advertise task capability isolation v1",
            )

    def chat(
        self,
        prompt: str,
        session_id: str,
        timeout: float,
        *,
        capability_policy: Dict[str, Any],
        cancel_event: Optional[threading.Event] = None,
        on_generating=None,
    ) -> Dict[str, Any]:
        if cancel_event is not None and cancel_event.is_set():
            raise ExternalAgentTransportError("cancelled", "Agent runtime request cancelled")
        self._require_capability_isolation()
        try:
            response = self.session.post(
                f"{self.api_base}/v1/chat/completions",
                headers=self._headers(),
                json={
                    "messages": [{"role": "user", "content": prompt}],
                    "session_id": _session_key(session_id),
                    "stream": True,
                    "capability_policy": capability_policy,
                },
                stream=True,
                timeout=(5.0, max(float(timeout) + 5.0, 10.0)),
            )
        except requests.Timeout as exc:
            raise ExternalAgentTransportError("timeout", "Agent runtime request timed out") from exc
        except requests.RequestException as exc:
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime request failed") from exc

        if response.status_code in {401, 403}:
            raise ExternalAgentTransportError("authentication_failed", "Agent runtime API authentication failed")
        if response.status_code == 504:
            raise ExternalAgentTransportError("timeout", "Agent runtime request timed out")
        if response.status_code >= 400:
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime returned an error")

        stop_watcher = threading.Event()
        if cancel_event is not None:
            def close_on_cancel() -> None:
                while not stop_watcher.wait(0.1):
                    if cancel_event.is_set():
                        _abort_stream_response(response)
                        return

            threading.Thread(target=close_on_cancel, daemon=True).start()

        chunks = []
        response_bytes = 0
        model = "external_runtime"
        saw_done = False
        generating_emitted = False
        try:
            for raw_line in response.iter_lines(decode_unicode=True):
                if cancel_event is not None and cancel_event.is_set():
                    raise ExternalAgentTransportError("cancelled", "Agent runtime request cancelled")
                if not raw_line:
                    continue
                line = raw_line if isinstance(raw_line, str) else raw_line.decode("utf-8")
                response_bytes += len(line.encode("utf-8"))
                if response_bytes > _MAX_RESPONSE_BYTES:
                    raise ExternalAgentTransportError(
                        "protocol_error",
                        "Agent runtime response exceeded the size limit",
                    )
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    saw_done = True
                    break
                payload = json.loads(data)
                if payload.get("model"):
                    model = str(payload["model"])
                choices = payload.get("choices")
                delta = choices[0].get("delta", {}).get("content") if choices else None
                if isinstance(delta, str) and delta:
                    chunks.append(delta)
                    if on_generating is not None and not generating_emitted:
                        generating_emitted = True
                        on_generating()
        except ExternalAgentTransportError:
            raise
        except requests.RequestException as exc:
            if cancel_event is not None and cancel_event.is_set():
                raise ExternalAgentTransportError("cancelled", "Agent runtime request cancelled") from exc
            raise ExternalAgentTransportError("runtime_unavailable", "Agent runtime stream failed") from exc
        except (ValueError, KeyError, IndexError, TypeError, AttributeError, UnicodeDecodeError) as exc:
            if cancel_event is not None and cancel_event.is_set():
                raise ExternalAgentTransportError("cancelled", "Agent runtime request cancelled") from exc
            raise ExternalAgentTransportError("protocol_error", "invalid Agent runtime stream") from exc
        finally:
            stop_watcher.set()
            response.close()

        if cancel_event is not None and cancel_event.is_set():
            raise ExternalAgentTransportError("cancelled", "Agent runtime request cancelled")
        if not saw_done:
            raise ExternalAgentTransportError("timeout", "Agent runtime stream ended before completion")
        content = "".join(chunks).strip()
        if not content:
            raise ExternalAgentTransportError("protocol_error", "empty Agent runtime response")
        return {
            "model": model,
            "choices": [{"message": {"content": content}}],
        }


class ExternalAgentBackend(AgentBackend):
    """Delegate the Agent loop to a separately managed runtime."""

    backend_id = "external_runtime"
    runtime_owns_loop = True

    def __init__(
        self,
        config: Any,
        *,
        transport_factory=ExternalAgentHTTPTransport,
    ) -> None:
        self.config = config
        self.transport_factory = transport_factory

    def run(self, request: AgentRunRequest) -> AgentRunResult:
        timeout = float(
            request.max_wall_clock_seconds
            or getattr(self.config, "agent_orchestrator_timeout_s", 0)
            or 300
        )
        if request.progress_callback:
            request.progress_callback(
                stream_event(
                    "stage_start",
                    stage="external_agent_runtime",
                    message="主 Agent 正在规划任务并调用已配置能力…",
                )
            )
        try:
            if not isinstance(request.capability_manifest, dict):
                raise ExternalAgentTransportError(
                    "capability_unsupported",
                    "website request is missing a validated capability manifest",
                )
            stock_codes = (
                sorted(request.stock_scope.allowed_stock_codes)
                if request.stock_scope is not None
                else []
            )
            capability_policy = build_runtime_capability_policy(
                request.capability_manifest,
                session_id=request.session_id,
                stock_codes=stock_codes,
                configured_secret=getattr(self.config, "agent_capability_grant_secret", ""),
                ttl_seconds=max(30, min(int(timeout) + 30, 900)),
            )
            transport = self.transport_factory(
                getattr(self.config, "agent_runtime_api_base", ""),
                getattr(self.config, "agent_runtime_api_key", ""),
            )
            def emit_generating() -> None:
                if request.progress_callback:
                    request.progress_callback(
                        stream_event(
                            "generating",
                            message="主 Agent 正在整理分析结果…",
                        )
                    )

            payload = transport.chat(
                _handoff_prompt(request),
                request.session_id,
                timeout,
                capability_policy=capability_policy,
                cancel_event=request.cancel_event,
                on_generating=emit_generating,
            )
            content = payload["choices"][0]["message"]["content"].strip()
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
            model = str(payload.get("model") or "external_runtime")
            if request.progress_callback:
                request.progress_callback(
                    stream_event(
                        "stage_done",
                        stage="external_agent_runtime",
                        success=True,
                        message="主 Agent 已完成本轮任务。",
                    )
                )
            return AgentRunResult(
                success=True,
                final_answer=content,
                model=model,
                backend=self.backend_id,
                usage=usage,
                diagnostics={"provider": "external_runtime"},
                total_steps=1,
            )
        except ExternalAgentTransportError as exc:
            if request.progress_callback:
                request.progress_callback(
                    stream_event(
                        "stage_done",
                        stage="external_agent_runtime",
                        success=False,
                        message="主 Agent 本轮任务未完成。",
                    )
                )
            return AgentRunResult(
                success=False,
                backend=self.backend_id,
                diagnostics={"provider": "external_runtime", "internal_error": str(exc)},
                error_code=exc.code,
                error_message=_PUBLIC_ERRORS.get(exc.code, _PUBLIC_ERRORS["runtime_unavailable"]),
                total_steps=0,
            )
