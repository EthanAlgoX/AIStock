"""Non-destructive grouping of legacy tool reports with their invoking runs."""

import json
import re

from data_provider.base import normalize_stock_code


def annotate_report_history(items: list[dict]) -> None:
    """Link only exact references to matching tool reports created during a run.

    Never merge by company name or proximity alone. Ambiguous/multi-report runs
    remain independent. The run ledger and stored artifacts are unchanged.
    """
    by_id = {item["id"]: item for item in items}
    for source in items:
        if source["status"] in {"queued", "running"} or source["triggerType"] == "agent_tool":
            continue
        if any(a.get("type") in {"ResearchReport", "CandidateList"}
               and isinstance(a.get("content"), dict) and a["content"].get("status") == "success"
               and isinstance(a["content"].get("result"), dict) for a in source["artifacts"]):
            continue
        references = set()
        for artifact in source["artifacts"]:
            references.update(re.findall(r"/runs/([a-f0-9]{32})(?![a-f0-9])",
                                         (artifact.get("text") or "") + json.dumps(artifact.get("content"), ensure_ascii=False)))
        matches = []
        for run_id in references:
            target = by_id.get(run_id)
            if not target or target["triggerType"] != "agent_tool" or target["kind"] != source["kind"]:
                continue
            if target.get("outcome", {}).get("status") not in {"produced", "empty"}:
                continue
            original, formal = source["taskSnapshot"], target["taskSnapshot"]
            if original.get("market") != formal.get("market"):
                continue
            start, end = source.get("startedAt") or source["createdAt"], source.get("completedAt")
            if not end or not start <= target["createdAt"] <= end:
                continue
            if source["kind"] == "research":
                left = original.get("subject", {}).get("stock")
                right = formal.get("subject", {}).get("stock")
                if not left or not right or normalize_stock_code(left) != normalize_stock_code(right):
                    continue
            matches.append(target)
        if len(matches) == 1:
            target = matches[0]
            source["primaryReportRunId"] = target["id"]
            target.setdefault("relatedRunIds", []).append(source["id"])
            target.setdefault("reportTitle", source["taskSnapshot"].get("name"))
