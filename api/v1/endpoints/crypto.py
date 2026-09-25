"""Read-only spot research and simulated strategy replay."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict

from src.services.crypto_market_service import (
    CORE_SYMBOLS, HOUR_MS, asset_detail, fetch_hourly, live_replay,
    market_overview, screen, validate_symbol,
)

router = APIRouter()


class ScreenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    symbols: list[str] = Field(default_factory=lambda: list(CORE_SYMBOLS), min_length=1, max_length=5)
    lookbackHours: int = Field(720, ge=24, le=1440)
    topN: int = Field(3, ge=1, le=5)


class BacktestRequest(ScreenRequest):
    strategy: Literal["selection_hold", "equal_weight", "btc_half"] = "selection_hold"
    startDate: date | None = None
    endDate: date | None = None
    initialCash: float = Field(10000, gt=0, le=100000000)
    feeRate: float = Field(.001, ge=0, le=.05)
    slippageRate: float = Field(.0005, ge=0, le=.05)
    allocation: float = Field(.5, gt=0, le=1)
    rebalanceHours: int = Field(168, ge=1, le=720)


def _symbols(items: list[str]) -> list[str]:
    result = [validate_symbol(item) for item in items]
    if len(result) != len(set(result)):
        raise ValueError("Choose unique spot pairs")
    return result


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=422 if isinstance(exc, ValueError) else 503, detail=str(exc))


@router.get("/market")
def market():
    try:
        return market_overview()
    except Exception as exc:
        raise _bad_request(exc) from exc


@router.get("/assets/{symbol}")
def asset(symbol: str, hours: int = 168):
    if not 24 <= hours <= 720:
        raise HTTPException(422, "Choose 24–720 hours")
    try:
        return asset_detail(symbol, hours)
    except Exception as exc:
        raise _bad_request(exc) from exc


@router.post("/screen")
def screen_assets(body: ScreenRequest):
    try:
        symbols = _symbols(body.symbols)
        end = int(datetime.now(timezone.utc).timestamp() * 1000) // HOUR_MS * HOUR_MS
        data = {symbol: fetch_hourly(symbol, end - body.lookbackHours * HOUR_MS, end)
                for symbol in symbols}
        result = screen(data, symbols, body.lookbackHours, body.lookbackHours, body.topN)
        return {**result, "market": "CRYPTO", "source": "Binance Spot", "quoteAsset": "USDT",
                "universe": symbols, "universePolicy": "fixed_current_selection"}
    except Exception as exc:
        raise _bad_request(exc) from exc


@router.post("/backtest")
def backtest(body: BacktestRequest):
    try:
        symbols = _symbols(body.symbols)
        today = datetime.now(timezone.utc).date()
        end_date = body.endDate or today
        start_date = body.startDate or end_date - timedelta(days=30)
        start = datetime.combine(start_date, time.min, timezone.utc)
        end = datetime.combine(end_date, time.min, timezone.utc)
        return live_replay(symbols, start, end, strategy=body.strategy,
                           initial_cash=body.initialCash, fee_rate=body.feeRate,
                           slippage_rate=body.slippageRate, allocation=body.allocation,
                           rebalance_hours=body.rebalanceHours, lookback=body.lookbackHours,
                           top_n=body.topN)
    except Exception as exc:
        raise _bad_request(exc) from exc
