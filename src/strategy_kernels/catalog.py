"""Static metadata for the three trusted starter kernels."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _digest(module_name: str) -> str:
    path = Path(__file__).with_name(f"{module_name}.py")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _requirement(
    identifier: str,
    data_type: str,
    kind: str,
    source_ids: list[str],
    *,
    required: bool,
    usage: str,
    frequency: str,
    lookback: int | str,
) -> dict[str, Any]:
    return {
        "id": identifier,
        "type": data_type,
        "kind": kind,
        "sourceIds": source_ids,
        "markets": ["cn"],
        "frequency": frequency,
        "lookback": lookback,
        "required": required,
        "usage": usage,
        "onMissing": "fail" if required else "degrade",
    }


COMMON_OPTIONAL_REQUIREMENTS = [
    _requirement(
        "fundamentals",
        "company.fundamentals",
        "fundamentals",
        ["system_fundamentals"],
        required=False,
        usage="补充估值、盈利质量与财务风险证据",
        frequency="latest",
        lookback="latest_available",
    ),
    _requirement(
        "news",
        "market.news",
        "news",
        ["system_news"],
        required=False,
        usage="补充公司事件、行业变化与时效性风险",
        frequency="latest",
        lookback="30d",
    ),
]


def _documentation(name: str, purpose: str, steps: list[str], requirements: list[dict[str, Any]]) -> str:
    rows = "\n".join(
        f"| {item['id']} | {item['kind']} | {'必需' if item['required'] else '可选'} | "
        f"{', '.join(item['sourceIds'])} | {item['frequency']} / {item['lookback']} | {item['usage']} | "
        f"{'停止并返回缺失原因' if item['required'] else '明确降级并继续'} |"
        for item in requirements
    )
    ordered_steps = "\n".join(f"{index}. {step}" for index, step in enumerate(steps, 1))
    return f"""# {name}

## 策略目标

{purpose}

## 数据依赖

| 数据 | 类型 | 要求 | sourceId | 频率 / 回看 | 用途 | 缺失行为 |
| --- | --- | --- | --- | --- | --- | --- |
{rows}

## 处理流程

{ordered_steps}

## 输出与边界

输出严格遵循对应结构化契约，并携带数据覆盖、证据引用和降级警告。策略只产生研究报告、候选清单或研究决策提案，不创建订单、成交、持仓或收益。发布仅表示定义冻结，不代表已经验证有效。
"""


def builtin_kernel_catalog() -> dict[str, dict[str, Any]]:
    research_requirements = [
        _requirement(
            "historical_ohlcv",
            "market.ohlcv",
            "kline",
            ["system_market_data"],
            required=False,
            usage="可用时计算趋势、波动率、均线与其他技术证据；缺失时报告保留数据不足说明并继续",
            frequency="1d",
            lookback=120,
        ),
        *COMMON_OPTIONAL_REQUIREMENTS,
    ]
    screening_requirements = [
        _requirement(
            "market_snapshot",
            "market.snapshot",
            "kline",
            ["system_market_data"],
            required=True,
            usage="构建全市场候选池并执行价格、流动性与估值硬筛",
            frequency="latest",
            lookback="current_session",
        ),
        _requirement(
            "daily_ohlcv",
            "market.ohlcv",
            "kline",
            ["system_market_data"],
            required=False,
            usage="启用日线增强或选用依赖日线因子的筛选配置时计算历史因子；默认 dual_low 可不使用",
            frequency="1d",
            lookback=120,
        ),
        *COMMON_OPTIONAL_REQUIREMENTS,
    ]
    decision_requirements = [
        _requirement(
            "candidate_market_data",
            "market.candidate_input",
            "kline",
            ["system_market_data"],
            required=True,
            usage="筛选股票池时读取全市场快照；固定股票池时校验标的存在本地行情记录",
            frequency="latest",
            lookback="current_session_or_local_history",
        ),
        *COMMON_OPTIONAL_REQUIREMENTS,
    ]
    return {
        "单股研究策略": {
            "module": "single_stock_research",
            "declaredVersion": "2.1.0",
            "entrypoint": "src.strategy_kernels.single_stock_research:run",
            "sha256": _digest("single_stock_research"),
            "dataRequirements": research_requirements,
            "inputSchema": {
                "type": "object",
                "required": ["symbol"],
                "properties": {"symbol": {"type": "string"}, "asOf": {"type": "string"}},
            },
            "outputSchema": {"type": "object", "required": ["status", "contract", "result", "dataCoverage", "warnings"]},
            "documentation": _documentation(
                "单股研究策略",
                "围绕运行时指定的一只股票生成带证据、数据覆盖和风险说明的综合研究报告。",
                ["读取指定股票及平台授权数据", "完成确定性行情与证据处理", "调用成熟单股分析链生成报告", "整理证据引用、覆盖情况与风险说明"],
                research_requirements,
            ),
        },
        "多因子选股策略": {
            "module": "stock_screening",
            "declaredVersion": "2.1.0",
            "entrypoint": "src.strategy_kernels.stock_screening:run",
            "sha256": _digest("stock_screening"),
            "dataRequirements": screening_requirements,
            "inputSchema": {
                "type": "object",
                "properties": {"market": {"type": "string"}, "maxResults": {"type": "integer"}},
            },
            "outputSchema": {"type": "object", "required": ["status", "contract", "result", "dataCoverage", "warnings"]},
            "documentation": _documentation(
                "多因子选股策略",
                "从真实市场快照出发，经硬筛、因子评分、可选 LLM 重排和风险覆盖生成候选清单。",
                ["读取市场快照并形成候选池", "执行确定性硬筛，并按配置选择历史日线增强", "计算因子分数并在可用时进行 LLM 重排", "输出候选依据、风险和降级原因"],
                screening_requirements,
            ),
        },
        "研究决策基线": {
            "module": "research_decision",
            "declaredVersion": "2.1.0",
            "entrypoint": "src.strategy_kernels.research_decision:run",
            "sha256": _digest("research_decision"),
            "dataRequirements": decision_requirements,
            "inputSchema": {
                "type": "object",
                "properties": {"stockCode": {"type": "string"}, "candidates": {"type": "array"}},
            },
            "outputSchema": {"type": "object", "required": ["status", "contract", "result", "dataCoverage", "warnings"]},
            "documentation": _documentation(
                "研究决策基线",
                "把候选与研究证据交给冻结的分析、决策和复盘链，形成可回测的 DecisionProposal。",
                ["形成或接收候选股票", "准备行情、基本面与新闻研究证据", "执行冻结的分析和决策节点", "只读复盘并输出结构化研究决策提案"],
                decision_requirements,
            ),
        },
    }


def builtin_package(
    name: str,
    *,
    purpose: str,
    output_contract: str,
    timeframe: str,
    run_interval: str,
) -> dict[str, Any]:
    item = builtin_kernel_catalog()[name]
    markets = ['cn', 'hk', 'us', 'tw', 'jp', 'kr', 'gb', 'ca', 'au', 'in', 'de', 'fr', 'crypto'] if purpose != "trading_decision" else ["cn"]
    item["dataRequirements"] = [dict(r, markets=markets if r["kind"] in {"kline", "fundamentals"} else ["cn", "hk", "us"]) for r in item["dataRequirements"]]
    immutable_metadata = {
        "markets": markets,
        "declaredVersion": item["declaredVersion"],
        "entrypoint": item["entrypoint"],
        "dataRequirements": item["dataRequirements"],
        "inputSchema": item["inputSchema"],
        "outputSchema": item["outputSchema"],
        "documentation": item["documentation"],
        "purpose": purpose,
        "outputContract": output_contract,
        "timeframe": timeframe,
        "runInterval": run_interval,
    }
    source_hash = hashlib.sha256(
        Path(__file__).with_name(f"{item['module']}.py").read_bytes()
        + json.dumps(immutable_metadata, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "kind": "builtin_python",
        "fileName": f"{item['module']}.py",
        "sha256": source_hash,
        "declaredVersion": item["declaredVersion"],
        "runtime": "python",
        "entrypoint": item["entrypoint"],
        "executionStatus": "ready",
        "purpose": purpose,
        "outputContract": output_contract,
        "configurable": {"markets": markets, "timeframes": [timeframe], "runIntervals": [run_interval]},
        "parameters": [],
        "dataRequirements": item["dataRequirements"],
        "inputSchema": item["inputSchema"],
        "outputSchema": item["outputSchema"],
        "documentation": item["documentation"],
        "dependencyWarnings": [],
    }
