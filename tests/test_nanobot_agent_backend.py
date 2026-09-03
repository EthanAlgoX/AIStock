# -*- coding: utf-8 -*-
"""Nanobot sidecar adapter contract tests."""

from __future__ import annotations

import json
import socket
import threading
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.agent.agent_backend import AgentRunRequest
from src.agent.chat_executor import AgentChatExecutor
from src.agent.nanobot_agent_backend import (
    NanobotAgentBackend,
    NanobotHTTPTransport,
    NanobotTransportError,
    normalize_nanobot_api_base,
)
from src.agent.stock_scope import StockScope


def _request(**overrides) -> AgentRunRequest:
    values = {
        "system_prompt": "只依据真实证据回答。",
        "history_messages": [],
        "user_message": "分析 600519",
        "session_id": "session-1",
        "stock_scope": StockScope(
            expected_stock_code="600519.SH",
            allowed_stock_codes={"600519.SH"},
            mode="maintain",
        ),
        "max_steps": 8,
        "max_wall_clock_seconds": 30,
        "progress_callback": None,
        "cancel_event": None,
        "capability_manifest": {
            "skillIds": ["bull_trend"],
            "dataSources": [{"id": "system_market_data"}],
            "runtimePolicy": {
                "gatewayToolIds": ["get_realtime_quote"],
                "nanobotToolIds": ["mcp_finance_get_realtime_quote"],
            },
        },
    }
    values.update(overrides)
    return AgentRunRequest(**values)


def test_normalize_nanobot_api_base_accepts_root_or_v1() -> None:
    assert normalize_nanobot_api_base("http://127.0.0.1:8900/") == "http://127.0.0.1:8900"
    assert normalize_nanobot_api_base("https://agent.example/v1") == "https://agent.example"


@pytest.mark.parametrize(
    "value",
    ["", "ftp://agent.example", "https://user:secret@agent.example", "https://agent.example?q=1"],
)
def test_normalize_nanobot_api_base_rejects_unsafe_or_invalid_values(value: str) -> None:
    with pytest.raises(NanobotTransportError) as exc_info:
        normalize_nanobot_api_base(value)
    assert exc_info.value.code == "invalid_config"


def test_http_transport_uses_official_api_and_isolates_site_session_id() -> None:
    calls = []

    class FakeResponse:
        status_code = 200
        content = b'{"ok":true}'

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

        def iter_lines(self, decode_unicode=False):
            del decode_unicode
            if "choices" not in self.payload:
                return iter(())
            model = self.payload["model"]
            content = self.payload["choices"][0]["message"]["content"]
            lines = [
                f'data: {json.dumps({"model": model, "choices": [{"delta": {"content": content}}]})}',
                "data: [DONE]",
            ]
            return iter(lines)

        def close(self):
            return None

    class FakeSession:
        def get(self, url, **kwargs):
            calls.append(("get", url, kwargs))
            if url.endswith("/health"):
                return FakeResponse({
                    "status": "ok",
                    "capabilities": {"taskCapabilityIsolation": 1},
                })
            return FakeResponse({"data": [{"id": "nanobot-agent"}]})

        def post(self, url, **kwargs):
            calls.append(("post", url, kwargs))
            return FakeResponse(
                {
                    "model": "nanobot-agent",
                    "choices": [{"message": {"content": "answer"}}],
                }
            )

    transport = NanobotHTTPTransport(
        "http://127.0.0.1:8900/v1",
        "api-key",
        request_session=FakeSession(),
    )

    assert transport.probe() == {
        "model": "nanobot-agent",
        "capabilityIsolationVersion": 1,
    }
    assert transport.chat(
        "prompt",
        "visible-session-id",
        30,
        capability_policy={"version": 1},
    )["model"] == "nanobot-agent"
    post_call = next(call for call in calls if call[0] == "post")
    assert post_call[1] == "http://127.0.0.1:8900/v1/chat/completions"
    assert post_call[2]["headers"]["Authorization"] == "Bearer api-key"
    body = post_call[2]["json"]
    assert body["messages"] == [{"role": "user", "content": "prompt"}]
    assert body["stream"] is True
    assert body["capability_policy"] == {"version": 1}
    assert post_call[2]["stream"] is True
    assert body["session_id"].startswith("llm-tradebot-")
    assert body["session_id"] != "visible-session-id"


def test_nanobot_backend_delegates_loop_and_preserves_site_contract() -> None:
    calls = []
    events = []

    class FakeTransport:
        def __init__(self, api_base, api_key):
            calls.append((api_base, api_key))

        def chat(
            self,
            prompt,
            session_id,
            timeout,
            *,
            capability_policy,
            cancel_event=None,
            on_generating=None,
        ):
            calls.append((prompt, session_id, timeout, capability_policy))
            assert cancel_event is None
            on_generating()
            return {
                "model": "nanobot-model",
                "choices": [{"message": {"content": "结构化研究结论"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
            }

    backend = NanobotAgentBackend(
        SimpleNamespace(
            nanobot_api_base="http://nanobot.internal",
            nanobot_api_key="secret",
            agent_orchestrator_timeout_s=60,
        ),
        transport_factory=FakeTransport,
    )
    result = backend.run(_request(progress_callback=events.append))

    assert result.success is True
    assert result.backend == "nanobot"
    assert result.final_answer == "结构化研究结论"
    assert result.usage["total_tokens"] == 20
    assert calls[0] == ("http://nanobot.internal", "secret")
    prompt, session_id, timeout, capability_policy = calls[1]
    assert "ReAct 模型—工具循环" in prompt
    assert "600519.SH" in prompt
    assert "分析 600519" in prompt
    assert session_id == "session-1"
    assert timeout == 30
    assert capability_policy["allowed_tools"] == ["mcp_finance_get_realtime_quote"]
    assert capability_policy["allowed_skills"] == ["bull_trend"]
    assert capability_policy["gateway_grant"]
    assert [event["type"] for event in events] == ["stage_start", "generating", "stage_done"]
    assert all("Nanobot" not in event.get("message", "") for event in events)


def test_nanobot_backend_maps_transport_failure_without_secret_disclosure() -> None:
    class BrokenTransport:
        def __init__(self, *_args):
            pass

        def chat(self, *_args, **_kwargs):
            raise NanobotTransportError("authentication_failed", "internal secret detail")

    backend = NanobotAgentBackend(
        SimpleNamespace(nanobot_api_base="http://nanobot.internal", nanobot_api_key="secret"),
        transport_factory=BrokenTransport,
    )
    result = backend.run(_request())

    assert result.success is False
    assert result.error_code == "authentication_failed"
    assert "API Key" in result.error_message
    assert "internal secret detail" not in result.error_message


def test_nanobot_backend_fails_closed_without_capability_manifest() -> None:
    backend = NanobotAgentBackend(
        SimpleNamespace(nanobot_api_base="http://nanobot.internal", nanobot_api_key=""),
        transport_factory=lambda *_args: (_ for _ in ()).throw(
            AssertionError("transport must not be created")
        ),
    )

    result = backend.run(_request(capability_manifest=None))

    assert result.success is False
    assert result.error_code == "capability_unsupported"
    assert "能力隔离" in result.error_message


def test_nanobot_probe_rejects_runtime_without_capability_isolation() -> None:
    response = SimpleNamespace(
        status_code=200,
        json=lambda: {"status": "ok"},
    )
    transport = NanobotHTTPTransport(
        "http://127.0.0.1:8900",
        request_session=SimpleNamespace(get=lambda *_args, **_kwargs: response),
    )

    with pytest.raises(NanobotTransportError) as exc_info:
        transport.probe()

    assert exc_info.value.code == "capability_unsupported"


def test_nanobot_transport_honors_cancellation_before_request() -> None:
    cancel_event = threading.Event()
    cancel_event.set()
    transport = NanobotHTTPTransport(
        "http://127.0.0.1:8900",
        request_session=SimpleNamespace(),
    )

    with pytest.raises(NanobotTransportError) as exc_info:
        transport.chat("prompt", "session", 30, capability_policy={}, cancel_event=cancel_event)

    assert exc_info.value.code == "cancelled"


def test_nanobot_transport_maps_interrupted_stream_to_cancelled() -> None:
    cancel_event = threading.Event()

    class InterruptedResponse:
        status_code = 200

        def iter_lines(self, decode_unicode=False):
            del decode_unicode
            cancel_event.set()
            yield "data: {"

        def close(self):
            return None

    transport = NanobotHTTPTransport(
        "http://127.0.0.1:8900",
        request_session=SimpleNamespace(
            get=lambda *_args, **_kwargs: SimpleNamespace(
                status_code=200,
                json=lambda: {"status": "ok", "capabilities": {"taskCapabilityIsolation": 1}},
            ),
            post=lambda *_args, **_kwargs: InterruptedResponse(),
        ),
    )

    with pytest.raises(NanobotTransportError) as exc_info:
        transport.chat("prompt", "session", 30, capability_policy={}, cancel_event=cancel_event)

    assert exc_info.value.code == "cancelled"


def test_nanobot_transport_interrupts_blocking_socket_on_cancellation() -> None:
    cancel_event = threading.Event()
    socket_released = threading.Event()
    outcome = []

    class FakeSocket:
        def shutdown(self, how):
            assert how == socket.SHUT_RDWR
            socket_released.set()

    class BlockingResponse:
        status_code = 200
        raw = SimpleNamespace(
            _fp=SimpleNamespace(
                fp=SimpleNamespace(raw=SimpleNamespace(_sock=FakeSocket())),
            ),
        )

        def iter_lines(self, decode_unicode=False):
            del decode_unicode
            socket_released.wait(2)
            return iter(())

        def close(self):
            socket_released.set()

    transport = NanobotHTTPTransport(
        "http://127.0.0.1:8900",
        request_session=SimpleNamespace(
            get=lambda *_args, **_kwargs: SimpleNamespace(
                status_code=200,
                json=lambda: {"status": "ok", "capabilities": {"taskCapabilityIsolation": 1}},
            ),
            post=lambda *_args, **_kwargs: BlockingResponse(),
        ),
    )

    def run_chat() -> None:
        try:
            transport.chat("prompt", "session", 30, capability_policy={}, cancel_event=cancel_event)
        except NanobotTransportError as exc:
            outcome.append(exc.code)

    worker = threading.Thread(target=run_chat)
    worker.start()
    cancel_event.set()
    worker.join(3)

    assert worker.is_alive() is False
    assert socket_released.is_set()
    assert outcome == ["cancelled"]


def test_nanobot_preparation_uses_runtime_capabilities_instead_of_dsa_tool_contract() -> None:
    backend = NanobotAgentBackend(
        SimpleNamespace(nanobot_api_base="http://nanobot.internal", nanobot_api_key=""),
    )
    executor = AgentChatExecutor(
        backend=backend,
        config=SimpleNamespace(report_language="zh"),
        context_llm_adapter=object(),
        skill_instructions="用趋势结构判断，不编造证据。",
    )

    with patch("src.agent.executor.build_visible_chat_history", return_value=[]), patch(
        "src.agent.chat_executor.conversation_manager.get_or_create"
    ), patch(
        "src.agent.chat_executor.conversation_manager.add_user_message",
        return_value=1,
    ):
        turn = executor.prepare_turn(
            message="分析 AAPL",
            session_id="runtime-prompt",
            context={"stock_code": "AAPL", "report_language": "zh"},
        )

    prompt = turn.prepared.system_prompt
    assert "只调用当前真实可用的能力" in prompt
    assert "用趋势结构判断" in prompt
    assert "必须严格按阶段" not in prompt
    assert "get_realtime_quote" not in prompt
