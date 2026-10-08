"""Exercise the public API through an actual bounded HTTP source connection."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import pytest
import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient as ApiClient

from api.v1.endpoints.simulation_portfolios import router
from src.services.simulation_runtime_service import SimulationRuntimeService

REQUEST_ID = 'c9d50b1a-8539-4c62-8422-d2cfa3cde457'


def capabilities():
    return dict(engine='quantevo', contractVersion='quantevo.ai-stock.v1', markets=['US', 'HK', 'CN', 'CRYPTO'],
                operations=dict(read=True, candidatePaper=True, research=True, cancelTasks=True),
                families=[dict(kind='grid', backtest=True, researchModes=['rules'], candidatePaper=True)],
                policy=dict(id='all_markets_strict_sharpe_v3'),
                periodicResearch=dict(supported=True, scheduler='main_app', minIntervalSeconds=3600,
                                      maxCycles=20, maxBudgetPerCycle=16, researchModes=['rules'], modelCalls=False),
                asyncRequests=True, idempotentRequests=True)


def operation(**changes):
    return dict(dict(requestId=REQUEST_ID, kind='candidate-paper', status='PENDING', taskId='job1',
                     portfolioId=None, versionId='candidate1', resultId=None, error=None, reused=False), **changes)


@pytest.fixture
def source(monkeypatch):
    routes = {}
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            size = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(size)) if size else None
            calls.append((self.command, self.path, payload))
            code, body = routes.get((self.command, self.path), (404, {'detail': 'private deployment path'}))
            content = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        do_GET = handle_request
        do_POST = handle_request

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    monkeypatch.setenv('SIMULATION_RUNTIME_URL', f'http://127.0.0.1:{server.server_port}/bridge')
    routes['GET', '/bridge/capabilities'] = (200, capabilities())
    app = FastAPI()
    app.include_router(router, prefix='/portfolios')
    with patch('src.services.simulation_runtime_service.current_workspace_database', return_value=None):
        yield routes, calls, ApiClient(app)
    server.shutdown()
    server.server_close()
    worker.join(timeout=2)


def test_owner_catalog_is_validated_over_real_http_and_proxy_is_bypassed(source, monkeypatch):
    routes, calls, client = source
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('NO_PROXY', '')
    item = dict(id=-7, sourceStrategyId='source7', name='Synthetic source grid', market='US', kind='grid',
                currentVersionId='v1', versionCount=2, paperAccountCount=1)
    routes['GET', '/bridge/strategies'] = (200, {'items': [item]})
    response = client.get('/portfolios/runtime/strategies')
    assert response.status_code == 200
    assert response.json() == {'items': [item]}
    assert [path for _, path, _ in calls] == ['/bridge/capabilities', '/bridge/strategies']


@pytest.mark.parametrize('change', [
    {'id': 7}, {'id': True}, {'sourceStrategyId': '../private'}, {'market': 'unexpected'},
])
def test_malformed_catalog_cannot_cross_the_source_boundary(source, change):
    routes, _, client = source
    item = dict(id=-7, sourceStrategyId='source7', name='Synthetic source grid', market='US', kind='grid',
                currentVersionId='v1', versionCount=2, paperAccountCount=1, **{})
    item.update(change)
    routes['GET', '/bridge/strategies'] = (200, {'items': [item]})
    assert client.get('/portfolios/runtime/strategies').status_code == 502


def test_legacy_contract_keeps_old_lists_but_does_not_enable_source_writes(source):
    routes, calls, client = source
    routes['GET', '/bridge/capabilities'] = (404, {'detail': 'private path'})
    routes['GET', '/bridge/definitions'] = (200, {'items': [{'id': -1}]})
    assert SimulationRuntimeService().items('/definitions') == [{'id': -1}]
    assert client.get('/portfolios/runtime/capabilities').json() == {
        'configured': True, 'available': False, 'capabilities': None, 'legacy': True}
    response = client.post('/portfolios/runtime/versions/candidate1/candidate-paper', json={'requestId': REQUEST_ID})
    assert response.status_code == 503
    assert not any(method == 'POST' for method, _, _ in calls)


def test_versioned_capabilities_are_explicitly_not_legacy(source):
    _, _, client = source
    expected = capabilities()
    expected['families'][0]['reason'] = None
    assert client.get('/portfolios/runtime/capabilities').json() == {
        'configured': True, 'available': True, 'capabilities': expected, 'legacy': False}


@pytest.mark.parametrize('code,body', [
    (200, b'not valid JSON'),
    (200, dict(capabilities(), contractVersion='unsupported.v2')),
    (200, {'engine': 'quantevo'}),
    (422, {'detail': 'private deployment path'}),
    (502, {'detail': 'private deployment path'}),
    (503, {'detail': 'private deployment path'}),
])
def test_capability_errors_never_authorize_legacy_fallback_or_source_writes(source, code, body):
    routes, calls, client = source
    routes['GET', '/bridge/capabilities'] = (code, body)
    response = client.get('/portfolios/runtime/capabilities')
    assert response.status_code == 200
    assert response.json() == {'configured': True, 'available': False, 'capabilities': None, 'legacy': False}
    assert 'private deployment path' not in response.text
    rejected = client.post('/portfolios/runtime/versions/candidate1/candidate-paper', json={'requestId': REQUEST_ID})
    assert rejected.status_code == 503
    assert not any(method == 'POST' for method, _, _ in calls)


def test_capability_timeout_does_not_authorize_legacy_fallback(source, monkeypatch):
    _, calls, client = source

    def timeout(*_args, **_kwargs):
        raise requests.Timeout('private deployment path')

    monkeypatch.setattr(requests.Session, 'request', timeout)
    response = client.get('/portfolios/runtime/capabilities')
    assert response.json() == {'configured': True, 'available': False, 'capabilities': None, 'legacy': False}
    assert calls == []


def test_member_has_no_source_connection_even_when_configured(source):
    _, calls, client = source
    with patch('src.services.simulation_runtime_service.current_workspace_database', return_value=object()):
        assert client.get('/portfolios/runtime/capabilities').json() == {
            'configured': False, 'available': False, 'capabilities': None, 'legacy': False}
        assert client.get('/portfolios/runtime/strategies').status_code == 404
        assert client.post('/portfolios/runtime/versions/candidate1/candidate-paper', json={'requestId': REQUEST_ID}).status_code == 404
    assert calls == []


def test_cached_owner_service_cannot_be_reused_inside_member_scope(source):
    _, calls, _ = source
    runtime = SimulationRuntimeService()
    with patch('src.services.simulation_runtime_service.current_workspace_database', return_value=object()):
        assert runtime.capabilities() == {'configured': False, 'available': False, 'capabilities': None, 'legacy': False}
        assert runtime.status() == {'configured': False, 'available': False}
        assert runtime.items('/definitions') == []
        assert runtime.overview() == {'items': [], 'runtime': {'configured': False, 'available': False}}
        for operation in [lambda: runtime.request('GET', '/health'),
                          lambda: runtime.source_request('GET', '/strategies')]:
            with pytest.raises(HTTPException) as error:
                operation()
            assert error.value.status_code == 404
    assert calls == []


def test_async_candidate_request_keeps_identity_and_queries_same_receipt(source):
    routes, calls, client = source
    routes['POST', '/bridge/versions/candidate1/candidate-paper'] = (202, operation())
    response = client.post('/portfolios/runtime/versions/candidate1/candidate-paper', json={'requestId': REQUEST_ID})
    assert response.status_code == 202
    assert response.json()['status'] == 'PENDING'
    assert calls[-1] == ('POST', '/bridge/versions/candidate1/candidate-paper', {'requestId': REQUEST_ID})
    routes['GET', f'/bridge/requests/{REQUEST_ID}'] = (200, operation(status='SUCCEEDED', portfolioId=-20, reused=True))
    receipt = client.get(f'/portfolios/runtime/requests/{REQUEST_ID}')
    assert receipt.status_code == 200 and receipt.json()['portfolioId'] == -20
    assert len([call for call in calls if call[0] == 'POST']) == 1


@pytest.mark.parametrize('change', [
    {'versionId': 'other'}, {'requestId': 'b9d50b1a-8539-4c62-8422-d2cfa3cde457'},
    {'kind': 'research'}, {'status': 'SUCCEEDED', 'portfolioId': None},
])
def test_stale_or_incomplete_candidate_response_is_rejected(source, change):
    routes, _, client = source
    routes['POST', '/bridge/versions/candidate1/candidate-paper'] = (202, operation(**change))
    assert client.post('/portfolios/runtime/versions/candidate1/candidate-paper', json={'requestId': REQUEST_ID}).status_code == 502


def test_receipt_not_found_is_distinct_and_does_not_expose_provider_body(source):
    _, _, client = source
    response = client.get(f'/portfolios/runtime/requests/{REQUEST_ID}')
    assert response.status_code == 404
    assert 'private deployment path' not in response.text


def test_unknown_receipt_remains_unknown_without_resubmitting(source):
    routes, calls, client = source
    routes['GET', f'/bridge/requests/{REQUEST_ID}'] = (200, operation(status='UNKNOWN'))
    assert client.get(f'/portfolios/runtime/requests/{REQUEST_ID}').json()['status'] == 'UNKNOWN'
    assert not any(method == 'POST' for method, _, _ in calls)


def test_source_contract_requires_explicit_model_free_scheduling(source):
    routes, _, client = source
    value = capabilities()
    del value['periodicResearch']['modelCalls']
    routes['GET', '/bridge/capabilities'] = (200, value)
    assert not client.get('/portfolios/runtime/capabilities').json()['available']


@pytest.mark.parametrize('payload', [
    {'requestId': REQUEST_ID, 'sourceBacktestId': 'bt1', 'budget': 17},
    {'requestId': REQUEST_ID, 'sourceBacktestId': 'bt1', 'budget': True},
    {'requestId': REQUEST_ID, 'sourceBacktestId': 'bt1', 'budget': 12, 'research_mode': 'llm'},
    {'requestId': 'invalid', 'sourceBacktestId': 'bt1', 'budget': 12},
])
def test_request_validation_blocks_extra_modes_and_invalid_budget_before_http(source, payload):
    _, calls, client = source
    assert client.post('/portfolios/runtime/versions/v1/research', json=payload).status_code == 422
    assert calls == []


def test_source_service_itself_is_not_an_arbitrary_proxy(source):
    _, calls, _ = source
    with pytest.raises(HTTPException) as error:
        SimulationRuntimeService().source_request('POST', '/llm-channels', {'api_key': 'never-sent'})
    assert error.value.status_code == 422
    assert not any(method == 'POST' for method, _, _ in calls)


def test_nonfinite_nested_eligibility_evidence_is_rejected(source):
    routes, _, client = source
    eligibility = dict(eligible=False, available=True, reason='Synthetic result', policyId='test', evidence={'score': float('nan')})
    routes['GET', '/bridge/versions/candidate1/candidate-preview'] = (200, dict(
        versionId='candidate1', strategyId=-1, iterationEligibility=eligibility, paperEligibility=eligibility,
        existingPortfolioId=None, symbols=[], initialCash=None, policyId='test', reason='Synthetic result'))
    assert client.get('/portfolios/runtime/versions/candidate1/candidate-preview').status_code == 502
