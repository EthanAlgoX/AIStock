# -*- coding: utf-8 -*-
"""Unit tests for src.services.history_loader (Issue #1066)."""
from __future__ import annotations

import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pandas as pd


class HistoryLoaderTestCase(unittest.TestCase):
    """Tests for load_history_df and frozen target date ContextVar."""

    # ------------------------------------------------------------------
    # ContextVar lifecycle
    # ------------------------------------------------------------------
    def test_frozen_target_date_lifecycle(self):
        from src.services.history_loader import (
            get_frozen_target_date,
            reset_frozen_target_date,
            set_frozen_target_date,
        )

        self.assertIsNone(get_frozen_target_date())
        d = date(2026, 4, 18)
        token = set_frozen_target_date(d)
        self.assertEqual(get_frozen_target_date(), d)
        reset_frozen_target_date(token)
        self.assertIsNone(get_frozen_target_date())

    # ------------------------------------------------------------------
    # DB hit path
    # ------------------------------------------------------------------
    @patch("src.storage.get_db")
    def test_returns_db_data_when_sufficient(self, mock_get_db):
        from src.services.history_loader import load_history_df

        fake_bar = MagicMock()
        fake_bar.to_dict.return_value = {
            "date": "2026-04-18",
            "open": 10,
            "high": 11,
            "low": 9,
            "close": 10.5,
            "volume": 100,
        }
        mock_db = MagicMock()
        mock_db.get_data_range.return_value = [fake_bar] * 40
        mock_get_db.return_value = mock_db

        df, source = load_history_df("600519", days=60, target_date=date(2026, 4, 18))

        self.assertIsNotNone(df)
        self.assertEqual(source, "db_cache")
        self.assertEqual(len(df), 40)
        mock_db.get_data_range.assert_called_once()

    # ------------------------------------------------------------------
    # DB miss → DFM fallback
    # ------------------------------------------------------------------
    @patch("src.services.history_loader._get_fetcher_manager")
    @patch("src.storage.get_db")
    def test_falls_back_to_dfm_when_db_empty(self, mock_get_db, mock_get_fm):
        from src.services.history_loader import load_history_df

        mock_db = MagicMock()
        mock_db.get_data_range.return_value = []
        mock_get_db.return_value = mock_db

        fake_df = pd.DataFrame({"close": [1, 2, 3]})
        fake_df["date"] = pd.date_range("2026-04-16", periods=3)
        mock_fm = MagicMock()
        mock_fm.get_daily_data.return_value = (fake_df, "eastmoney")
        mock_get_fm.return_value = mock_fm

        df, source = load_history_df("600519", days=60, target_date=date(2026, 4, 18))

        self.assertIsNotNone(df)
        self.assertEqual(source, "eastmoney")
        mock_fm.get_daily_data.assert_called_once_with(
            "600519", days=60, preferred_fetcher=None,
            start_date="2025-12-21", end_date="2026-04-18",
        )

    # ------------------------------------------------------------------
    # ContextVar integration
    # ------------------------------------------------------------------
    @patch("src.storage.get_db")
    def test_uses_frozen_target_date_from_contextvar(self, mock_get_db):
        from src.services.history_loader import (
            load_history_df,
            reset_frozen_target_date,
            set_frozen_target_date,
        )

        frozen_date = date(2026, 4, 15)
        token = set_frozen_target_date(frozen_date)
        try:
            mock_db = MagicMock()
            fake_bar = MagicMock()
            fake_bar.to_dict.return_value = {"date": "2026-04-15", "close": 10}
            mock_db.get_data_range.return_value = [fake_bar] * 30
            mock_get_db.return_value = mock_db

            df, source = load_history_df("600519", days=30)

            self.assertEqual(source, "db_cache")
            call_args = mock_db.get_data_range.call_args
            _code, _start, end = call_args[0]
            self.assertEqual(end, frozen_date)
        finally:
            reset_frozen_target_date(token)

    # ------------------------------------------------------------------
    # normalize_stock_code fallback for prefixed codes
    # ------------------------------------------------------------------
    @patch("src.storage.get_db")
    def test_uses_normalize_fallback_for_prefixed_code(self, mock_get_db):
        from src.services.history_loader import load_history_df

        fake_bar = MagicMock()
        fake_bar.to_dict.return_value = {"date": "2026-04-18", "close": 10}

        mock_db = MagicMock()

        def side_effect(code, start, end):
            if code == "SH600519":
                return []
            return [fake_bar] * 30

        mock_db.get_data_range.side_effect = side_effect
        mock_get_db.return_value = mock_db

        df, source = load_history_df("SH600519", days=30, target_date=date(2026, 4, 18))

        self.assertEqual(source, "db_cache")
        self.assertEqual(mock_db.get_data_range.call_count, 2)

    # ------------------------------------------------------------------
    # Both paths fail gracefully
    # ------------------------------------------------------------------
    @patch("src.services.history_loader._get_fetcher_manager")
    @patch("src.storage.get_db")
    def test_graceful_when_both_fail(self, mock_get_db, mock_get_fm):
        from src.services.history_loader import load_history_df

        mock_db = MagicMock()
        mock_db.get_data_range.side_effect = Exception("DB down")
        mock_get_db.return_value = mock_db

        mock_fm = MagicMock()
        mock_fm.get_daily_data.side_effect = Exception("API down")
        mock_get_fm.return_value = mock_fm

        df, source = load_history_df("600519", days=60, target_date=date(2026, 4, 18))

        self.assertIsNone(df)
        self.assertEqual(source, "none")


class FrozenNetworkHistoryTestCase(unittest.TestCase):
    def _manager(self, dates):
        from data_provider.base import BaseFetcher, DataFetcherManager

        class HistoryFetcher(BaseFetcher):
            name = "FrozenNetworkHistoryFetcher"

            def __init__(self):
                self.requests = []

            def _fetch_raw_data(self, stock_code, start_date, end_date):
                self.requests.append((stock_code, start_date, end_date))
                # Some providers return a fixed latest window despite requested bounds.
                return pd.DataFrame([
                    {"date": day, "open": 10, "high": 11, "low": 9,
                     "close": 10.5, "volume": 100}
                    for day in dates
                ])

            def _normalize_data(self, frame, stock_code):
                return frame.copy()

        fetcher = HistoryFetcher()
        return DataFetcherManager(fetchers=[fetcher]), fetcher

    @patch("src.storage.get_db")
    def test_frozen_network_history_excludes_future_bars(self, mock_get_db):
        from src.services.history_loader import (
            load_history_df, reset_frozen_target_date, set_frozen_target_date,
        )

        target = date(2025, 4, 18)
        dates = [target + timedelta(days=offset) for offset in (-2, -1, 0, 1, 2)]
        manager, fetcher = self._manager(dates)
        mock_get_db.return_value.get_data_range.return_value = []
        token = set_frozen_target_date(target)
        try:
            with patch("src.services.history_loader._get_fetcher_manager", return_value=manager):
                frame, source = load_history_df("600519", days=30)
        finally:
            reset_frozen_target_date(token)

        self.assertEqual(fetcher.requests, [
            ("600519", (target - timedelta(days=64)).isoformat(), target.isoformat())
        ])
        self.assertEqual(source, fetcher.name)
        self.assertEqual(list(pd.to_datetime(frame["date"]).dt.date), dates[:3])

    @patch("src.storage.get_db")
    def test_explicit_target_overrides_frozen_date_and_future_only_data_is_unusable(self, mock_get_db):
        from src.services.history_loader import (
            load_history_df, reset_frozen_target_date, set_frozen_target_date,
        )

        target = date(2025, 4, 18)
        manager, fetcher = self._manager([target + timedelta(days=1)])
        mock_get_db.return_value.get_data_range.return_value = []
        token = set_frozen_target_date(date(2026, 4, 18))
        try:
            with patch("src.services.history_loader._get_fetcher_manager", return_value=manager):
                frame, source = load_history_df("600519", days=30, target_date=target)
        finally:
            reset_frozen_target_date(token)

        self.assertEqual(fetcher.requests[0][2], target.isoformat())
        self.assertIsNone(frame)
        self.assertEqual(source, "none")


if __name__ == "__main__":
    unittest.main()
