"""Regression coverage for as-of data and incomplete risk evidence."""
from datetime import date

from src.storage import DatabaseManager, StockDaily
from src.services.screening.models import Pick
from src.services.screening.risk import apply_risk_overlay


def test_historical_context_never_reads_bars_after_target(tmp_path):
    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / 'asof.db'}")
    with db.get_session() as session:
        for day, price in [(3, 100), (4, 101), (7, 200)]:
            session.add(StockDaily(code="600519", date=date(2026, 9, day),
                                   close=price, volume=100, ma5=99, ma10=98, ma20=97))
        session.commit()
    context = db.get_analysis_context("600519", target_date=date(2026, 9, 6))
    assert context["date"] == "2026-09-04"
    assert context["today"]["close"] == 101
    assert context["yesterday"]["date"] == date(2026, 9, 3)
    assert db.get_analysis_context("600519", target_date=date(2026, 9, 2)) is None
    assert db.get_analysis_context("missing", target_date=date(2026, 9, 6)) is None


def test_no_risk_penalty_does_not_mean_low_risk_without_evidence():
    picks, _ = apply_risk_overlay([Pick(rank=1, code="600519", name="Sample", screen_score=80, final_score=80)])
    assert picks[0].risk_level == "unknown"
    assert any(flag.startswith("risk_coverage_incomplete:") for flag in picks[0].risk_flags)


def test_known_high_risk_remains_high_even_with_missing_evidence():
    picks, _ = apply_risk_overlay([Pick(rank=1, code="600519", name="Sample", screen_score=80,
                                        final_score=80, change_pct=20, volume_ratio=10, turnover_rate=20)])
    assert picks[0].risk_level == "high"


def test_invalid_prices_are_removed_from_persisted_report_and_columns(tmp_path):
    import json
    from src.analyzer import AnalysisResult
    from src.storage import AnalysisHistory

    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / 'report.db'}")
    result = AnalysisResult(
        code="600519", name="Sample", sentiment_score=85, trend_prediction="看多",
        operation_advice="买入", action="buy", dashboard={"battle_plan": {
            "sniper_points": {"ideal_buy": 85.4, "stop_loss": 85.4, "take_profit": 88.74},
        }},
    )
    row_id = db.save_analysis_history(result, "invalid-plan", "full", None)
    assert row_id > 0
    with db.get_session() as session:
        row = session.get(AnalysisHistory, row_id)
        assert row.ideal_buy is None
        assert row.stop_loss is None
        raw = json.loads(row.raw_result)
        assert raw["action"] == "watch"
        assert raw["dashboard"]["battle_plan"]["price_validation"]["status"] == "invalid"
