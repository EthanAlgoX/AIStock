"""Workspace-scoped executable rule portfolios; never accepts executable code."""

from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from src.schemas.jev_task import JevTaskConfig
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.simulation_portfolio_engine import BENCHMARKS

router = APIRouter()


class StrategyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=80)
    template: Literal["agent"] = "agent"
    market: Literal["CN", "US", "HK"]
    symbols: list[str] = Field(default_factory=list, max_length=12)
    engine: Literal['agent'] = 'agent'
    decisionBackend: Literal['llm', 'jev'] = 'llm'
    jevTask: JevTaskConfig = Field(default_factory=JevTaskConfig)
    jevWeightStep: float = Field(default=0.05, ge=0.001, le=1)
    skillId: str | None = None
    systemPrompt: str = Field(default='', max_length=6000)
    universePreviewId: int | None = None
    scopeRefresh: Literal['snapshot', 'daily', 'weekly'] = 'snapshot'
    runTokenBudget: int = Field(default=100000, ge=10000, le=500000)
    initialCash: float = Field(default=100000, ge=1000, le=100000000)
    maxPositions: int = Field(default=3, ge=1, le=12)
    maxWeight: float = Field(default=0.25, ge=0.01, le=1)
    lotSize: int = Field(default=100, ge=1, le=10000)
    commissionRate: float = Field(default=0.0003, ge=0, le=0.05)
    sellTaxRate: float = Field(default=0, ge=0, le=0.05)
    slippageRate: float = Field(default=0.001, ge=0, le=0.05)
    riskFreeRate: float = Field(default=0, ge=-0.1, le=0.3)
    gridLookbackDays: int = Field(default=5, ge=3, le=20)
    gridMinVolumeRatio: float = Field(default=1.3, ge=1, le=10)
    gridMinRange: float = Field(default=0.05, ge=0.005, le=0.5)
    gridLevels: int = Field(default=5, ge=2, le=10)


class PortfolioCreate(StrategyConfig):
    mode: Literal["paper", "backtest"] = "paper"
    startDate: str | None = None
    endDate: str | None = None


class ValidationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["paper", "backtest"]
    initialCash: float = Field(default=100000, ge=1000, le=100000000)
    startDate: str | None = None
    endDate: str | None = None
    historyMode: Literal["rules", "ai_replay"] = "rules"
    universeHistory: Literal["frozen", "recorded"] = "frozen"


class Scope(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['fixed', 'holdings', 'custom']
    symbols: list[str] = Field(default_factory=list, max_length=12)
    accountId: int | None = None
    query: str = Field(default='', max_length=500)
    industries: list[str] = Field(default_factory=list, max_length=24)
    allIndustries: bool = False
    maxCandidates: int = Field(default=12, ge=1, le=12)


class UniversePreview(BaseModel):
    market: Literal['CN', 'US', 'HK']
    scope: Scope


class Control(BaseModel):
    action: Literal["start", "pause", "run", "stop"]


def call(fn, *args):
    try:
        return fn(*args)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("")
def portfolios():
    return {"items": SimulationPortfolioService().list()}


@router.post("")
def create(body: PortfolioCreate):
    return call(SimulationPortfolioService().create, body.model_dump())


@router.get('/agent-options')
def agent_options():
    from src.services.workspace_service import WorkspaceService
    from src.services.portfolio_service import PortfolioService
    from src.services.trading_agent_service import TRADING_PROMPT
    from src.config import get_config
    config = get_config()
    return dict(decisionModels=[
        dict(id="llm", available=True),
        dict(id="jev", available=bool(config.typesafe_api_key.strip()), model=config.typesafe_model),
    ], skills=[s for s in WorkspaceService().list_skills() if s['enabled']],
                accounts=PortfolioService().list_accounts(), defaultPrompt=TRADING_PROMPT)


@router.get('/holdings/{account_id}')
def holdings(account_id: int):
    from src.services.trading_agent_service import TradingAgentService
    return {'items': call(TradingAgentService().holdings, account_id)}


@router.post('/universe-preview')
def preview_universe(body: UniversePreview):
    from src.services.trading_agent_service import TradingAgentService
    return call(TradingAgentService().preview, body.market, body.scope.model_dump())


@router.get("/definitions")
def definitions():
    return {"items": SimulationPortfolioService().definitions()}


@router.post("/definitions")
def save_definition(body: StrategyConfig):
    return call(SimulationPortfolioService().save_definition, body.model_dump())


@router.post("/definitions/{definition_id}/stop")
def stop_definition(definition_id: int):
    return call(SimulationPortfolioService().control_definition, definition_id)


@router.delete("/definitions/{definition_id}")
def delete_definition(definition_id: int):
    return call(lambda: SimulationPortfolioService().control_definition(definition_id, remove=True))


@router.delete("/{portfolio_id}")
def delete_portfolio(portfolio_id: int):
    return call(SimulationPortfolioService().delete_portfolio, portfolio_id)


@router.post("/definitions/{definition_id}/validations")
def create_validation(definition_id: int, body: ValidationCreate):
    return call(SimulationPortfolioService().create_validation, definition_id, body.model_dump())


@router.get("/{portfolio_id}")
def detail(portfolio_id: int):
    return call(SimulationPortfolioService().detail, portfolio_id)


@router.post("/{portfolio_id}/control")
def control(portfolio_id: int, body: Control):
    return call(SimulationPortfolioService().control, portfolio_id, body.action)
