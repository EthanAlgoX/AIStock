# -*- coding: utf-8 -*-
"""Agent-first financial workspace control plane and durable run ledger."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from sqlalchemy import desc, func, or_, select

from src.agent.capability_grants import (
    FINANCIAL_MCP_SERVER_NAME,
    nanobot_mcp_tool_name,
)
from src.config import get_config
from src.storage import (
    DatabaseManager,
    WorkspaceArtifactRecord,
    WorkspaceCapabilityPreferenceRecord,
    WorkspaceDataSnapshotRecord,
    WorkspaceExpertRecord,
    WorkspaceExpertTeamRecord,
    WorkspaceMcpServerRecord,
    WorkspaceRunRecord,
    WorkspaceScheduleRecord,
    WorkspaceSkillRecord,
    WorkspaceTaskRecord,
    utc_naive_now,
)


logger = logging.getLogger(__name__)

CAPABILITY_KINDS = {"skill", "tool", "mcp", "data_source", "expert", "expert_team"}
TASK_KINDS = {"research", "screening", "trading", "expert_review"}
TASK_ARTIFACTS = {
    "research": ("ResearchReport",),
    "screening": ("ScreenSpec", "CandidateList"),
    "trading": ("TradeProposal", "RiskAssessment", "PaperTradingRun"),
    "expert_review": ("ExpertReview",),
}
_DEFAULT_DATA_SOURCE_IDS = ("system_market_data", "system_news", "system_fundamentals")
_DEFAULT_TOOL_IDS = {
    "chat": (
        "get_realtime_quote", "get_daily_history", "get_stock_info",
        "search_stock_news", "search_comprehensive_intel", "analyze_trend",
        "calculate_ma", "get_volume_analysis", "analyze_pattern",
        "get_market_indices", "get_sector_rankings", "screen_stock_universe",
    ),
    "research": (
        "get_realtime_quote", "get_daily_history", "get_stock_info",
        "search_stock_news", "search_comprehensive_intel", "analyze_trend",
        "calculate_ma", "get_volume_analysis", "analyze_pattern",
        "get_chip_distribution", "get_capital_flow", "get_analysis_context",
    ),
    "screening": (
        "screen_stock_universe", "get_market_indices", "get_sector_rankings",
        "search_comprehensive_intel",
    ),
    "trading": (
        "get_realtime_quote", "get_daily_history", "get_portfolio_snapshot",
        "get_capital_flow", "search_stock_news", "analyze_trend",
        "calculate_ma", "get_volume_analysis", "analyze_pattern",
    ),
    "expert_review": (
        "get_realtime_quote", "get_daily_history", "get_stock_info",
        "search_stock_news", "search_comprehensive_intel", "analyze_trend",
    ),
}
_ENV_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,159}$")
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
_WORKERS = ThreadPoolExecutor(max_workers=3, thread_name_prefix="workspace_run")
_CANCEL_EVENTS: dict[str, threading.Event] = {}
_CANCEL_LOCK = threading.Lock()


class WorkspaceError(ValueError):
    """A stable service error safe to translate to an HTTP response."""

    def __init__(self, code: str, message: str, status_code: int = 400, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


BUILTIN_EXPERTS: tuple[dict[str, Any], ...] = (
    {
        "id": -1001,
        "key": "warren-buffett",
        "name": "沃伦·巴菲特",
        "style": "长期价值与安全边际",
        "description": "从企业所有者视角判断商业质量、护城河、资本配置和买入价格。",
        "philosophy": "好生意、可信管理层、长期现金创造能力与安全边际。",
        "focus": ["商业模式", "护城河", "自由现金流", "管理层", "安全边际"],
        "prompt": "借鉴沃伦·巴菲特公开投资框架但不得冒充本人。审查生意质量、护城河、现金流、资本配置和安全边际；明确最强反证、关键假设与失效条件。",
    },
    {
        "id": -1002,
        "key": "charlie-munger",
        "name": "查理·芒格",
        "style": "多元思维与反向审查",
        "description": "用跨学科心智模型、激励机制和反向思考识别认知偏差与致命风险。",
        "philosophy": "避免愚蠢，以合理价格持有卓越企业，并持续寻找反证。",
        "focus": ["激励机制", "心智模型", "反向思考", "机会成本", "风险清单"],
        "prompt": "借鉴查理·芒格公开思考框架但不得冒充本人。先判断什么会导致永久损失，再检查激励、会计、替代、监管、杠杆和机会成本。",
    },
    {
        "id": -1003,
        "key": "duan-yongping",
        "name": "段永平",
        "style": "本分、商业模式与能力圈",
        "description": "优先判断生意模式、消费者价值和企业文化，只研究真正看得懂的公司。",
        "philosophy": "买股票就是买公司；做对的事情并把事情做对。",
        "focus": ["生意模式", "消费者价值", "企业文化", "能力圈", "长期跟踪"],
        "prompt": "借鉴段永平公开投资框架但不得冒充本人。判断用户价值、生意模式、差异化、企业文化和能力圈，证据不足时明确暂缓判断。",
    },
    {
        "id": -1004,
        "key": "cathie-wood",
        "name": "凯西·伍德",
        "style": "颠覆式创新与五年视角",
        "description": "关注技术曲线、成本下降、平台融合和长期渗透率，同时显式处理高估值风险。",
        "philosophy": "寻找重塑产业结构的创新平台，用多年维度评估采用与市场扩张。",
        "focus": ["颠覆创新", "技术曲线", "渗透率", "五年情景", "估值敏感性"],
        "prompt": "借鉴凯西·伍德公开研究框架但不得冒充本人。构建五年基准、乐观和悲观情景，并同时审查高估值、稀释、竞争和落地延迟。",
    },
    {
        "id": -1005,
        "key": "zhang-lei",
        "name": "张磊",
        "style": "长期主义与结构性价值",
        "description": "研究长期结构变化、企业家能力和价值创造空间。",
        "philosophy": "与持续创造价值的企业共同成长。",
        "focus": ["结构变化", "产业链", "企业家", "价值创造", "长期复利"],
        "prompt": "借鉴张磊公开投资框架但不得冒充本人。从产业结构、组织学习、企业家和生态价值分析长期复利，并列出治理与执行风险。",
    },
)

BUILTIN_TEAMS: tuple[dict[str, Any], ...] = (
    {"id": -2001, "key": "long-term-value", "name": "长期价值评审团", "description": "从生意质量、安全边际、能力圈和反向风险审查投资逻辑。", "member_ids": [-1001, -1002, -1003], "protocol": "独立分析 → 证据对齐 → 反向质疑 → 汇总共识、分歧与失效条件"},
    {"id": -2002, "key": "innovation-value-debate", "name": "创新与价值辩论组", "description": "让创新增长与价值风险视角围绕渗透率、估值和执行概率形成分歧。", "member_ids": [-1001, -1002, -1004, -1005], "protocol": "独立情景建模 → 假设交换 → 交叉反驳 → 生成冲突矩阵"},
    {"id": -2003, "key": "full-stock-committee", "name": "全视角个股委员会", "description": "五位专家共同审查商业质量、认知风险、能力圈、创新空间和产业结构。", "member_ids": [-1001, -1002, -1003, -1004, -1005], "protocol": "冻结公共数据快照 → 独立分析 → 提取证据与假设 → 交叉质疑 → 综合结论"},
)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _load(value: Optional[str], fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _extract_json(text: str) -> Any:
    candidates = [match.group(1) for match in _JSON_FENCE_RE.finditer(text or "")]
    candidates.append(text or "")
    for candidate in candidates:
        raw = candidate.strip()
        if not raw:
            continue
        for start_char, end_char in (("{", "}"), ("[", "]")):
            start, end = raw.find(start_char), raw.rfind(end_char)
            if start >= 0 and end > start:
                try:
                    return json.loads(raw[start:end + 1])
                except ValueError:
                    pass
    return None


def normalize_bindings(value: Any) -> dict[str, list[Any]]:
    raw = value if isinstance(value, dict) else {}
    result: dict[str, list[Any]] = {}
    for key in ("skillIds", "toolIds", "mcpIds", "dataSourceIds", "expertIds", "expertTeamIds"):
        items = raw.get(key)
        result[key] = list(dict.fromkeys(items)) if isinstance(items, list) else []
    return result


class WorkspaceService:
    """Persist capabilities, tasks, snapshots, runs, artifacts and schedules."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    # Capability registry ----------------------------------------------------------
    def _seed_experts(self, session) -> None:
        for item in BUILTIN_EXPERTS:
            if session.get(WorkspaceExpertRecord, item["id"]):
                continue
            session.add(WorkspaceExpertRecord(
                id=item["id"], expert_key=item["key"], name=item["name"], style=item["style"],
                description=item["description"], philosophy=item["philosophy"],
                focus_json=_dump(item["focus"]), prompt=item["prompt"], built_in=True,
            ))
        session.flush()
        for item in BUILTIN_TEAMS:
            if session.get(WorkspaceExpertTeamRecord, item["id"]):
                continue
            session.add(WorkspaceExpertTeamRecord(
                id=item["id"], team_key=item["key"], name=item["name"],
                description=item["description"], member_ids_json=_dump(item["member_ids"]),
                protocol=item["protocol"], built_in=True,
            ))
        session.flush()

    def _preferences(self, session, kind: str) -> dict[str, bool]:
        rows = session.execute(select(WorkspaceCapabilityPreferenceRecord).where(
            WorkspaceCapabilityPreferenceRecord.capability_kind == kind,
        )).scalars().all()
        return {row.capability_id: bool(row.enabled) for row in rows}

    def list_skills(self) -> list[dict[str, Any]]:
        from src.agent.factory import get_skill_manager

        config = get_config()
        manager = get_skill_manager(config)
        with self.db.session_scope() as session:
            prefs = self._preferences(session, "skill")
            custom = session.execute(select(WorkspaceSkillRecord).where(
                WorkspaceSkillRecord.archived_at.is_(None),
            ).order_by(WorkspaceSkillRecord.name)).scalars().all()
            items = [{
                "id": skill.name,
                "name": getattr(skill, "display_name", None) or skill.name,
                "description": getattr(skill, "description", "") or "",
                "category": getattr(skill, "category", "research") or "research",
                "instructions": "",
                "version": 1,
                "builtIn": True,
                "enabled": prefs.get(skill.name, True),
            } for skill in manager.list_skills() if getattr(skill, "user_invocable", True)]
            items.extend(
                {**self._skill_item(row), "enabled": prefs.get(row.id, bool(row.enabled))}
                for row in custom
            )
            return items

    def create_skill(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        instructions = str(payload.get("instructions") or "").strip()
        if not name or not instructions:
            raise WorkspaceError("skill_invalid", "Skill 名称和执行说明不能为空。")
        skill_id = str(payload.get("id") or f"custom-{uuid.uuid4().hex}").strip()
        with self.db.session_scope() as session:
            duplicate = session.execute(select(WorkspaceSkillRecord.id).where(
                or_(WorkspaceSkillRecord.id == skill_id, WorkspaceSkillRecord.name == name),
            )).scalar_one_or_none()
            if duplicate:
                raise WorkspaceError("skill_conflict", "Skill 标识或名称已存在。", 409)
            row = WorkspaceSkillRecord(
                id=skill_id, name=name, category=str(payload.get("category") or "general"),
                description=str(payload.get("description") or "").strip(), instructions=instructions,
                enabled=bool(payload.get("enabled", True)),
            )
            session.add(row)
            session.flush()
            return self._skill_item(row)

    def update_skill(self, skill_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceSkillRecord, skill_id)
            if not row or row.archived_at:
                raise WorkspaceError("skill_not_found", "Skill 不存在。", 404)
            for field in ("name", "category", "description", "instructions"):
                if field in payload:
                    value = str(payload[field] or "").strip()
                    if field in {"name", "instructions"} and not value:
                        raise WorkspaceError("skill_invalid", "Skill 名称和执行说明不能为空。")
                    setattr(row, field, value)
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
                preference = session.execute(select(WorkspaceCapabilityPreferenceRecord).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == "skill",
                    WorkspaceCapabilityPreferenceRecord.capability_id == skill_id,
                )).scalar_one_or_none()
                if preference:
                    preference.enabled = row.enabled
                    preference.updated_at = utc_naive_now()
            row.version += 1
            row.updated_at = utc_naive_now()
            session.flush()
            return self._skill_item(row)

    def archive_skill(self, skill_id: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceSkillRecord, skill_id)
            if not row:
                raise WorkspaceError("skill_not_found", "Skill 不存在。", 404)
            row.archived_at = row.archived_at or utc_naive_now()
            row.enabled = False
            return {"id": row.id, "archived": True}

    @staticmethod
    def _skill_item(row: WorkspaceSkillRecord) -> dict[str, Any]:
        return {"id": row.id, "name": row.name, "category": row.category, "description": row.description or "", "instructions": row.instructions, "version": row.version, "builtIn": False, "enabled": bool(row.enabled), "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at)}

    def set_preferences(self, kind: str, enabled_ids: Iterable[Any]) -> dict[str, Any]:
        if kind not in CAPABILITY_KINDS:
            raise WorkspaceError("capability_kind_invalid", "不支持的能力类型。")
        normalized = {str(item) for item in enabled_ids}
        if kind in {"expert", "expert_team"}:
            catalog = self.list_experts() if kind == "expert" else self.list_expert_teams()
        elif kind == "mcp":
            catalog = self.list_mcp_servers()
        elif kind == "data_source":
            catalog = self.list_data_sources()
        elif kind == "tool":
            catalog = self.list_tools()
        else:
            catalog = self.list_skills()
        known = {
            str(item.get("sourceId") if kind == "data_source" else item.get("id"))
            for item in catalog
        }
        unknown = sorted(normalized - known)
        if unknown:
            raise WorkspaceError("capability_unknown", "包含不存在的能力。", 422, {"ids": unknown})
        with self.db.session_scope() as session:
            existing = self._preferences(session, kind)
            for capability_id in known:
                row = session.execute(select(WorkspaceCapabilityPreferenceRecord).where(
                    WorkspaceCapabilityPreferenceRecord.capability_kind == kind,
                    WorkspaceCapabilityPreferenceRecord.capability_id == capability_id,
                )).scalar_one_or_none()
                enabled = capability_id in normalized
                if row:
                    row.enabled = enabled
                    row.updated_at = utc_naive_now()
                else:
                    session.add(WorkspaceCapabilityPreferenceRecord(capability_kind=kind, capability_id=capability_id, enabled=enabled))
            if kind == "skill":
                custom_rows = session.execute(select(WorkspaceSkillRecord).where(
                    WorkspaceSkillRecord.archived_at.is_(None),
                )).scalars().all()
                for custom_row in custom_rows:
                    custom_row.enabled = custom_row.id in normalized
                    custom_row.updated_at = utc_naive_now()
            return {"kind": kind, "enabledIds": sorted(normalized), "previouslyConfigured": bool(existing)}

    def list_tools(self) -> list[dict[str, Any]]:
        from src.agent.factory import get_tool_registry

        with self.db.get_session() as session:
            prefs = self._preferences(session, "tool")
        return [{**item, "id": item["name"], "builtIn": True, "enabled": prefs.get(item["name"], True)} for item in (
            tool.to_public_descriptor() for tool in get_tool_registry().list_tools()
        )]

    def list_mcp_servers(self) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(select(WorkspaceMcpServerRecord).where(
                WorkspaceMcpServerRecord.archived_at.is_(None),
            ).order_by(WorkspaceMcpServerRecord.name)).scalars().all()
            return [self._mcp_item(row) for row in rows]

    def create_mcp_server(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        transport = str(payload.get("transport") or "http").strip().lower()
        location = str(payload.get("location") or "").strip()
        credential_key = str(payload.get("credentialKey") or "").strip()
        if not name or not location or transport not in {"http", "stdio"}:
            raise WorkspaceError("mcp_invalid", "MCP 名称、传输方式和连接位置无效。")
        self._validate_mcp_location(transport, location)
        if credential_key and not _ENV_KEY_RE.fullmatch(credential_key):
            raise WorkspaceError("credential_key_invalid", "凭据键必须是合法环境变量名。")
        with self.db.session_scope() as session:
            if session.execute(select(WorkspaceMcpServerRecord.id).where(WorkspaceMcpServerRecord.name == name)).scalar_one_or_none():
                raise WorkspaceError("mcp_conflict", "MCP 名称已存在。", 409)
            row = WorkspaceMcpServerRecord(
                id=str(payload.get("id") or uuid.uuid4().hex), name=name, transport=transport,
                location=location, credential_key=credential_key, enabled=bool(payload.get("enabled", True)),
            )
            session.add(row)
            session.flush()
            return self._mcp_item(row)

    def update_mcp_server(self, server_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceMcpServerRecord, server_id)
            if not row or row.archived_at:
                raise WorkspaceError("mcp_not_found", "MCP Server 不存在。", 404)
            transport = str(payload.get("transport", row.transport)).strip().lower()
            location = str(payload.get("location", row.location)).strip()
            self._validate_mcp_location(transport, location)
            credential_key = str(payload.get("credentialKey", row.credential_key or "")).strip()
            if credential_key and not _ENV_KEY_RE.fullmatch(credential_key):
                raise WorkspaceError("credential_key_invalid", "凭据键必须是合法环境变量名。")
            if "name" in payload:
                row.name = str(payload["name"] or "").strip()
                if not row.name:
                    raise WorkspaceError("mcp_invalid", "MCP 名称不能为空。")
            connection_changed = transport != row.transport or location != row.location
            row.transport, row.location, row.credential_key = transport, location, credential_key
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
            if connection_changed:
                row.health_status = "unknown"
                row.discovered_capabilities_json = "[]"
                row.last_checked_at = None
                row.last_error = None
            row.updated_at = utc_naive_now()
            session.flush()
            return self._mcp_item(row)

    def archive_mcp_server(self, server_id: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceMcpServerRecord, server_id)
            if not row:
                raise WorkspaceError("mcp_not_found", "MCP Server 不存在。", 404)
            row.archived_at, row.enabled = row.archived_at or utc_naive_now(), False
            return {"id": row.id, "archived": True}

    @staticmethod
    def _validate_mcp_location(transport: str, location: str) -> None:
        if transport == "http":
            parsed = urlsplit(location)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise WorkspaceError("mcp_url_invalid", "HTTP MCP 地址必须是无内嵌凭据的 HTTP(S) URL。")
        elif not location.strip():
            raise WorkspaceError("mcp_command_invalid", "stdio MCP 需要启动命令。")

    @staticmethod
    def _mcp_item(row: WorkspaceMcpServerRecord) -> dict[str, Any]:
        selectable = bool(
            row.enabled
            and row.transport == "http"
            and row.health_status == "healthy"
        )
        return {
            "id": row.id,
            "name": row.name,
            "transport": row.transport,
            "location": row.location,
            "credentialKey": row.credential_key or "",
            "enabled": bool(row.enabled),
            "selectable": selectable,
            "healthStatus": row.health_status,
            "lastCheckedAt": _iso(row.last_checked_at),
            "lastError": row.last_error,
            "capabilities": _load(row.discovered_capabilities_json, []),
            "createdAt": _iso(row.created_at),
            "updatedAt": _iso(row.updated_at),
        }

    def probe_mcp_server(self, server_id: str) -> dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(WorkspaceMcpServerRecord, server_id)
            if not row or row.archived_at:
                raise WorkspaceError("mcp_not_found", "MCP Server 不存在。", 404)
            snapshot = self._mcp_item(row)
        if snapshot["transport"] == "stdio":
            result = {"status": "requires_runtime", "capabilities": [], "error": "stdio 连接由隔离的 Nanobot Runtime 启动，网站不会执行任意本地命令。"}
        else:
            result = self._probe_http_mcp(snapshot)
        with self.db.session_scope() as session:
            row = session.get(WorkspaceMcpServerRecord, server_id)
            row.health_status = result["status"]
            row.discovered_capabilities_json = _dump(result.get("capabilities") or [])
            row.last_error = result.get("error")
            row.last_checked_at = utc_naive_now()
            session.flush()
            return self._mcp_item(row)

    @staticmethod
    def _probe_http_mcp(server: dict[str, Any]) -> dict[str, Any]:
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        key = server.get("credentialKey")
        if key and os.getenv(key):
            headers["Authorization"] = f"Bearer {os.environ[key]}"
        try:
            init = requests.post(server["location"], headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "llm-tradebot", "version": "1"}}}, timeout=(3, 8))
            init.raise_for_status()
            session_id = init.headers.get("Mcp-Session-Id")
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            requests.post(
                server["location"],
                headers=headers,
                json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
                timeout=(3, 5),
            ).raise_for_status()
            response = requests.post(server["location"], headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, timeout=(3, 8))
            response.raise_for_status()
            payload = WorkspaceService._decode_mcp_response(response)
            if payload.get("error"):
                raise ValueError("MCP tools/list returned an error")
            tools = payload.get("result", {}).get("tools", []) if isinstance(payload, dict) else []
            capabilities = [
                {
                    "type": "tool",
                    "name": str(tool.get("name")),
                    "description": str(tool.get("description") or ""),
                    "inputSchema": tool.get("inputSchema")
                    if isinstance(tool.get("inputSchema"), dict)
                    else {"type": "object", "properties": {}},
                }
                for tool in tools
                if isinstance(tool, dict) and tool.get("name")
            ]
            return {"status": "healthy", "capabilities": capabilities, "error": None}
        except (requests.RequestException, ValueError, TypeError) as exc:
            logger.warning("MCP probe failed for %s: %s", server.get("id"), exc)
            return {"status": "unreachable", "capabilities": [], "error": "连接失败或 Server 返回了无效 MCP 响应。"}

    @staticmethod
    def _decode_mcp_response(response: requests.Response) -> dict[str, Any]:
        if len(response.content) > 2 * 1024 * 1024:
            raise ValueError("MCP response too large")
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            for line in response.text.splitlines():
                if line.startswith("data:"):
                    return json.loads(line[5:].strip())
            raise ValueError("empty MCP event stream")
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("invalid MCP response")
        return payload

    def resolve_mcp_tool_definitions(self, server_ids: Iterable[str]) -> list[Any]:
        """Build namespaced ToolDefinitions for selected, healthy HTTP MCP servers.

        The returned definitions are request-local and are never added to the
        process-wide registry. stdio servers stay owned by the isolated Nanobot
        runtime because the website must not execute arbitrary shell commands.
        """
        from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolPolicy

        selected = {str(item) for item in server_ids}
        if not selected:
            return []
        servers = {
            item["id"]: item
            for item in self.list_mcp_servers()
            if item["id"] in selected and item.get("selectable")
        }
        unavailable = sorted(selected - set(servers))
        if unavailable:
            raise WorkspaceError(
                "mcp_unavailable",
                "所选 MCP 尚未通过 HTTP 健康检查，不能挂载到本次任务。",
                409,
                {"ids": unavailable},
            )
        definitions = []
        for server_id in selected:
            server = servers.get(server_id)
            if not server or server.get("transport") != "http":
                continue
            for capability in server.get("capabilities") or []:
                if not isinstance(capability, dict) or capability.get("type") != "tool":
                    continue
                remote_name = str(capability.get("name") or "").strip()
                if not remote_name:
                    continue
                schema = capability.get("inputSchema")
                schema = schema if isinstance(schema, dict) else {}
                properties = schema.get("properties")
                properties = properties if isinstance(properties, dict) else {}
                required = set(schema.get("required") or [])
                parameters = []
                for name, details in properties.items():
                    details = details if isinstance(details, dict) else {}
                    json_type = str(details.get("type") or "string")
                    if json_type not in {"string", "integer", "number", "boolean", "array", "object"}:
                        json_type = "string"
                    enum = details.get("enum")
                    parameters.append(ToolParameter(
                        name=str(name),
                        type=json_type,
                        description=str(details.get("description") or name),
                        required=str(name) in required,
                        enum=[str(item) for item in enum] if isinstance(enum, list) else None,
                    ))
                safe_server = re.sub(r"[^A-Za-z0-9_]", "_", server_id)[:12]
                safe_tool = re.sub(r"[^A-Za-z0-9_]", "_", remote_name)[:42]
                runtime_name = f"mcp_{safe_server}_{safe_tool}"[:64]

                def handler(_server=server, _remote_name=remote_name, **arguments):
                    return self._call_http_mcp_tool(_server, _remote_name, arguments)

                definitions.append(ToolDefinition(
                    name=runtime_name,
                    description=f"[{server['name']}] {capability.get('description') or remote_name}",
                    parameters=parameters,
                    handler=handler,
                    category="mcp",
                    policy=ToolPolicy.declared(
                        read_only=True,
                        permissions=["READ", "COMPUTE"],
                        side_effects=[],
                        cancellation_safe=False,
                    ),
                ))
        return definitions

    @staticmethod
    def _call_http_mcp_tool(server: dict[str, Any], tool_name: str, arguments: dict[str, Any]) -> Any:
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        credential_key = server.get("credentialKey")
        if credential_key and os.getenv(credential_key):
            headers["Authorization"] = f"Bearer {os.environ[credential_key]}"
        try:
            init = requests.post(
                server["location"],
                headers=headers,
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "llm-tradebot", "version": "1"}}},
                timeout=(3, 8),
            )
            init.raise_for_status()
            session_id = init.headers.get("Mcp-Session-Id")
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            requests.post(
                server["location"],
                headers=headers,
                json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
                timeout=(3, 5),
            ).raise_for_status()
            response = requests.post(
                server["location"],
                headers=headers,
                json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}},
                timeout=(3, 60),
            )
            response.raise_for_status()
            payload = WorkspaceService._decode_mcp_response(response)
        except (requests.RequestException, ValueError, TypeError) as exc:
            raise RuntimeError("MCP 工具调用失败。") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("MCP 工具返回无效响应。")
        if payload.get("error"):
            raise RuntimeError(str(payload["error"].get("message") or "MCP 工具返回错误。"))
        result = payload.get("result")
        if isinstance(result, dict) and result.get("isError"):
            raise RuntimeError("MCP 工具执行失败。")
        return result

    def list_data_sources(self) -> list[dict[str, Any]]:
        from src.services.strategy_definition_service import StrategyDefinitionService

        return StrategyDefinitionService(self.db).list_data_sources()

    def create_data_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Register a data source through the Agent workspace boundary."""
        from src.services.strategy_definition_service import (
            StrategyDefinitionError,
            StrategyDefinitionService,
        )

        try:
            return StrategyDefinitionService(self.db).create_data_source(payload)
        except StrategyDefinitionError as exc:
            raise WorkspaceError(
                exc.code,
                exc.message,
                exc.status_code,
                exc.details,
            ) from exc

    def archive_data_source(self, source_id: int) -> dict[str, Any]:
        """Archive a data-source registration without rewriting frozen history."""
        from src.services.strategy_definition_service import (
            StrategyDefinitionError,
            StrategyDefinitionService,
        )

        try:
            return StrategyDefinitionService(self.db).archive_data_source(source_id)
        except StrategyDefinitionError as exc:
            raise WorkspaceError(
                exc.code,
                exc.message,
                exc.status_code,
                exc.details,
            ) from exc

    def list_experts(self) -> list[dict[str, Any]]:
        with self.db.session_scope() as session:
            self._seed_experts(session)
            rows = session.execute(select(WorkspaceExpertRecord).where(
                WorkspaceExpertRecord.archived_at.is_(None),
            ).order_by(desc(WorkspaceExpertRecord.built_in), WorkspaceExpertRecord.id)).scalars().all()
            return [self._expert_item(row) for row in rows]

    def get_expert(self, expert_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            self._seed_experts(session)
            row = session.get(WorkspaceExpertRecord, expert_id)
            if not row or row.archived_at:
                raise WorkspaceError("expert_not_found", "专家不存在。", 404)
            return self._expert_item(row)

    def create_expert(self, payload: dict[str, Any]) -> dict[str, Any]:
        name, prompt = str(payload.get("name") or "").strip(), str(payload.get("prompt") or payload.get("defaultPrompt") or "").strip()
        if not name or not prompt:
            raise WorkspaceError("expert_invalid", "专家名称和 Persona Prompt 不能为空。")
        with self.db.session_scope() as session:
            self._seed_experts(session)
            max_positive = session.execute(select(func.max(WorkspaceExpertRecord.id)).where(WorkspaceExpertRecord.id > 0)).scalar() or 0
            row = WorkspaceExpertRecord(
                id=int(max_positive) + 1, expert_key=f"custom-{uuid.uuid4().hex}", name=name,
                style=str(payload.get("style") or "自定义投资视角").strip(),
                description=str(payload.get("description") or "").strip(), philosophy=str(payload.get("philosophy") or "").strip(),
                focus_json=_dump(payload.get("focus") if isinstance(payload.get("focus"), list) else []),
                prompt=prompt, built_in=False, enabled=bool(payload.get("enabled", True)),
            )
            session.add(row)
            session.flush()
            return self._expert_item(row)

    def update_expert(self, expert_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            self._seed_experts(session)
            row = session.get(WorkspaceExpertRecord, expert_id)
            if not row or row.archived_at:
                raise WorkspaceError("expert_not_found", "专家不存在。", 404)
            prompt = payload.get("prompt", payload.get("defaultPrompt"))
            if prompt is not None:
                prompt = str(prompt).strip()
                if not prompt:
                    raise WorkspaceError("expert_prompt_invalid", "Persona Prompt 不能为空。")
                row.prompt = prompt
            for field in ("name", "style", "description", "philosophy"):
                if field in payload:
                    value = str(payload[field] or "").strip()
                    if field in {"name", "style"} and not value:
                        raise WorkspaceError("expert_invalid", "专家名称和投资风格不能为空。")
                    setattr(row, field, value)
            if "focus" in payload:
                row.focus_json = _dump(payload["focus"] if isinstance(payload["focus"], list) else [])
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
            row.version += 1
            row.updated_at = utc_naive_now()
            session.flush()
            return self._expert_item(row)

    def archive_expert(self, expert_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceExpertRecord, expert_id)
            if not row:
                raise WorkspaceError("expert_not_found", "专家不存在。", 404)
            if row.built_in:
                row.enabled = False
            else:
                row.archived_at, row.enabled = utc_naive_now(), False
            return {"id": row.id, "archived": not row.built_in, "enabled": False}

    @staticmethod
    def _expert_item(row: WorkspaceExpertRecord) -> dict[str, Any]:
        built_in_prompt = next(
            (item["prompt"] for item in BUILTIN_EXPERTS if item["id"] == row.id),
            row.prompt,
        )
        return {"id": row.id, "key": row.expert_key, "name": row.name, "style": row.style, "description": row.description or "", "philosophy": row.philosophy or "", "focus": _load(row.focus_json, []), "prompt": row.prompt, "defaultPrompt": built_in_prompt, "version": row.version, "builtIn": bool(row.built_in), "enabled": bool(row.enabled), "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at)}

    def list_expert_teams(self) -> list[dict[str, Any]]:
        with self.db.session_scope() as session:
            self._seed_experts(session)
            rows = session.execute(select(WorkspaceExpertTeamRecord).where(
                WorkspaceExpertTeamRecord.archived_at.is_(None),
            ).order_by(desc(WorkspaceExpertTeamRecord.built_in), WorkspaceExpertTeamRecord.id)).scalars().all()
            return [self._team_item(row) for row in rows]

    def create_expert_team(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        member_ids = [int(item) for item in payload.get("memberIds", [])]
        protocol = str(payload.get("protocol") or "").strip()
        if not name or not protocol or not member_ids:
            raise WorkspaceError("expert_team_invalid", "专家团名称、成员和评审协议不能为空。")
        self._validate_expert_ids(member_ids)
        with self.db.session_scope() as session:
            self._seed_experts(session)
            max_positive = session.execute(select(func.max(WorkspaceExpertTeamRecord.id)).where(WorkspaceExpertTeamRecord.id > 0)).scalar() or 0
            row = WorkspaceExpertTeamRecord(id=int(max_positive) + 1, team_key=f"custom-{uuid.uuid4().hex}", name=name, description=str(payload.get("description") or "").strip(), member_ids_json=_dump(member_ids), protocol=protocol, built_in=False, enabled=bool(payload.get("enabled", True)))
            session.add(row)
            session.flush()
            return self._team_item(row)

    def update_expert_team(self, team_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            self._seed_experts(session)
            row = session.get(WorkspaceExpertTeamRecord, team_id)
            if not row or row.archived_at:
                raise WorkspaceError("expert_team_not_found", "专家团不存在。", 404)
            if "memberIds" in payload:
                member_ids = [int(item) for item in payload["memberIds"]]
                self._validate_expert_ids(member_ids)
                row.member_ids_json = _dump(member_ids)
            for field in ("name", "description", "protocol"):
                if field in payload:
                    value = str(payload[field] or "").strip()
                    if field in {"name", "protocol"} and not value:
                        raise WorkspaceError("expert_team_invalid", "专家团名称和评审协议不能为空。")
                    setattr(row, field, value)
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
            row.version += 1
            row.updated_at = utc_naive_now()
            session.flush()
            return self._team_item(row)

    def archive_expert_team(self, team_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceExpertTeamRecord, team_id)
            if not row:
                raise WorkspaceError("expert_team_not_found", "专家团不存在。", 404)
            if row.built_in:
                row.enabled = False
            else:
                row.archived_at, row.enabled = utc_naive_now(), False
            return {"id": row.id, "archived": not row.built_in, "enabled": False}

    @staticmethod
    def _team_item(row: WorkspaceExpertTeamRecord) -> dict[str, Any]:
        return {"id": row.id, "key": row.team_key, "name": row.name, "description": row.description or "", "memberIds": _load(row.member_ids_json, []), "protocol": row.protocol, "version": row.version, "builtIn": bool(row.built_in), "enabled": bool(row.enabled), "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at)}

    def _validate_expert_ids(self, ids: list[int]) -> None:
        known = {item["id"] for item in self.list_experts() if item["enabled"]}
        unknown = sorted(set(ids) - known)
        if unknown:
            raise WorkspaceError("expert_unknown", "包含不存在或已停用的专家。", 422, {"ids": unknown})

    def capability_catalog(self) -> dict[str, Any]:
        catalog = {
            "skills": self.list_skills(),
            "tools": self.list_tools(),
            "mcpServers": self.list_mcp_servers(),
            "dataSources": self.list_data_sources(),
            "experts": self.list_experts(),
            "expertTeams": self.list_expert_teams(),
        }
        catalog["defaults"] = {
            kind: self.default_bindings(kind, catalog)
            for kind in _DEFAULT_TOOL_IDS
        }
        return catalog

    def default_bindings(
        self,
        kind: str,
        catalog: Optional[dict[str, Any]] = None,
    ) -> dict[str, list[Any]]:
        """Return a safe, enabled starting capability set for a task surface."""
        if kind not in _DEFAULT_TOOL_IDS:
            raise WorkspaceError("task_kind_invalid", "不支持的默认能力场景。", 422)
        catalog = catalog or {
            "skills": self.list_skills(),
            "tools": self.list_tools(),
            "dataSources": self.list_data_sources(),
        }
        enabled_skills = [item for item in catalog["skills"] if item.get("enabled")]
        default_skill_ids: list[str] = []
        if enabled_skills:
            from src.agent.skills.defaults import get_primary_default_skill_id
            from src.agent.factory import get_skill_manager

            enabled_ids = {str(item["id"]) for item in enabled_skills}
            builtin_skills = [
                skill
                for skill in get_skill_manager(get_config()).list_skills()
                if skill.name in enabled_ids
            ]
            default_skill = get_primary_default_skill_id(builtin_skills)
            if default_skill:
                default_skill_ids = [default_skill]
        enabled_tools = {
            str(item["id"])
            for item in catalog["tools"]
            if item.get("enabled")
        }
        selectable_sources = {
            str(item.get("sourceId"))
            for item in catalog["dataSources"]
            if item.get("selectable")
        }
        return normalize_bindings({
            "skillIds": default_skill_ids,
            "toolIds": [item for item in _DEFAULT_TOOL_IDS[kind] if item in enabled_tools],
            "dataSourceIds": [item for item in _DEFAULT_DATA_SOURCE_IDS if item in selectable_sources],
        })

    def validate_bindings(self, value: Any) -> dict[str, list[Any]]:
        bindings = normalize_bindings(value)
        catalog = self.capability_catalog()
        lookups = {
            "skillIds": {str(item["id"]) for item in catalog["skills"] if item.get("enabled")},
            "toolIds": {str(item["id"]) for item in catalog["tools"] if item.get("enabled")},
            "mcpIds": {str(item["id"]) for item in catalog["mcpServers"] if item.get("selectable")},
            "dataSourceIds": {str(item.get("sourceId")) for item in catalog["dataSources"] if item.get("selectable")},
            "expertIds": {str(item["id"]) for item in catalog["experts"] if item.get("enabled")},
            "expertTeamIds": {str(item["id"]) for item in catalog["expertTeams"] if item.get("enabled")},
        }
        errors = {}
        for key, items in bindings.items():
            unknown = [item for item in items if str(item) not in lookups[key]]
            if unknown:
                errors[key] = unknown
        if errors:
            raise WorkspaceError("capability_binding_invalid", "任务绑定包含不存在、未配置或已停用的能力。", 422, errors)
        return bindings

    def resolve_skill_selection(self, ids: Iterable[str]) -> tuple[list[str], str]:
        from src.agent.factory import get_skill_manager

        requested = list(dict.fromkeys(str(item) for item in ids))
        builtins = {skill.name for skill in get_skill_manager(get_config()).list_skills()}
        builtin_ids = [item for item in requested if item in builtins]
        with self.db.get_session() as session:
            rows = session.execute(select(WorkspaceSkillRecord).where(
                WorkspaceSkillRecord.id.in_(requested), WorkspaceSkillRecord.enabled.is_(True),
                WorkspaceSkillRecord.archived_at.is_(None),
            )).scalars().all() if requested else []
        extra = "\n\n".join(f"### {row.name}\n{row.instructions}" for row in rows)
        return builtin_ids, extra

    # Task definitions and runs ----------------------------------------------------
    def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind = str(payload.get("kind") or "").strip().lower()
        name = str(payload.get("name") or "").strip()
        market = str(payload.get("market") or "CN").strip().upper()
        objective = str(payload.get("objective") or "").strip()
        if kind not in TASK_KINDS or not name or not objective or market not in {"CN", "HK", "US", "GLOBAL"}:
            raise WorkspaceError("task_invalid", "任务类型、名称、市场或目标无效。")
        bindings = self.validate_bindings(payload.get("capabilities"))
        subject = payload.get("subject") if isinstance(payload.get("subject"), dict) else {}
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        self._validate_task_contract(kind, subject, config, bindings)
        task_id = uuid.uuid4().hex
        with self.db.session_scope() as session:
            row = WorkspaceTaskRecord(
                id=task_id, task_kind=kind, name=name, market=market, objective=objective,
                subject_json=_dump(subject), config_json=_dump(config),
                capability_bindings_json=_dump(bindings), enabled=bool(payload.get("enabled", True)),
            )
            session.add(row)
            session.flush()
            return self._task_item(row)

    def update_task(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceTaskRecord, task_id)
            if not row or row.archived_at:
                raise WorkspaceError("task_not_found", "任务定义不存在。", 404)
            if "capabilities" in payload:
                row.capability_bindings_json = _dump(self.validate_bindings(payload["capabilities"]))
            for key, attr in (("name", "name"), ("market", "market"), ("objective", "objective")):
                if key in payload:
                    setattr(row, attr, str(payload[key] or "").strip())
            if "subject" in payload:
                row.subject_json = _dump(payload["subject"] if isinstance(payload["subject"], dict) else {})
            if "config" in payload:
                row.config_json = _dump(payload["config"] if isinstance(payload["config"], dict) else {})
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
            if not row.name or not row.objective or row.market not in {"CN", "HK", "US", "GLOBAL"}:
                raise WorkspaceError("task_invalid", "任务名称、市场或目标无效。")
            self._validate_task_contract(
                row.task_kind,
                _load(row.subject_json, {}),
                _load(row.config_json, {}),
                normalize_bindings(_load(row.capability_bindings_json, {})),
            )
            row.version += 1
            row.updated_at = utc_naive_now()
            session.flush()
            return self._task_item(row)

    def list_tasks(self, kind: Optional[str] = None, include_archived: bool = False) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            statement = select(WorkspaceTaskRecord).order_by(desc(WorkspaceTaskRecord.updated_at))
            if kind:
                statement = statement.where(WorkspaceTaskRecord.task_kind == kind)
            if not include_archived:
                statement = statement.where(WorkspaceTaskRecord.archived_at.is_(None))
            return [self._task_item(row) for row in session.execute(statement).scalars().all()]

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(WorkspaceTaskRecord, task_id)
            if not row or row.archived_at:
                raise WorkspaceError("task_not_found", "任务定义不存在。", 404)
            return self._task_item(row)

    def archive_task(self, task_id: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceTaskRecord, task_id)
            if not row:
                raise WorkspaceError("task_not_found", "任务定义不存在。", 404)
            row.archived_at, row.enabled = row.archived_at or utc_naive_now(), False
            schedules = session.execute(select(WorkspaceScheduleRecord).where(WorkspaceScheduleRecord.task_id == task_id)).scalars().all()
            for schedule in schedules:
                schedule.enabled = False
            return {"id": row.id, "archived": True, "disabledSchedules": len(schedules)}

    @staticmethod
    def _task_item(row: WorkspaceTaskRecord) -> dict[str, Any]:
        return {"id": row.id, "kind": row.task_kind, "name": row.name, "market": row.market, "objective": row.objective, "subject": _load(row.subject_json, {}), "config": _load(row.config_json, {}), "capabilities": normalize_bindings(_load(row.capability_bindings_json, {})), "version": row.version, "enabled": bool(row.enabled), "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at), "archivedAt": _iso(row.archived_at)}

    def create_run(self, task_id: str, trigger_type: str = "manual") -> dict[str, Any]:
        task = self.get_task(task_id)
        if not task["enabled"]:
            raise WorkspaceError("task_disabled", "任务已停用，不能运行。", 409)
        self.validate_bindings(task["capabilities"])
        run_id, snapshot_id = uuid.uuid4().hex, uuid.uuid4().hex
        now = utc_naive_now()
        source_ids = task["capabilities"]["dataSourceIds"]
        task_snapshot = {
            **task,
            "runContext": {"dataSnapshotId": snapshot_id, "asOf": _iso(now)},
            "capabilitySnapshot": self._capability_snapshot(task["capabilities"]),
        }
        with self.db.session_scope() as session:
            run = WorkspaceRunRecord(id=run_id, task_id=task_id, task_kind=task["kind"], status="queued", trigger_type=trigger_type, data_snapshot_id=snapshot_id, task_snapshot_json=_dump(task_snapshot))
            snapshot = WorkspaceDataSnapshotRecord(id=snapshot_id, run_id=run_id, as_of=now, source_ids_json=_dump(source_ids), source_versions_json=_dump({source_id: {"selectedAt": _iso(now)} for source_id in source_ids}), quality_json=_dump({"status": "pending", "warnings": []}))
            session.add_all([run, snapshot])
        cancel_event = threading.Event()
        with _CANCEL_LOCK:
            _CANCEL_EVENTS[run_id] = cancel_event
        try:
            _WORKERS.submit(self._execute_run, run_id, cancel_event)
        except Exception as exc:
            with _CANCEL_LOCK:
                _CANCEL_EVENTS.pop(run_id, None)
            self._finish_run(run_id, "failed", error_code="queue_unavailable", error_message="后台运行队列不可用。")
            raise WorkspaceError("run_queue_unavailable", "后台运行队列不可用。", 503) from exc
        return self.get_run(run_id)

    def _execute_run(self, run_id: str, cancel_event: threading.Event) -> None:
        try:
            with self.db.session_scope() as session:
                row = session.get(WorkspaceRunRecord, run_id)
                if not row or row.cancel_requested:
                    if row:
                        row.status, row.completed_at = "cancelled", utc_naive_now()
                    return
                row.status, row.started_at, row.updated_at = "running", utc_naive_now(), utc_naive_now()
                task = _load(row.task_snapshot_json, {})
            if cancel_event.is_set():
                self._finish_run(run_id, "cancelled")
                return
            result = self._execute_agent_task(run_id, task, cancel_event)
            if cancel_event.is_set():
                self._finish_run(run_id, "cancelled")
            elif result["success"]:
                self._finish_run(run_id, "completed", summary=result["summary"])
                self._mark_snapshot_quality(run_id, "ready", result.get("warnings") or [])
            else:
                self._finish_run(run_id, "failed", error_code=result.get("errorCode") or "agent_failed", error_message=result.get("error") or "Agent 任务执行失败。")
                self._mark_snapshot_quality(run_id, "degraded", [result.get("error") or "Agent 任务执行失败。"])
        except Exception as exc:  # noqa: BLE001 - terminal state must be durable.
            logger.exception("Workspace run %s failed", run_id)
            self._finish_run(run_id, "failed", error_code="workspace_run_failed", error_message=str(exc)[:1000])
        finally:
            with _CANCEL_LOCK:
                _CANCEL_EVENTS.pop(run_id, None)

    def _execute_agent_task(self, run_id: str, task: dict[str, Any], cancel_event: threading.Event) -> dict[str, Any]:
        kind = task["kind"]
        bindings = normalize_bindings(task.get("capabilities"))
        builtin_skills, custom_skill_instructions = self.resolve_skill_selection(bindings["skillIds"])
        expert_ids = self._expanded_expert_ids(bindings)
        if kind == "expert_review" or expert_ids:
            return self._execute_expert_task(run_id, task, cancel_event, expert_ids, builtin_skills, custom_skill_instructions)
        prompt = self._task_prompt(task)
        result = self._call_agent(run_id, prompt, task, cancel_event, builtin_skills, custom_skill_instructions)
        if not result.success:
            return {"success": False, "errorCode": result.error_code, "error": result.error}
        self._store_task_artifacts(run_id, task, result.content)
        return {"success": True, "summary": {"artifactTypes": list(TASK_ARTIFACTS[kind]), "agentBackend": result.backend, "model": result.model, "toolCallCount": len(result.tool_calls_log)}}

    def _call_agent(self, session_suffix: str, prompt: str, task: dict[str, Any], cancel_event: threading.Event, builtin_skills: list[str], custom_skill_instructions: str):
        from src.agent.factory import build_agent_chat_executor

        bindings = normalize_bindings(task.get("capabilities"))
        executor = build_agent_chat_executor(
            get_config(), skills=builtin_skills or None,
            tool_ids=bindings["toolIds"],
            extra_skill_instructions=custom_skill_instructions,
            external_tools=self.resolve_mcp_tool_definitions(bindings["mcpIds"]),
        )
        subject = task.get("subject") if isinstance(task.get("subject"), dict) else {}
        context = {
            "stock_code": subject.get("stock") or subject.get("stockCode") or "",
            "stock_name": subject.get("stockName") or "",
            "report_language": "zh",
            "capability_manifest": self._capability_manifest(bindings),
            "data_snapshot_as_of": (task.get("runContext") or {}).get("asOf") or _iso(utc_naive_now()),
        }
        return executor.chat(prompt, f"workspace-{session_suffix}", context=context, cancel_event=cancel_event, selected_skill_ids=builtin_skills)

    def _execute_expert_task(self, run_id: str, task: dict[str, Any], cancel_event: threading.Event, expert_ids: list[int], builtin_skills: list[str], custom_skill_instructions: str) -> dict[str, Any]:
        if not expert_ids:
            return {"success": False, "errorCode": "expert_required", "error": "专家评审至少需要选择一位专家。"}
        opinions = []
        for expert_id in expert_ids:
            if cancel_event.is_set():
                return {"success": False, "errorCode": "cancelled", "error": "任务已取消。"}
            expert = self.get_expert(expert_id)
            prompt = f"""你正在作为主 Agent 的独立专家评审子任务运行。\n\n[Persona Prompt]\n{expert['prompt']}\n\n[公共议题]\n{self._task_prompt(task)}\n\n必须只使用可获得证据，输出 stance、claims、evidence、counter_evidence、assumptions、confidence、unresolved_questions。"""
            result = self._call_agent(f"{run_id}-expert-{expert_id}", prompt, task, cancel_event, builtin_skills, custom_skill_instructions)
            if not result.success:
                opinions.append({"expertId": expert_id, "expertName": expert["name"], "status": "failed", "error": result.error})
                continue
            opinion = {"expertId": expert_id, "expertName": expert["name"], "status": "completed", "content": result.content, "structured": _extract_json(result.content)}
            opinions.append(opinion)
            self._store_artifact(run_id, "ExpertOpinion", expert["name"], opinion, result.content)
        completed = [item for item in opinions if item["status"] == "completed"]
        if not completed:
            return {"success": False, "errorCode": "expert_runs_failed", "error": "所有专家子任务均执行失败。"}
        synthesis_prompt = f"""你是专家评审主持 Agent。请根据以下彼此独立的专家意见，比较证据质量、数据时点和假设强弱，不得简单多数投票。输出共识、关键分歧、冲突矩阵、最终结论、置信度、风险与下一步。\n\n{_dump(completed)}"""
        synthesis = self._call_agent(f"{run_id}-synthesis", synthesis_prompt, task, cancel_event, builtin_skills, custom_skill_instructions)
        if not synthesis.success:
            return {"success": False, "errorCode": synthesis.error_code or "synthesis_failed", "error": synthesis.error}
        review = {"opinions": opinions, "conclusion": synthesis.content, "structuredConclusion": _extract_json(synthesis.content)}
        self._store_artifact(run_id, "ExpertReview", f"{task['name']} · 专家评审", review, synthesis.content)
        if task["kind"] != "expert_review":
            self._store_task_artifacts(run_id, task, synthesis.content)
        return {"success": True, "summary": {"artifactTypes": ["ExpertReview", *TASK_ARTIFACTS.get(task["kind"], ())], "expertCount": len(completed), "failedExpertCount": len(opinions) - len(completed), "agentBackend": synthesis.backend, "model": synthesis.model}}

    def _expanded_expert_ids(self, bindings: dict[str, list[Any]]) -> list[int]:
        ids = [int(item) for item in bindings["expertIds"]]
        teams = {item["id"]: item for item in self.list_expert_teams()}
        for team_id in bindings["expertTeamIds"]:
            team = teams.get(int(team_id))
            if team:
                ids.extend(int(item) for item in team["memberIds"])
        return list(dict.fromkeys(ids))

    def _capability_manifest(self, bindings: dict[str, list[Any]]) -> dict[str, Any]:
        mcp = {item["id"]: item for item in self.list_mcp_servers()}
        data = {item.get("sourceId"): item for item in self.list_data_sources()}
        gateway_tool_ids = [str(item) for item in bindings["toolIds"]]
        gateway_tool_ids.extend(
            definition.name
            for definition in self.resolve_mcp_tool_definitions(bindings["mcpIds"])
        )
        gateway_tool_ids = list(dict.fromkeys(gateway_tool_ids))
        return {
            "skillIds": bindings["skillIds"], "toolIds": bindings["toolIds"],
            "mcpServers": [{"id": item, "name": mcp[item]["name"], "healthStatus": mcp[item]["healthStatus"]} for item in bindings["mcpIds"] if item in mcp],
            "dataSources": [{"id": item, "name": data[item]["name"], "availability": data[item].get("availability")} for item in bindings["dataSourceIds"] if item in data],
            "expertIds": bindings["expertIds"], "expertTeamIds": bindings["expertTeamIds"],
            "runtimePolicy": {
                "isolationVersion": 1,
                "gatewayServer": FINANCIAL_MCP_SERVER_NAME,
                "gatewayToolIds": gateway_tool_ids,
                "nanobotToolIds": [
                    nanobot_mcp_tool_name(FINANCIAL_MCP_SERVER_NAME, item)
                    for item in gateway_tool_ids
                ],
            },
        }

    def _capability_snapshot(self, value: Any) -> dict[str, Any]:
        bindings = normalize_bindings(value)
        catalog = self.capability_catalog()
        return {
            "bindings": bindings,
            "skills": [{"id": item["id"], "version": item.get("version", 1)} for item in catalog["skills"] if item["id"] in bindings["skillIds"]],
            "tools": [{"id": item["id"], "policy": item.get("policy", {})} for item in catalog["tools"] if item["id"] in bindings["toolIds"]],
            "mcpServers": [{"id": item["id"], "healthStatus": item.get("healthStatus"), "capabilities": item.get("capabilities", [])} for item in catalog["mcpServers"] if item["id"] in bindings["mcpIds"]],
            "dataSources": [{"id": item.get("sourceId"), "availability": item.get("availability")} for item in catalog["dataSources"] if item.get("sourceId") in bindings["dataSourceIds"]],
            "experts": [{"id": item["id"], "version": item.get("version", 1)} for item in catalog["experts"] if item["id"] in bindings["expertIds"]],
            "expertTeams": [{"id": item["id"], "version": item.get("version", 1), "memberIds": item.get("memberIds", [])} for item in catalog["expertTeams"] if item["id"] in bindings["expertTeamIds"]],
        }

    @staticmethod
    def _validate_task_contract(kind: str, subject: dict[str, Any], config: dict[str, Any], bindings: dict[str, list[Any]]) -> None:
        if kind == "research" and not str(subject.get("stock") or subject.get("stockCode") or "").strip():
            raise WorkspaceError("research_stock_required", "单股分析任务必须绑定一只股票。", 422)
        if kind == "expert_review" and not (bindings["expertIds"] or bindings["expertTeamIds"]):
            raise WorkspaceError("expert_required", "专家评审至少需要绑定一位专家或一个专家团。", 422)
        if kind != "trading":
            return
        if str(config.get("executionMode") or "paper").lower() != "paper":
            raise WorkspaceError("trading_mode_forbidden", "当前交易任务只允许模拟盘模式。", 422)
        risk = config.get("riskPolicy") if isinstance(config.get("riskPolicy"), dict) else {}
        checks = {
            "maxPositions": (risk.get("maxPositions", 10), 1, 100),
            "maxPositionPercent": (risk.get("maxPositionPercent", 15), 0.1, 100),
            "maxDailyLossPercent": (risk.get("maxDailyLossPercent", 3), 0.1, 100),
        }
        invalid = []
        for field, (raw, minimum, maximum) in checks.items():
            try:
                value = float(raw)
            except (TypeError, ValueError):
                invalid.append(field)
                continue
            if value < minimum or value > maximum:
                invalid.append(field)
        if invalid:
            raise WorkspaceError("risk_policy_invalid", "交易任务风险边界无效。", 422, {"fields": invalid})

    @staticmethod
    def _task_prompt(task: dict[str, Any]) -> str:
        kind = task["kind"]
        subject, config = task.get("subject") or {}, task.get("config") or {}
        output = ", ".join(TASK_ARTIFACTS[kind])
        screening_rule = (
            "选股任务必须先调用 screen_stock_universe；CandidateList 只能引用工具实际返回的候选，不得编造未扫描股票。"
            if kind == "screening"
            else ""
        )
        return f"""执行一个金融工作台任务。\n任务类型：{kind}\n任务名称：{task['name']}\n市场：{task['market']}\n研究目标：{task['objective']}\n任务对象：{_dump(subject)}\n运行配置：{_dump(config)}\n\n请获取完成任务所需的真实证据，标注数据时点和来源，明确事实、计算、推断和观点。{screening_rule}最终输出有效 JSON，对应成果合同：{output}。交易任务只生成模拟 TradeProposal 和风险检查，绝不声称真实下单。"""

    def _store_task_artifacts(self, run_id: str, task: dict[str, Any], content: str) -> None:
        parsed = _extract_json(content)
        if task["kind"] == "trading":
            proposal = parsed.get("TradeProposal") if isinstance(parsed, dict) else parsed
            proposal = proposal if proposal is not None else {"content": content}
            risk_policy = (task.get("config") or {}).get("riskPolicy") or {}
            assessment = {
                "status": "contract_checked",
                "contractPassed": True,
                "proposalRiskEvaluated": False,
                "executionMode": "paper",
                "hardLimits": risk_policy,
                "realOrderExecutionAllowed": False,
                "message": "已校验任务配置边界；尚未根据账户、持仓和成交条件评估提案风险，也未创建任何订单。",
            }
            paper_run = {
                "mode": "paper",
                "executionEnabled": False,
                "realOrdersCreated": 0,
                "simulatedFillsCreated": 0,
                "tradeProposal": proposal,
                "riskAssessment": assessment,
            }
            self._store_artifact(run_id, "TradeProposal", f"{task['name']} · TradeProposal", proposal, content)
            self._store_artifact(run_id, "RiskAssessment", f"{task['name']} · RiskAssessment", assessment)
            self._store_artifact(run_id, "PaperTradingRun", f"{task['name']} · PaperTradingRun", paper_run)
            return
        for artifact_type in TASK_ARTIFACTS[task["kind"]]:
            payload = parsed.get(artifact_type) if isinstance(parsed, dict) and artifact_type in parsed else parsed
            if payload is None:
                payload = {"content": content}
            self._store_artifact(run_id, artifact_type, f"{task['name']} · {artifact_type}", payload, content)

    def _store_artifact(self, run_id: str, artifact_type: str, title: str, content: Any, text: Optional[str] = None) -> None:
        with self.db.session_scope() as session:
            session.add(WorkspaceArtifactRecord(id=uuid.uuid4().hex, run_id=run_id, artifact_type=artifact_type, title=title[:200], content_json=_dump(content), content_text=text))

    def _finish_run(self, run_id: str, status: str, *, summary: Optional[dict[str, Any]] = None, error_code: Optional[str] = None, error_message: Optional[str] = None) -> None:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceRunRecord, run_id)
            if not row:
                return
            row.status, row.completed_at, row.updated_at = status, utc_naive_now(), utc_naive_now()
            row.result_summary_json = _dump(summary) if summary is not None else row.result_summary_json
            row.error_code, row.error_message = error_code, error_message

    def _mark_snapshot_quality(self, run_id: str, status: str, warnings: list[str]) -> None:
        with self.db.session_scope() as session:
            row = session.execute(select(WorkspaceDataSnapshotRecord).where(WorkspaceDataSnapshotRecord.run_id == run_id)).scalar_one_or_none()
            if row:
                row.quality_json = _dump({"status": status, "warnings": warnings})

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(WorkspaceRunRecord, run_id)
            if not row:
                raise WorkspaceError("run_not_found", "运行记录不存在。", 404)
            snapshot = session.execute(select(WorkspaceDataSnapshotRecord).where(WorkspaceDataSnapshotRecord.run_id == run_id)).scalar_one_or_none()
            artifacts = session.execute(select(WorkspaceArtifactRecord).where(WorkspaceArtifactRecord.run_id == run_id).order_by(WorkspaceArtifactRecord.created_at)).scalars().all()
            return self._run_item(row, snapshot, artifacts)

    def list_runs(self, kind: Optional[str] = None, task_id: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            statement = select(WorkspaceRunRecord).order_by(desc(WorkspaceRunRecord.created_at)).limit(max(1, min(limit, 500)))
            if kind:
                statement = statement.where(WorkspaceRunRecord.task_kind == kind)
            if task_id:
                statement = statement.where(WorkspaceRunRecord.task_id == task_id)
            rows = session.execute(statement).scalars().all()
            return [self._run_item(row, None, []) for row in rows]

    @staticmethod
    def _run_item(row: WorkspaceRunRecord, snapshot: Optional[WorkspaceDataSnapshotRecord], artifacts: list[WorkspaceArtifactRecord]) -> dict[str, Any]:
        return {"id": row.id, "taskId": row.task_id, "kind": row.task_kind, "status": row.status, "triggerType": row.trigger_type, "dataSnapshotId": row.data_snapshot_id, "taskSnapshot": _load(row.task_snapshot_json, {}), "resultSummary": _load(row.result_summary_json, None), "errorCode": row.error_code, "errorMessage": row.error_message, "cancelRequested": bool(row.cancel_requested), "startedAt": _iso(row.started_at), "completedAt": _iso(row.completed_at), "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at), "dataSnapshot": ({"id": snapshot.id, "asOf": _iso(snapshot.as_of), "sourceIds": _load(snapshot.source_ids_json, []), "sourceVersions": _load(snapshot.source_versions_json, {}), "quality": _load(snapshot.quality_json, {})} if snapshot else None), "artifacts": [{"id": item.id, "type": item.artifact_type, "title": item.title, "content": _load(item.content_json, {}), "text": item.content_text, "version": item.version, "createdAt": _iso(item.created_at)} for item in artifacts]}

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceRunRecord, run_id)
            if not row:
                raise WorkspaceError("run_not_found", "运行记录不存在。", 404)
            if row.status not in {"queued", "running"}:
                return {"accepted": False, "runId": run_id, "status": row.status}
            row.cancel_requested = True
            row.updated_at = utc_naive_now()
        with _CANCEL_LOCK:
            event = _CANCEL_EVENTS.get(run_id)
            if event:
                event.set()
        return {"accepted": True, "runId": run_id, "status": "cancel_requested"}

    # Schedules --------------------------------------------------------------------
    def create_schedule(self, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        task = self.get_task(task_id)
        if not task["enabled"]:
            raise WorkspaceError("task_disabled", "任务已停用，不能创建定时计划。", 409)
        mode = str(payload.get("scheduleMode") or "daily")
        timezone_name = str(payload.get("timezone") or "Asia/Shanghai")
        run_at = str(payload.get("runAt") or "")
        interval = payload.get("intervalMinutes")
        if mode == "daily" and not _TIME_RE.fullmatch(run_at):
            raise WorkspaceError("schedule_time_invalid", "每日运行时间必须为 HH:MM。")
        if mode == "interval":
            try:
                interval = int(interval)
            except (TypeError, ValueError) as exc:
                raise WorkspaceError("schedule_interval_invalid", "运行间隔必须是整数分钟。") from exc
            if interval < 5 or interval > 10080:
                raise WorkspaceError("schedule_interval_invalid", "运行间隔必须在 5 分钟到 7 天之间。")
        if mode not in {"daily", "interval"}:
            raise WorkspaceError("schedule_mode_invalid", "不支持的调度模式。")
        next_run = self._next_run(mode, run_at, interval, timezone_name, utc_naive_now())
        with self.db.session_scope() as session:
            row = WorkspaceScheduleRecord(id=uuid.uuid4().hex, task_id=task_id, name=str(payload.get("name") or task["name"]), schedule_mode=mode, run_at=run_at or None, interval_minutes=interval if mode == "interval" else None, timezone=timezone_name, enabled=bool(payload.get("enabled", True)), next_run_at=next_run)
            session.add(row)
            session.flush()
            return self._schedule_item(row)

    def list_schedules(self) -> list[dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(select(WorkspaceScheduleRecord).order_by(desc(WorkspaceScheduleRecord.updated_at))).scalars().all()
            return [self._schedule_item(row) for row in rows]

    def update_schedule(self, schedule_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceScheduleRecord, schedule_id)
            if not row:
                raise WorkspaceError("schedule_not_found", "定时计划不存在。", 404)
            if "enabled" in payload:
                row.enabled = bool(payload["enabled"])
            for key, attr in (("name", "name"), ("runAt", "run_at"), ("timezone", "timezone")):
                if key in payload:
                    setattr(row, attr, str(payload[key] or "").strip())
            if "intervalMinutes" in payload:
                try:
                    row.interval_minutes = int(payload["intervalMinutes"])
                except (TypeError, ValueError) as exc:
                    raise WorkspaceError("schedule_interval_invalid", "运行间隔必须是整数分钟。") from exc
            if row.schedule_mode == "daily" and not _TIME_RE.fullmatch(row.run_at or ""):
                raise WorkspaceError("schedule_time_invalid", "每日运行时间必须为 HH:MM。")
            if row.schedule_mode == "interval" and not 5 <= int(row.interval_minutes or 0) <= 10080:
                raise WorkspaceError("schedule_interval_invalid", "运行间隔必须在 5 分钟到 7 天之间。")
            row.next_run_at = self._next_run(row.schedule_mode, row.run_at or "", row.interval_minutes, row.timezone, utc_naive_now())
            row.updated_at = utc_naive_now()
            session.flush()
            return self._schedule_item(row)

    def delete_schedule(self, schedule_id: str) -> dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(WorkspaceScheduleRecord, schedule_id)
            if not row:
                raise WorkspaceError("schedule_not_found", "定时计划不存在。", 404)
            session.delete(row)
            return {"id": schedule_id, "deleted": True}

    @staticmethod
    def _schedule_item(row: WorkspaceScheduleRecord) -> dict[str, Any]:
        return {"id": row.id, "taskId": row.task_id, "name": row.name, "scheduleMode": row.schedule_mode, "runAt": row.run_at, "intervalMinutes": row.interval_minutes, "timezone": row.timezone, "enabled": bool(row.enabled), "nextRunAt": _iso(row.next_run_at), "lastRunAt": _iso(row.last_run_at), "lastRunId": row.last_run_id, "createdAt": _iso(row.created_at), "updatedAt": _iso(row.updated_at)}

    @staticmethod
    def _next_run(mode: str, run_at: str, interval: Optional[int], timezone_name: str, now_utc: datetime) -> datetime:
        try:
            zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise WorkspaceError("timezone_invalid", "不支持的时区。") from exc
        aware_now = now_utc.replace(tzinfo=timezone.utc)
        if mode == "interval":
            return (aware_now + timedelta(minutes=int(interval or 5))).replace(tzinfo=None)
        hour, minute = (int(part) for part in run_at.split(":"))
        local_now = aware_now.astimezone(zone)
        candidate = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local_now:
            candidate += timedelta(days=1)
        return candidate.astimezone(timezone.utc).replace(tzinfo=None)

    def run_due_schedules(self, now: Optional[datetime] = None) -> list[str]:
        now = now or utc_naive_now()
        claimed: list[tuple[str, str]] = []
        with self.db.session_scope() as session:
            rows = session.execute(select(WorkspaceScheduleRecord).where(
                WorkspaceScheduleRecord.enabled.is_(True), WorkspaceScheduleRecord.next_run_at <= now,
                or_(WorkspaceScheduleRecord.claimed_at.is_(None), WorkspaceScheduleRecord.claimed_at < now - timedelta(minutes=10)),
            ).order_by(WorkspaceScheduleRecord.next_run_at).limit(20)).scalars().all()
            for row in rows:
                row.claim_token, row.claimed_at = uuid.uuid4().hex, now
                row.next_run_at = self._next_run(row.schedule_mode, row.run_at or "", row.interval_minutes, row.timezone, now)
                claimed.append((row.id, row.task_id))
        run_ids = []
        for schedule_id, task_id in claimed:
            try:
                run = self.create_run(task_id, trigger_type="schedule")
                run_ids.append(run["id"])
                with self.db.session_scope() as session:
                    row = session.get(WorkspaceScheduleRecord, schedule_id)
                    if row:
                        row.last_run_at, row.last_run_id, row.claim_token, row.claimed_at = now, run["id"], None, None
            except Exception:  # noqa: BLE001 - one plan must not block all plans.
                logger.exception("Failed to launch workspace schedule %s", schedule_id)
                with self.db.session_scope() as session:
                    row = session.get(WorkspaceScheduleRecord, schedule_id)
                    if row:
                        row.claim_token, row.claimed_at = None, None
        return run_ids

    def reconcile_interrupted_runs(self) -> int:
        with self.db.session_scope() as session:
            rows = session.execute(select(WorkspaceRunRecord).where(WorkspaceRunRecord.status.in_(["queued", "running"]))).scalars().all()
            for row in rows:
                row.status, row.error_code = "failed", "runtime_restarted"
                row.error_message = "服务重启中断了进程内任务，请重新运行。"
                row.completed_at, row.updated_at = utc_naive_now(), utc_naive_now()
            return len(rows)


class WorkspaceSchedulerService:
    """Small lifecycle-owned poller for durable workspace schedules."""

    def __init__(self, service_factory=WorkspaceService, interval_seconds: float = 15.0):
        self.service_factory = service_factory
        self.interval_seconds = max(1.0, float(interval_seconds))
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="workspace-scheduler", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.service_factory().run_due_schedules()
            except Exception:  # noqa: BLE001 - scheduler must survive one database failure.
                logger.exception("Workspace scheduler tick failed")

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2)
        self._thread = None
