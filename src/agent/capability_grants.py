# -*- coding: utf-8 -*-
"""Short-lived, signed capability grants for an external Agent runtime."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, Iterable, Mapping


CAPABILITY_ISOLATION_VERSION = 1
FINANCIAL_MCP_SERVER_NAME = "finance"
GRANT_ARGUMENT_NAME = "__llm_tradebot_grant"
_MAX_GRANT_SECONDS = 15 * 60
_EPHEMERAL_SECRET = secrets.token_bytes(32)
_SANITIZE_RE = re.compile(r"_+")


class CapabilityGrantError(ValueError):
    """Raised when a runtime capability grant is missing, invalid, or expired."""


@dataclass(frozen=True)
class CapabilityGrantClaims:
    policy_id: str
    gateway_tool_ids: frozenset[str]
    data_source_ids: frozenset[str]
    stock_codes: frozenset[str]
    expires_at: int


def _secret_bytes(configured_secret: object = "") -> bytes:
    value = str(configured_secret or os.getenv("AGENT_CAPABILITY_GRANT_SECRET") or "").strip()
    return value.encode("utf-8") if value else _EPHEMERAL_SECRET


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as exc:
        raise CapabilityGrantError("能力授权格式无效。") from exc


def _normalized_ids(values: object, *, maximum: int = 200) -> list[str]:
    if not isinstance(values, (list, tuple, set, frozenset)):
        return []
    result: list[str] = []
    for value in values:
        item = str(value or "").strip()
        if item and len(item) <= 128 and item not in result:
            result.append(item)
        if len(result) >= maximum:
            break
    return result


def external_mcp_proxy_tool_name(server_id: object, remote_name: object) -> str:
    """Return the stable tool id exposed by the financial MCP gateway."""
    safe_server = re.sub(r"[^A-Za-z0-9_]", "_", str(server_id or ""))[:12]
    safe_tool = re.sub(r"[^A-Za-z0-9_]", "_", str(remote_name or ""))[:42]
    return f"ext_{safe_server}_{safe_tool}"[:59]


def runtime_mcp_tool_name(server_name: object, raw_tool_name: object) -> str:
    """Mirror the Agent runtime's MCP tool-name normalization for exact allowlisting."""
    raw = f"mcp_{server_name}_{raw_tool_name}"
    sanitized = _SANITIZE_RE.sub("_", re.sub(r"[^a-zA-Z0-9_-]", "_", raw))
    if len(sanitized) <= 64:
        return sanitized
    digest = hashlib.sha1(sanitized.encode("utf-8")).hexdigest()[:8]
    return f"{sanitized[:55]}_{digest}"


def build_runtime_capability_policy(
    manifest: Mapping[str, Any],
    *,
    session_id: str,
    stock_codes: Iterable[str] = (),
    configured_secret: object = "",
    ttl_seconds: int = 360,
) -> dict[str, Any]:
    """Create the wire policy and opaque grant consumed by the Agent runtime."""
    runtime = manifest.get("runtimePolicy")
    runtime = runtime if isinstance(runtime, Mapping) else {}
    gateway_tool_ids = _normalized_ids(runtime.get("gatewayToolIds"))
    runtime_tool_ids = _normalized_ids(runtime.get("runtimeToolIds"))
    skill_ids = _normalized_ids(manifest.get("skillIds"), maximum=100)
    data_source_ids = _normalized_ids(
        [item.get("id") for item in manifest.get("dataSources", []) if isinstance(item, Mapping)],
        maximum=100,
    )
    normalized_stocks = _normalized_ids(list(stock_codes), maximum=100)
    now = int(time.time())
    expires_at = now + max(30, min(int(ttl_seconds), _MAX_GRANT_SECONDS))
    policy_material = {
        "gatewayToolIds": gateway_tool_ids,
        "runtimeToolIds": runtime_tool_ids,
        "skillIds": skill_ids,
        "dataSourceIds": data_source_ids,
        "stockCodes": normalized_stocks,
        "session": hashlib.sha256(session_id.encode("utf-8", errors="replace")).hexdigest()[:24],
    }
    policy_id = hashlib.sha256(
        json.dumps(policy_material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:24]
    claims = {
        "v": CAPABILITY_ISOLATION_VERSION,
        "pid": policy_id,
        "iat": now,
        "exp": expires_at,
        "nonce": secrets.token_urlsafe(12),
        "tools": gateway_tool_ids,
        "data": data_source_ids,
        "stocks": normalized_stocks,
    }
    encoded = _b64encode(
        json.dumps(claims, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    signature = _b64encode(
        hmac.new(_secret_bytes(configured_secret), encoded.encode("ascii"), hashlib.sha256).digest()
    )
    return {
        "version": CAPABILITY_ISOLATION_VERSION,
        "policy_id": policy_id,
        "allowed_tools": runtime_tool_ids,
        "allowed_skills": skill_ids,
        "gateway_server": FINANCIAL_MCP_SERVER_NAME,
        "gateway_grant": f"{encoded}.{signature}",
    }


def verify_capability_grant(token: object, *, configured_secret: object = "") -> CapabilityGrantClaims:
    """Verify a gateway grant and return its bounded authorization claims."""
    raw = str(token or "").strip()
    if not raw or len(raw) > 16_384 or raw.count(".") != 1:
        raise CapabilityGrantError("缺少有效的任务能力授权。")
    encoded, supplied_signature = raw.split(".", 1)
    expected_signature = _b64encode(
        hmac.new(_secret_bytes(configured_secret), encoded.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise CapabilityGrantError("任务能力授权签名无效。")
    try:
        payload = json.loads(_b64decode(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise CapabilityGrantError("任务能力授权载荷无效。") from exc
    if not isinstance(payload, dict) or payload.get("v") != CAPABILITY_ISOLATION_VERSION:
        raise CapabilityGrantError("任务能力授权版本不受支持。")
    now = int(time.time())
    issued_at, expires_at = payload.get("iat"), payload.get("exp")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int):
        raise CapabilityGrantError("任务能力授权时间无效。")
    if issued_at > now + 30 or expires_at < now or expires_at - issued_at > _MAX_GRANT_SECONDS:
        raise CapabilityGrantError("任务能力授权已过期。")
    policy_id = str(payload.get("pid") or "").strip()
    if not policy_id:
        raise CapabilityGrantError("任务能力授权缺少策略标识。")
    return CapabilityGrantClaims(
        policy_id=policy_id,
        gateway_tool_ids=frozenset(_normalized_ids(payload.get("tools"))),
        data_source_ids=frozenset(_normalized_ids(payload.get("data"), maximum=100)),
        stock_codes=frozenset(_normalized_ids(payload.get("stocks"), maximum=100)),
        expires_at=expires_at,
    )
