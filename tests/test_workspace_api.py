from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.endpoints import workspace as workspace_endpoint
from src.agent.capability_grants import (
    GRANT_ARGUMENT_NAME,
    build_runtime_capability_policy,
)
from src.services.workspace_service import WorkspaceService
from src.storage import DatabaseManager


@pytest.fixture()
def workspace_service():
    path = tempfile.mktemp(suffix=".sqlite")
    DatabaseManager.reset_instance()
    service = WorkspaceService(DatabaseManager(f"sqlite:///{path}"))
    try:
        yield service
    finally:
        DatabaseManager.reset_instance()
        if os.path.exists(path):
            os.unlink(path)


@pytest.fixture()
def workspace_client(workspace_service):
    app = FastAPI()
    app.include_router(workspace_endpoint.router, prefix="/workspace")
    app.include_router(workspace_endpoint.mcp_router, prefix="/mcp")
    with patch.object(workspace_endpoint, "_service", return_value=workspace_service):
        with TestClient(app) as client:
            yield client


def test_default_plan_api_is_inspectable_and_creates_no_run(workspace_client, workspace_service):
    response = workspace_client.get("/workspace/default-task-plan", params={"kind": "research", "stock": "688981.SH"})
    assert response.status_code == 200
    plan = response.json()
    from data_provider.base import normalize_stock_code
    assert normalize_stock_code(plan["task"]["subject"]["stock"]) == "688981"
    assert plan["task"]["config"]["strategyVersionId"]
    assert plan["expertCount"] == 4
    assert workspace_service.list_runs() == []
    assert workspace_client.get("/workspace/default-task-plan", params={"kind": "invalid"}).status_code == 422


def test_workspace_capability_manifest_and_task_schedule_round_trip(workspace_client):
    catalog = workspace_client.get("/workspace/capabilities")
    assert catalog.status_code == 200
    assert catalog.json()["defaults"]["screening"]["toolIds"]

    manifest = workspace_client.get("/workspace/runtime-manifest")
    assert manifest.status_code == 200
    assert manifest.json()["financialMcp"]["url"].endswith("/api/v1/mcp")
    assert manifest.json()["financialMcp"]["permissions"] == ["READ", "COMPUTE"]

    task = workspace_client.post("/workspace/tasks", json={
        "kind": "screening",
        "name": "每日选股",
        "market": "CN",
        "objective": "筛选财务质量稳健的公司",
        "subject": {},
        "config": {},
        "capabilities": {},
    })
    assert task.status_code == 201

    schedule = workspace_client.post("/workspace/schedules", json={
        "taskId": task.json()["id"],
        "name": "开盘前选股",
        "scheduleMode": "daily",
        "runAt": "08:30",
        "timezone": "Asia/Shanghai",
    })
    assert schedule.status_code == 201
    assert schedule.json()["taskId"] == task.json()["id"]
    assert workspace_client.get("/workspace/schedules").json()[0]["name"] == "开盘前选股"


def test_market_dashboard_and_task_subscription_round_trip(workspace_client):
    task = workspace_client.post("/workspace/tasks", json={
        "kind": "research",
        "name": "Apple 每日跟踪",
        "market": "US",
        "objective": "跟踪盈利质量、估值和风险事件",
        "subject": {"stock": "AAPL", "stockName": "Apple"},
        "config": {},
        "capabilities": {},
    }).json()
    schedule = workspace_client.post("/workspace/schedules", json={
        "taskId": task["id"],
        "name": "Apple 收盘复盘",
        "scheduleMode": "daily",
        "runAt": "17:00",
        "timezone": "America/New_York",
        "publishToMarket": True,
    })
    assert schedule.status_code == 201

    updated = workspace_client.put("/workspace/market-dashboards/US", json={
        "widgetIds": ["overview", "subscriptions", "news"],
        "newsSourceIds": [],
        "newsKeywords": ["Fed"],
    })
    assert updated.status_code == 200
    assert updated.json()["newsKeywords"] == ["Fed"]
    assert updated.json()["subscriptions"][0]["taskId"] == task["id"]

    subscription_id = updated.json()["subscriptions"][0]["id"]
    removed = workspace_client.delete(f"/workspace/market-subscriptions/{subscription_id}")
    assert removed.status_code == 200
    assert workspace_client.get("/workspace/market-dashboards/US").json()["subscriptions"] == []


def test_workspace_data_source_round_trip_uses_agent_first_api(workspace_client):
    created = workspace_client.post("/workspace/data-sources", json={
        "name": "测试行情仓",
        "description": "用于 Agent 研究任务",
        "connectionKey": "test_market_warehouse",
        "setupUrl": "https://data.example.com/register",
        "accessMode": "api_key",
        "kind": "kline",
        "markets": ["cn", "hk"],
    })
    assert created.status_code == 201
    assert created.json()["builtIn"] is False
    assert created.json()["sourceId"].startswith("custom:")
    assert created.json()["setupUrl"] == "https://data.example.com/register"
    assert created.json()["accessMode"] == "api_key"

    listed = workspace_client.get("/workspace/data-sources")
    assert listed.status_code == 200
    assert any(item["sourceId"] == created.json()["sourceId"] for item in listed.json())

    archived = workspace_client.delete(f"/workspace/data-sources/{created.json()['id']}")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert all(
        item["sourceId"] != created.json()["sourceId"]
        for item in workspace_client.get("/workspace/data-sources").json()
    )


def test_workspace_data_source_probe_returns_observed_health(workspace_client, workspace_service):
    probe_result = {
        "status": "degraded",
        "recordCount": 0,
        "errorCode": "empty_result",
        "error": "请求成功，但没有有效记录。",
        "detail": {"provider": "FinanceRSS"},
    }
    with patch.object(workspace_service, "_run_data_source_probe", return_value=probe_result):
        response = workspace_client.post("/workspace/data-sources/news%3Afinance_rss/probe")

    assert response.status_code == 200
    assert response.json()["availability"] == "configured"
    assert response.json()["healthStatus"] == "degraded"
    assert response.json()["operational"] is True
    assert response.json()["lastErrorCode"] == "empty_result"


def test_workspace_data_source_rejects_invalid_market_before_service_call(workspace_client):
    response = workspace_client.post("/workspace/data-sources", json={
        "name": "无效市场来源",
        "connectionKey": "invalid_market_source",
        "kind": "news",
        "markets": ["crypto"],
    })
    assert response.status_code == 422


def test_financial_mcp_exposes_only_enabled_workspace_tools(workspace_client):
    initialized = workspace_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    })
    assert initialized.status_code == 200
    assert initialized.headers["mcp-session-id"] == "dsa-stateless"

    tools = workspace_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {},
    })
    assert tools.status_code == 200
    tool_names = {item["name"] for item in tools.json()["result"]["tools"]}
    assert "screen_stock_universe" in tool_names

    service = workspace_endpoint._service()
    manifest = service._capability_manifest({
        "skillIds": [],
        "toolIds": ["get_market_indices"],
        "mcpIds": [],
        "dataSourceIds": ["system_market_data"],
        "expertIds": [],
        "expertTeamIds": [],
    })
    policy = build_runtime_capability_policy(
        manifest,
        session_id="mcp-test",
    )

    with patch.object(
        workspace_endpoint.ToolSurface,
        "execute_tool",
        return_value={"ok": True, "result_text": "ok"},
    ) as execute_tool:
        allowed = workspace_client.post("/mcp", json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "get_market_indices",
                "arguments": {
                    "region": "cn",
                    GRANT_ARGUMENT_NAME: policy["gateway_grant"],
                },
            },
        })
    assert allowed.json()["result"]["isError"] is False
    execution_context = execute_tool.call_args.args[2]
    assert execution_context.timeout_seconds is None
    assert execution_context.audit_context["capability_policy_id"] == policy["policy_id"]

    unknown = workspace_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "place_real_order", "arguments": {}},
    })
    assert unknown.json()["error"]["code"] == -32001

    outside_grant = workspace_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {
            "name": "screen_stock_universe",
            "arguments": {GRANT_ARGUMENT_NAME: policy["gateway_grant"]},
        },
    })
    assert outside_grant.json()["error"]["code"] == -32003

    wrong_source_manifest = service._capability_manifest({
        "skillIds": [],
        "toolIds": ["get_market_indices"],
        "mcpIds": [],
        "dataSourceIds": ["system_fundamentals"],
        "expertIds": [],
        "expertTeamIds": [],
    })
    wrong_source_policy = build_runtime_capability_policy(
        wrong_source_manifest,
        session_id="wrong-source",
    )
    wrong_source = workspace_client.post("/mcp", json={
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {
            "name": "get_market_indices",
            "arguments": {GRANT_ARGUMENT_NAME: wrong_source_policy["gateway_grant"]},
        },
    })
    assert wrong_source.json()["error"]["code"] == -32003
    assert "kline" in wrong_source.json()["error"]["message"]
