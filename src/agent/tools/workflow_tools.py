"""Agent access to published research workflows; execution stays in strategy kernels."""

from contextvars import ContextVar

from src.agent.tools.execution import check_tool_execution
from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolPolicy
from src.services.strategy_definition_service import StrategyDefinitionService
from src.services.strategy_kernel_executor_service import StrategyKernelExecutorService


CONTRACTS = {"research_report": "ResearchReport", "candidate_screening": "CandidateList"}
_ACTIVE_WORKFLOW = ContextVar("active_research_workflow", default=False)
# Set only by the in-process workspace executor, never from an API session ID.
ACTIVE_WORKSPACE_RUN = ContextVar("active_workspace_run", default=None)


def list_research_workflows() -> dict:
    """Discover executable configurations without creating or publishing strategies."""
    check_tool_execution()
    service = StrategyDefinitionService()
    items = []
    for strategy in service.list_strategies():
        purpose = strategy.get("currentStrategyPurpose")
        version_id = strategy.get("currentPublishedVersionId")
        if (purpose not in CONTRACTS or not version_id
                or strategy.get("productRole") == "kernel"
                or strategy.get("kernelExecutionStatus") != "ready"):
            continue
        version = service.get_version(version_id)
        items.append({
            "versionId": version_id, "name": strategy["name"],
            "purpose": purpose, "contract": CONTRACTS[purpose],
            "objective": version.get("objective"),
            "marketScope": version.get("marketScope"),
            "screeningPolicy": version.get("screeningPolicy"),
            "dataRequirements": (version.get("strategyPackage") or {}).get("dataRequirements", []),
        })
    return {"items": items, "message": "没有可执行配置，请打开个股分析或选股页面加载内置策略目录。" if not items else ""}


def execute_research_workflow(version_id: int, purpose: str, inputs: dict, *, market: str | None = None) -> dict:
    check_tool_execution()
    if _ACTIVE_WORKFLOW.get():
        raise ValueError("研究工作流内部不能再次启动研究工作流；请使用当前证据。")
    service = StrategyDefinitionService()
    version = service.get_version(version_id)
    if version.get("strategyPurpose") != purpose or version.get("outputContract") != CONTRACTS[purpose]:
        raise ValueError("策略类型与任务不匹配，请重新选择已发布的研究或选股策略。")
    configured_market = str((version.get("screeningPolicy") or {}).get("market") or "").lower()
    if market and configured_market != market.lower():
        raise ValueError("任务市场与正式策略市场不一致，请选择匹配市场的策略。")
    if purpose == "research_report":
        from src.core.trading_calendar import get_market_for_stock

        stock_market = get_market_for_stock(inputs.get("symbol"))
        if stock_market is None or stock_market != configured_market:
            raise ValueError("股票市场与正式策略市场不一致，或股票代码无法识别。")
    token = _ACTIVE_WORKFLOW.set(True)
    try:
        result = StrategyKernelExecutorService(service).execute_product(version_id, inputs)
    finally:
        _ACTIVE_WORKFLOW.reset(token)
    check_tool_execution()
    return {**result, "workflowVersionId": version_id}


def run_stock_research(strategy_version_id: int, stock_code: str) -> dict:
    if not stock_code.strip():
        raise ValueError("单股研究需要股票代码。")
    return _run_tracked_workflow(strategy_version_id, "research_report", {"symbol": stock_code.strip()}, {"stock": stock_code.strip()})


def run_stock_screening(strategy_version_id: int) -> dict:
    return _run_tracked_workflow(strategy_version_id, "candidate_screening", {}, {})


def _run_tracked_workflow(version_id, purpose, inputs, subject):
    check_tool_execution()
    from src.services.workspace_service import WorkspaceService
    from src.services.workspace_external_runs import begin, execute
    workspace = WorkspaceService()
    kind = 'research' if purpose == 'research_report' else 'screening'
    parent_id = ACTIVE_WORKSPACE_RUN.get()
    version = StrategyDefinitionService(workspace.db).get_version(version_id)
    market = str((version.get('screeningPolicy') or {}).get('market') or '').upper()
    if parent_id:
        parent = workspace.get_run(parent_id)
        from src.services.workspace_inputs import stock_code
        same_stock = kind != 'research' or stock_code((parent['taskSnapshot'].get('subject') or {}).get('stock', '')) == stock_code(subject.get('stock', ''))
        if parent['kind'] == kind and parent['taskSnapshot'].get('market') == market and same_stock:
            return _record_chat_result(execute_research_workflow(version_id, purpose, inputs), subject)
    run_id = begin(workspace, kind, '主 Agent · ' + ('个股研究' if kind == 'research' else '选股'),
                   market, subject, {'strategyVersionId': version_id}, parent=parent_id)
    result = execute(workspace, run_id, lambda: execute_research_workflow(version_id, purpose, inputs), CONTRACTS[purpose])
    return {**result, 'workspaceRunId': run_id, 'reportUrl': f'/runs/{run_id}'}


def _record_chat_result(result: dict, subject: dict) -> dict:
    if result.get("status") != "success":
        return result
    from src.services.workspace_service import WorkspaceService

    run_id = WorkspaceService().record_workflow_result(result, subject, parent_run_id=ACTIVE_WORKSPACE_RUN.get())
    return {**result, "workspaceRunId": run_id, "reportUrl": f"/runs/{run_id}"}


_RUN_POLICY = ToolPolicy.declared(
    read_only=False, side_effects=["network_read", "compute", "llm_call", "database_write"],
    permissions=["market_data:read", "research:execute"],
)

ALL_WORKFLOW_TOOLS = [
    ToolDefinition(
        name="list_research_workflows",
        description="List published single-stock research and screening workflows with frozen parameters and data requirements. Discover actual version IDs before running; never invent or publish a strategy.",
        parameters=[], handler=list_research_workflows, category="research",
        policy=ToolPolicy.declared(read_only=True, permissions=["research:read"]),
    ),
    ToolDefinition(
        name="run_stock_research",
        description="Run a published single-stock workflow: real data, deterministic technical analysis, configured LLM/Agent synthesis, and a structured ResearchReport saved in analysis history. Use once for comprehensive research, then discuss returned evidence; rerun only for a requested refresh. Failures are not reports. The built-in research pipeline uses platform-managed data providers.",
        parameters=[
            ToolParameter("strategy_version_id", "integer", "Published research_report version ID from list_research_workflows."),
            ToolParameter("stock_code", "string", "Exact stock code to research."),
        ], handler=run_stock_research, category="research",
        policy=ToolPolicy.declared(
            read_only=False, side_effects=list(_RUN_POLICY.side_effects),
            permissions=list(_RUN_POLICY.permissions), scope_dimensions=["stock"],
        ),
    ),
    ToolDefinition(
        name="run_stock_screening",
        description="Run a published screening workflow using its frozen market, filters, factor scores, candidate limit and risk rules. Return a factual CandidateList; preserve candidate identities, scores and warnings. For deep research, separately run_stock_research only for requested candidates. Data access follows the selected strategy's frozen permissions.",
        parameters=[ToolParameter("strategy_version_id", "integer", "Published candidate_screening version ID from list_research_workflows.")],
        handler=run_stock_screening, category="research", policy=_RUN_POLICY,
    ),
]
