"""Business outcomes are separate from executor completion, including legacy runs."""

from __future__ import annotations

import json
import re
from typing import Any


def normalize_trade_proposal(value: Any) -> dict:
    """Adapt known report field aliases, never infer positions or execution."""
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    rows = value.get("actions", value.get("proposals"))
    if isinstance(rows, list):
        result["actions"] = [dict(row, symbol=row.get("symbol") or row.get("code") or row.get("ticker"))
                             if isinstance(row, dict) else row for row in rows]
    return result


def report_artifacts(kind: str, artifacts: list[dict]) -> list[dict]:
    """Read-time compatibility; retain original records and model claims as data."""
    if kind != "trading" or any(a.get("type") == "TradeProposal" for a in artifacts):
        return artifacts
    for source in artifacts:
        content = source.get("content")
        if source.get("type") != "AgentResponse" or not isinstance(content, dict):
            continue
        proposal = normalize_trade_proposal(content.get("TradeProposal"))
        if valid_artifact("TradeProposal", proposal):
            derived = {**source, "id": source["id"] + "-proposal", "type": "TradeProposal",
                       "title": "模拟交易研究报告", "content": proposal, "text": None}
            risk = content.get("RiskAssessment")
            if isinstance(risk, dict):
                derived["content"] = {**proposal, "agentRiskDiscussion": risk}
            return [derived, *artifacts]
    return artifacts


def valid_artifact(kind: str, value: Any) -> bool:
    """Validate minimum product structure, not the truth of financial claims."""
    if not isinstance(value, dict) or not value or _reported_block(value):
        return False
    if kind == "CandidateList":
        rows = value.get("candidates")
        return isinstance(rows, list) and all(
            isinstance(row, dict) and isinstance(row.get("code", row.get("symbol")), str)
            and bool(row.get("code", row.get("symbol", "")).strip()) for row in rows
        )
    if kind == "TradeProposal":
        rows = normalize_trade_proposal(value).get("actions")
        return isinstance(rows, list) and all(
            isinstance(row, dict) and bool(row.get("symbol") or row.get("code"))
            and bool(row.get("side") or row.get("action")) for row in rows
        )
    if kind == "ScreenSpec":
        return any(key in value for key in ("filters", "market", "strategyVersionId", "conditions"))
    return any(isinstance(value.get(key), str) and value[key].strip()
               for key in ("conclusion", "summary", "analysis_summary", "content"))


def _reported_block(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if any(str(value.get(key, "")).lower() in {"blocked", "not_executed", "unsupported", "failed", "error", "failed_no_candidates"}
           for key in ("status", "executionStatus", "execution_status")):
        return True
    return any(_reported_block(value.get(key)) for key in (
        "CandidateList", "ResearchReport", "TradeProposal", "result", "execution",
    ))


def business_outcome(status: str, kind: str, artifacts: list[dict], *, formal: bool = False) -> dict:
    """Read persisted evidence conservatively without rewriting historical records."""
    def result(state: str, message: str) -> dict:
        return {"status": state, "message": message}

    if status in {"queued", "running"}:
        return result("pending", "任务尚未结束。")
    payloads = []
    for artifact in artifacts:
        payloads.append(artifact.get("content"))
        # Legacy Markdown may contain a structured not_executed result. Never
        # infer success/failure from arbitrary prose or keyword matches.
        for block in re.findall(r"```(?:json)?\s*(.*?)```", artifact.get("text") or "", re.DOTALL | re.IGNORECASE):
            try:
                payloads.append(json.loads(block))
            except (ValueError, TypeError):
                continue
    formal_results = [a for a in artifacts if formal and a.get("type") in {"ResearchReport", "CandidateList"}
                      and isinstance(a.get("content"), dict) and a["content"].get("status") == "success"
                      and isinstance(a["content"].get("result"), dict)]
    if status in {"failed", "cancelled"}:
        if formal_results:
            return result("partial", "研究成果已保存，但后续解读或评审未完成；可阅读已产出部分。")
        return result("cancelled" if status == "cancelled" else "failed", "任务未完成，请查看运行原因。")
    if any(_reported_block(value) for value in payloads):
        if formal_results:
            return result("partial", "正式策略成果已保存，但后续说明记录了未完成事项，请核对缺失与风险。")
        return result("blocked", "运行已结束，但报告记录了未执行或能力受限；不代表已完成研究目标。")
    if formal_results:
        if any(a.get("type") == "CandidateResearch" and isinstance(a.get("content"), dict)
               and (not isinstance(a["content"].get("report"), dict)
                    or a["content"]["report"].get("status") != "success") for a in artifacts):
            return result("partial", "筛选报告已保存，部分候选深研未完成；原排名不变，失败原因见逐股报告。")
        candidates = [a["content"]["result"] for a in formal_results if a["type"] == "CandidateList"]
        if candidates:
            if not all(valid_artifact("CandidateList", candidate) for candidate in candidates):
                return result("unverified", "筛选结果结构不完整，请核对运行详情。")
            if not any(candidate["candidates"] for candidate in candidates):
                return result("empty", "筛选已执行，本次没有符合策略条件的候选。")
        elif not any(isinstance(a["content"]["result"].get("report"), dict)
                     and a["content"]["result"]["report"].get("summary") for a in formal_results):
            return result("unverified", "正式报告结构不完整，请核对运行详情。")
        return result("produced", "已生成正式策略成果；投资判断仍需结合证据与风险核实。")
    if kind == "trading" and any(a.get("type") == "TradeProposal" and valid_artifact("TradeProposal", a.get("content")) for a in artifacts):
        return result("proposal", "仅生成交易提案，尚未完成账户风控评估，也未创建订单或模拟成交。")
    if kind == "expert_review" and any(a.get("type") == "ExpertReview" for a in artifacts):
        return result("produced", "已生成独立专家意见与主持汇总，不代表独立数据验证或多轮辩论。")
    return result("unverified", "运行已结束；成果尚未通过正式工作流验证，请核对正文、来源与缺失说明。")
