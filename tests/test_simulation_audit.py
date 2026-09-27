import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select
from src.repositories.simulation_audit_repo import records
from src.services.trading_agent_service import TradingAgentService
from src.services.jev_decision_service import JevDecisionService
from src.services.simulation_research_service import SimulationResearchService
from src.storage import SimulationTradingCallRecord, SimulationTradingCallEvidenceRecord, SimulationAuditEventRecord
from tests.test_workspace_service import workspace  # noqa: F401
from tests.test_simulation_research import completed  # noqa: F401
from tests.test_jev_decisions import jev_config, http_result, inputs  # noqa: F401


def test_failed_llm_keeps_transport_options_and_provider_evidence(workspace):
    response = SimpleNamespace(content='', reasoning_content='provider diagnostic', usage={'total_tokens':12},
        model='fixture', provider='test', raw={'choices':[{'finish_reason':'length'}], 'api_key':'never-save'})
    agent = TradingAgentService(workspace.db, SimpleNamespace(call_text=lambda *a, **kw: response))
    with pytest.raises(ValueError, match='完整回答'):
        agent.call('system', {'date':'2025-01-01'}, 10000)
    with workspace.db.get_session() as session:
        call = session.scalar(select(SimulationTradingCallRecord))
        extra = session.get(SimulationTradingCallEvidenceRecord, call.id)
        assert call.status == 'failed' and extra.completed_at is not None
        assert json.loads(extra.request_json)['maxTokens'] == 4096
        raw = json.loads(extra.response_json)
        assert raw['raw']['choices'][0]['finish_reason'] == 'length'
        assert raw['reasoning_content'] == 'provider diagnostic'
        assert 'never-save' not in extra.response_json


def test_jev_non_json_http_failure_is_retained(workspace, jev_config):
    response = http_result(None, 503)
    response.text = 'upstream unavailable'
    with patch('requests.post', return_value=response), pytest.raises(ValueError, match='HTTP 503'):
        JevDecisionService(jev_config).evaluate(workspace.db, inputs(), 'skill', 'fixture', 100000, 'test', None)
    with workspace.db.get_session() as session:
        call = session.scalar(select(SimulationTradingCallRecord))
        extra = session.get(SimulationTradingCallEvidenceRecord, call.id)
        assert json.loads(extra.response_json)['responseText'] == 'upstream unavailable'
        assert json.loads(extra.response_json)['httpStatus'] == 503
        assert 'test-secret' not in extra.request_json + extra.response_json


@pytest.mark.parametrize('completed', ['crypto_btc_hold'], indirect=True)
def test_research_failure_keeps_completed_days_and_paginated_events(completed):
    service, ident = completed
    from src.services.simulation_research_service import step
    count = 0
    def fail_after_two(*args):
        nonlocal count
        count += 1
        if count == 3:
            raise ValueError('fixture failure')
        return step(*args)
    with patch('src.services.simulation_research_service.step', side_effect=fail_after_two):
        with pytest.raises(ValueError, match='fixture failure'):
            SimulationResearchService(service.db).create(ident)
    with service.db.get_session() as session:
        rows = session.scalars(select(SimulationAuditEventRecord).where(
            SimulationAuditEventRecord.action.like('research.%'))).all()
        assert len({row.request_id for row in rows}) == 1
        assert sum(row.action == 'research.day' for row in rows) == 2
        assert rows[-1].action == 'research.failed'
    page = records(service.db, ident, 'events', limit=2)
    assert page['nextCursor'] is not None
    second = records(service.db, ident, 'events', page['nextCursor'], 2)
    assert not {r['id'] for r in page['items']} & {r['id'] for r in second['items']}
    service.delete_portfolio(ident)
    assert records(service.db, ident, 'events')['items'][0]['action'] == 'portfolio.deleted'
