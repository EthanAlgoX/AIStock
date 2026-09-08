# -*- coding: utf-8 -*-
"""Tests for LLM usage dashboard API."""

import tempfile
import unittest
import pytest


@pytest.fixture(autouse=True)
def legacy_auth_mode(monkeypatch, tmp_path):
    """Keep existing business tests in their explicit legacy/no-auth mode."""
    monkeypatch.setenv('ADMIN_ACCESS_MODE', 'legacy')
    monkeypatch.setenv('ADMIN_AUTH_ENABLED', 'false')
    monkeypatch.setenv('ENV_FILE', str(tmp_path / '.env'))
    from src import auth
    monkeypatch.setattr(auth, '_get_data_dir', lambda: tmp_path)
    auth.refresh_auth_state()
    yield
    auth.refresh_auth_state()
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from api.app import create_app
from api.deps import get_database_manager


class FakeUsageDbManager:
    def get_llm_usage_summary(self, from_dt, to_dt):
        return {
            "total_calls": 2,
            "total_prompt_tokens": 30,
            "total_completion_tokens": 70,
            "total_tokens": 100,
            "attributed_calls": 1,
            "unattributed_calls": 1,
            "by_call_type": [
                {
                    "call_type": "analysis",
                    "calls": 2,
                    "prompt_tokens": 30,
                    "completion_tokens": 70,
                    "total_tokens": 100,
                }
            ],
            "by_model": [
                {
                    "model": "openai/gpt-test",
                    "calls": 2,
                    "prompt_tokens": 30,
                    "completion_tokens": 70,
                    "total_tokens": 100,
                    "max_total_tokens": 60,
                }
            ],
        }

    def get_llm_usage_records(self, from_dt, to_dt, limit=50):
        return [
            {
                "id": 7,
                "called_at": datetime(2026, 6, 11, 9, 30, 0),
                "call_type": "analysis",
                "model": "openai/gpt-test",
                "stock_code": "600519",
                "strategy_id": 9,
                "strategy_version_id": 12,
                "strategy_run_id": 21,
                "strategy_batch_id": None,
                "validation_experiment_id": None,
                "usage_scope": "research_run",
                "provider": "openai",
                "language": "zh",
                "market_group": "cn",
                "analysis_mode": "stock_analysis",
                "legacy_prompt_mode": "skill_aware",
                "skill_config_hmac": "a" * 64,
                "transport": "litellm",
                "message_count": 2,
                "estimated_total_prompt_tokens": 2000,
                "approx_common_prefix_chars": 120,
                "approx_common_prefix_tokens": 40,
                "known_dynamic_marker_positions": '[{"marker_name":"stock_code","message_role":"user","char_offset":12}]',
                "prompt_tokens": 10,
                "completion_tokens": 50,
                "total_tokens": 60,
            }
        ]


class UsageDashboardApiTestCase(unittest.TestCase):
    def test_dashboard_returns_token_summary_and_recent_calls(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            app = create_app(static_dir=Path(temp_dir))
            app.dependency_overrides[get_database_manager] = lambda: FakeUsageDbManager()
            client = TestClient(app)

            response = client.get("/api/v1/usage/dashboard?period=today&limit=10")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["period"], "today")
        self.assertEqual(body["total_tokens"], 100)
        self.assertEqual(body["attributed_calls"], 1)
        self.assertEqual(body["unattributed_calls"], 1)
        self.assertEqual(body["by_model"][0]["model"], "openai/gpt-test")
        self.assertEqual(body["by_model"][0]["max_total_tokens"], 60)
        self.assertNotIn("provider", body["by_model"][0])
        self.assertNotIn("context_window", body["by_model"][0])
        self.assertNotIn("context_usage_ratio", body["by_model"][0])
        self.assertEqual(body["recent_calls"][0]["stock_code"], "600519")
        self.assertEqual(body["recent_calls"][0]["strategy_version_id"], 12)
        self.assertEqual(body["recent_calls"][0]["strategy_run_id"], 21)
        p05a_internal_fields = {
            "provider",
            "language",
            "market_group",
            "analysis_mode",
            "legacy_prompt_mode",
            "skill_config_hmac",
            "transport",
            "message_count",
            "estimated_total_prompt_tokens",
            "approx_common_prefix_chars",
            "approx_common_prefix_tokens",
            "known_dynamic_marker_positions",
        }
        self.assertTrue(p05a_internal_fields.isdisjoint(body["recent_calls"][0]))
        self.assertNotIn("context_window", body["recent_calls"][0])
        self.assertNotIn("context_usage_ratio", body["recent_calls"][0])


if __name__ == "__main__":
    unittest.main()
