"""Trusted adapter for the mature single-stock research pipeline."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def run(context: dict[str, Any]) -> dict[str, Any]:
    inputs = context.get("inputs") if isinstance(context.get("inputs"), dict) else {}
    symbol = str(inputs.get("symbol") or inputs.get("stockCode") or inputs.get("stock_code") or "").strip()
    if not symbol:
        return {
            "status": "failed",
            "contract": "ResearchReport",
            "reasonCode": "REQUIRED_INPUT_MISSING",
            "message": "单股研究需要 symbol。",
            "missingInputs": ["symbol"],
            "dataCoverage": context.get("dataCoverage") or {},
            "warnings": [],
        }
    from src.services.analysis_service import AnalysisService

    parameters = context.get("parameters") if isinstance(context.get("parameters"), dict) else {}
    skills = parameters.get("skills") or inputs.get("skills")
    if skills is not None:
        from src.agent.factory import get_skill_manager
        available = {skill.name for skill in get_skill_manager().list_skills()}
        if not isinstance(skills, list) or not skills or any(not isinstance(skill, str) or skill not in available for skill in skills):
            raise ValueError("研究策略必须引用已加载的 Skill，不能静默退回默认策略。")
    analysis_mode = parameters.get("analysisMode", "standard")
    if analysis_mode not in {"standard", "agent"}:
        raise ValueError("analysisMode must be standard or agent")
    service = AnalysisService()
    result = service.analyze_stock(
        stock_code=symbol,
        report_type=str(parameters.get("reportType") or "detailed"),
        force_refresh=bool(parameters.get("forceRefresh", False)),
        query_id=str(context.get("runId") or "") or None,
        send_notification=False,
        analysis_phase=str(parameters.get("analysisPhase") or "auto"),
        query_source="strategy_kernel",
        agent_mode=analysis_mode == "agent",
        skills=skills,
    )
    if result is None:
        return {
            "status": "failed",
            "contract": "ResearchReport",
            "reasonCode": "RESEARCH_PIPELINE_FAILED",
            "message": service.last_error or "单股研究链路未返回报告。",
            "missingInputs": [],
            "dataCoverage": context.get("dataCoverage") or {},
            "warnings": [],
        }
    return {
        "status": "success",
        "contract": "ResearchReport",
        "strategyId": context.get("strategyId"),
        "strategyVersion": context.get("strategyVersion"),
        "asOf": context.get("asOf") or datetime.now(timezone.utc).isoformat(),
        "result": result,
        "researchSkills": skills or [],
        "dataCoverage": {
            key: {**value, "configured": value.get("available"), "available": None, "verification": "see_run_diagnostics"}
            for key, value in (context.get("dataCoverage") or {}).items()
        },
        "warnings": list(context.get("warnings") or []) + [
            "单股内核使用平台行情与新闻路由；配置声明不等于抓取成功，请以报告运行诊断判断数据覆盖。",
        ],
        "evidenceRefs": ([{"type": "analysis_history", "queryId": result["query_id"], "stockCode": symbol}]
                         if result.get("query_id") else []),
    }
