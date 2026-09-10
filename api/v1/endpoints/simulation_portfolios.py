"""Workspace-scoped executable rule portfolios; never accepts executable code."""

from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.simulation_portfolio_engine import TEMPLATES, BENCHMARKS

router = APIRouter()


class StrategyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=80)
    template: Literal["volume_breakout", "shrink_pullback", "low_volatility_quality"]
    market: Literal["CN", "US", "HK"]
    symbols: list[str] = Field(min_length=1, max_length=12)
    initialCash: float = Field(default=100000, ge=1000, le=100000000)
    maxPositions: int = Field(default=3, ge=1, le=12)
    maxWeight: float = Field(default=0.25, ge=0.01, le=1)
    lotSize: int = Field(default=100, ge=1, le=10000)
    commissionRate: float = Field(default=0.0003, ge=0, le=0.05)
    sellTaxRate: float = Field(default=0, ge=0, le=0.05)
    slippageRate: float = Field(default=0.001, ge=0, le=0.05)
    riskFreeRate: float = Field(default=0, ge=-0.1, le=0.3)


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


class Control(BaseModel):
    action: Literal["start", "pause", "run"]


def call(fn, *args):
    try:
        return fn(*args)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/templates")
def templates():
    return {
        "items": TEMPLATES,
        "benchmarks": {k: {"code": v[0], "name": v[1], "currency": v[2]} for k, v in BENCHMARKS.items()},
    }


@router.get("")
def portfolios():
    return {"items": SimulationPortfolioService().list()}


@router.post("")
def create(body: PortfolioCreate):
    return call(SimulationPortfolioService().create, body.model_dump())


@router.get("/definitions")
def definitions():
    return {"items": SimulationPortfolioService().definitions()}


@router.post("/definitions")
def save_definition(body: StrategyConfig):
    return call(SimulationPortfolioService().save_definition, body.model_dump())


@router.post("/definitions/{definition_id}/validations")
def create_validation(definition_id: int, body: ValidationCreate):
    return call(SimulationPortfolioService().create_validation, definition_id, body.model_dump())


@router.get("/{portfolio_id}")
def detail(portfolio_id: int):
    return call(SimulationPortfolioService().detail, portfolio_id)


@router.post("/{portfolio_id}/control")
def control(portfolio_id: int, body: Control):
    return call(SimulationPortfolioService().control, portfolio_id, body.action)
