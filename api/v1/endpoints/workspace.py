# -*- coding: utf-8 -*-
"""Agent-first workspace APIs and the read/compute-only financial MCP surface."""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response

from api.v1.schemas.workspace import (
    CapabilityPreferenceRequest,
    DataSourceCreateRequest,
    ExpertCreateRequest,
    ExpertTeamCreateRequest,
    ExpertTeamUpdateRequest,
    ExpertUpdateRequest,
    McpServerCreateRequest,
    McpServerUpdateRequest,
    RunCreateRequest,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
    SkillCreateRequest,
    SkillUpdateRequest,
    TaskCreateRequest,
    TaskUpdateRequest,
)
from src.agent.capability_grants import (
    CapabilityGrantError,
    GRANT_ARGUMENT_NAME,
    verify_capability_grant,
)
from src.agent.stock_scope import StockScope
from src.agent.tool_surface import ToolSurface
from src.agent.tools.execution import ToolAccessContext
from src.agent.tools.registry import ToolRegistry
from src.config import get_config
from src.agent.factory import get_tool_registry
from src.services.workspace_service import WorkspaceError, WorkspaceService


router = APIRouter()
mcp_router = APIRouter()

_TOOL_DATA_SOURCE_KIND = {
    "get_realtime_quote": "kline",
    "get_daily_history": "kline",
    "get_chip_distribution": "kline",
    "get_capital_flow": "kline",
    "analyze_trend": "kline",
    "calculate_ma": "kline",
    "get_volume_analysis": "kline",
    "analyze_pattern": "kline",
    "get_market_indices": "kline",
    "get_sector_rankings": "kline",
    "screen_stock_universe": "kline",
    "get_stock_info": "fundamentals",
    "search_stock_news": "news",
    "search_comprehensive_intel": "news",
}


def _service() -> WorkspaceService:
    return WorkspaceService()


def _raise(error: WorkspaceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message, "details": error.details})


def _call(action):
    try:
        return action()
    except WorkspaceError as exc:
        raise _raise(exc) from exc


@router.get("/capabilities")
def capability_catalog() -> dict[str, Any]:
    return _service().capability_catalog()


@router.get("/runtime-manifest")
def runtime_manifest(request: Request) -> dict[str, Any]:
    """Describe the website-owned financial surface an external Agent may mount."""
    catalog = _service().capability_catalog()
    mcp_url = f"{str(request.base_url).rstrip('/')}/api/v1/mcp"
    return {
        "schemaVersion": 2,
        "runtimeRole": "external_agent_runtime",
        "taskCapabilityIsolation": {
            "version": 1,
            "mode": "required_for_nanobot",
            "enforcement": ["runtime_tool_view", "runtime_skill_view", "signed_gateway_grant"],
        },
        "financialMcp": {
            "transport": "streamable_http",
            "url": mcp_url,
            "serverName": "finance",
            "requiresTaskGrant": True,
            "permissions": ["READ", "COMPUTE"],
            "toolIds": [item["id"] for item in catalog["tools"] if item.get("enabled")],
        },
        "enabledSkillIds": [item["id"] for item in catalog["skills"] if item.get("enabled")],
        "workspaceMcpServers": [
            {
                "id": item["id"],
                "transport": item["transport"],
                "selectable": item.get("selectable", False),
                "healthStatus": item.get("healthStatus"),
            }
            for item in catalog["mcpServers"]
            if item.get("enabled")
        ],
        "defaults": catalog["defaults"],
        "notes": [
            "Nanobot owns its ReAct loop, sessions, memory, recovery and runtime-local MCP processes.",
            "The website owns task boundaries, capability allowlists, artifacts, approvals and the run ledger.",
            "stdio commands are never executed by the website process.",
        ],
    }


@router.get("/skills")
def list_skills() -> list[dict[str, Any]]:
    return _service().list_skills()


@router.post("/skills", status_code=201)
def create_skill(request: SkillCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_skill(request.model_dump()))


@router.patch("/skills/{skill_id}")
def update_skill(skill_id: str, request: SkillUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_skill(skill_id, request.model_dump(exclude_none=True)))


@router.delete("/skills/{skill_id}")
def archive_skill(skill_id: str) -> dict[str, Any]:
    return _call(lambda: _service().archive_skill(skill_id))


@router.get("/tools")
def list_tools() -> list[dict[str, Any]]:
    return _service().list_tools()


@router.get("/data-sources")
def list_data_sources() -> list[dict[str, Any]]:
    return _service().list_data_sources()


@router.post("/data-sources", status_code=201)
def create_data_source(request: DataSourceCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_data_source(request.model_dump()))


@router.delete("/data-sources/{source_id}")
def archive_data_source(source_id: int) -> dict[str, Any]:
    return _call(lambda: _service().archive_data_source(source_id))


@router.put("/capabilities/{kind}/preferences")
def set_capability_preferences(kind: str, request: CapabilityPreferenceRequest) -> dict[str, Any]:
    return _call(lambda: _service().set_preferences(kind, request.enabledIds))


@router.get("/mcp-servers")
def list_mcp_servers() -> list[dict[str, Any]]:
    return _service().list_mcp_servers()


@router.post("/mcp-servers", status_code=201)
def create_mcp_server(request: McpServerCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_mcp_server(request.model_dump()))


@router.patch("/mcp-servers/{server_id}")
def update_mcp_server(server_id: str, request: McpServerUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_mcp_server(server_id, request.model_dump(exclude_none=True)))


@router.delete("/mcp-servers/{server_id}")
def archive_mcp_server(server_id: str) -> dict[str, Any]:
    return _call(lambda: _service().archive_mcp_server(server_id))


@router.post("/mcp-servers/{server_id}/probe")
def probe_mcp_server(server_id: str) -> dict[str, Any]:
    return _call(lambda: _service().probe_mcp_server(server_id))


@router.get("/experts")
def list_experts() -> list[dict[str, Any]]:
    return _service().list_experts()


@router.post("/experts", status_code=201)
def create_expert(request: ExpertCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_expert(request.model_dump()))


@router.patch("/experts/{expert_id}")
def update_expert(expert_id: int, request: ExpertUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_expert(expert_id, request.model_dump(exclude_none=True)))


@router.delete("/experts/{expert_id}")
def archive_expert(expert_id: int) -> dict[str, Any]:
    return _call(lambda: _service().archive_expert(expert_id))


@router.get("/expert-teams")
def list_expert_teams() -> list[dict[str, Any]]:
    return _service().list_expert_teams()


@router.post("/expert-teams", status_code=201)
def create_expert_team(request: ExpertTeamCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_expert_team(request.model_dump()))


@router.patch("/expert-teams/{team_id}")
def update_expert_team(team_id: int, request: ExpertTeamUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_expert_team(team_id, request.model_dump(exclude_none=True)))


@router.delete("/expert-teams/{team_id}")
def archive_expert_team(team_id: int) -> dict[str, Any]:
    return _call(lambda: _service().archive_expert_team(team_id))


@router.get("/tasks")
def list_tasks(kind: Optional[str] = None, include_archived: bool = False) -> list[dict[str, Any]]:
    return _service().list_tasks(kind, include_archived)


@router.post("/tasks", status_code=201)
def create_task(request: TaskCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_task(request.model_dump()))


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    return _call(lambda: _service().get_task(task_id))


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, request: TaskUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_task(task_id, request.model_dump(exclude_none=True)))


@router.delete("/tasks/{task_id}")
def archive_task(task_id: str) -> dict[str, Any]:
    return _call(lambda: _service().archive_task(task_id))


@router.post("/tasks/{task_id}/runs", status_code=202)
def create_run(task_id: str, request: RunCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_run(task_id, request.triggerType))


@router.get("/runs")
def list_runs(kind: Optional[str] = None, task_id: Optional[str] = None, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    return _service().list_runs(kind, task_id, limit)


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    return _call(lambda: _service().get_run(run_id))


@router.post("/runs/{run_id}/cancel", status_code=202)
def cancel_run(run_id: str) -> dict[str, Any]:
    return _call(lambda: _service().cancel_run(run_id))


@router.get("/schedules")
def list_schedules() -> list[dict[str, Any]]:
    return _service().list_schedules()


@router.post("/schedules", status_code=201)
def create_schedule(request: ScheduleCreateRequest) -> dict[str, Any]:
    return _call(lambda: _service().create_schedule(request.model_dump()))


@router.patch("/schedules/{schedule_id}")
def update_schedule(schedule_id: str, request: ScheduleUpdateRequest) -> dict[str, Any]:
    return _call(lambda: _service().update_schedule(schedule_id, request.model_dump(exclude_none=True)))


@router.delete("/schedules/{schedule_id}")
def delete_schedule(schedule_id: str) -> dict[str, Any]:
    return _call(lambda: _service().delete_schedule(schedule_id))


def _jsonrpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    payload = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    if data is not None:
        payload["error"]["data"] = data
    return payload


@mcp_router.post("")
async def financial_mcp(request: Request, response: Response) -> Any:
    """Stateless Streamable-HTTP-compatible MCP endpoint for DSA financial tools."""
    try:
        payload = await request.json()
    except ValueError:
        return _jsonrpc_error(None, -32700, "Parse error")
    if not isinstance(payload, dict):
        return _jsonrpc_error(None, -32600, "Invalid Request")
    method, request_id = payload.get("method"), payload.get("id")
    if method == "initialize":
        response.headers["Mcp-Session-Id"] = "dsa-stateless"
        return _jsonrpc_result(request_id, {"protocolVersion": "2025-03-26", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "llm-tradebot-finance", "version": "1.0"}})
    if method == "notifications/initialized":
        response.status_code = 202
        return None
    service = _service()
    enabled = {item["id"] for item in service.list_tools() if item.get("enabled")}
    registry = get_tool_registry()
    gateway_registry = ToolRegistry()
    for definition in registry.list_tools():
        if definition.name in enabled:
            gateway_registry.register(definition)
    selectable_mcp_ids = [
        item["id"]
        for item in service.list_mcp_servers()
        if item.get("selectable")
    ]
    for definition in service.resolve_mcp_tool_definitions(selectable_mcp_ids):
        gateway_registry.register(definition)
    if method == "tools/list":
        tools = [item.to_mcp_descriptor() for item in gateway_registry.list_tools()]
        return _jsonrpc_result(request_id, {"tools": tools})
    if method == "tools/call":
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        name = params.get("name")
        arguments = dict(params.get("arguments")) if isinstance(params.get("arguments"), dict) else {}
        grant = arguments.pop(GRANT_ARGUMENT_NAME, None)
        try:
            claims = verify_capability_grant(
                grant,
                configured_secret=getattr(get_config(), "agent_capability_grant_secret", ""),
            )
        except CapabilityGrantError as exc:
            return _jsonrpc_error(request_id, -32001, str(exc))
        if name not in claims.gateway_tool_ids:
            return _jsonrpc_error(request_id, -32003, "Tool is outside this task's capability grant")
        tool_definition = gateway_registry.resolve(str(name))
        if tool_definition is None:
            return _jsonrpc_error(request_id, -32601, "Tool is not available in the workspace gateway")
        required_source_kind = _TOOL_DATA_SOURCE_KIND.get(str(name))
        if required_source_kind:
            source_kind_by_id = {
                str(item.get("sourceId")): str(item.get("kind") or "")
                for item in service.list_data_sources()
            }
            selected_source_kinds = {
                source_kind_by_id[source_id]
                for source_id in claims.data_source_ids
                if source_id in source_kind_by_id
            }
            if required_source_kind not in selected_source_kinds:
                return _jsonrpc_error(
                    request_id,
                    -32003,
                    f"Tool requires an authorized {required_source_kind} data source",
                )
        requested_stock = str(arguments.get("stock_code") or "").strip().upper()
        if requested_stock and not claims.stock_codes:
            return _jsonrpc_error(request_id, -32003, "This task has no authorized stock scope")
        scope = None
        if claims.stock_codes:
            expected = next(iter(sorted(claims.stock_codes)))
            scope = StockScope(
                expected_stock_code=expected,
                allowed_stock_codes=set(claims.stock_codes),
                mode="maintain",
            )
        execution_context = ToolAccessContext(
            stock_scope=scope,
            data_sources=sorted(claims.data_source_ids),
            backend="mcp",
            session_id=claims.policy_id,
            # Tools that do not declare cooperative cancellation are still
            # bounded by nanobot's MCP client timeout.  Giving them an internal
            # deadline would make ToolSurface reject them before execution.
            timeout_seconds=60 if tool_definition.policy.cancellation_safe else None,
            max_result_bytes=1024 * 1024,
            redact_result=True,
            audit_context={"capability_policy_id": claims.policy_id},
        )
        result = await asyncio.to_thread(
            ToolSurface(gateway_registry).execute_tool,
            str(name),
            arguments,
            execution_context,
        )
        is_error = not bool(result.get("ok"))
        return _jsonrpc_result(request_id, {"content": [{"type": "text", "text": str(result.get("result_text") or result.get("message") or result)}], "structuredContent": result, "isError": is_error})
    if request_id is None:
        response.status_code = 202
        return None
    return _jsonrpc_error(request_id, -32601, "Method not found")


@mcp_router.get("")
def financial_mcp_get() -> dict[str, Any]:
    return {"name": "llm-tradebot-finance", "protocol": "MCP Streamable HTTP", "status": "ready"}
