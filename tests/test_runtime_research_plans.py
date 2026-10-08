"""Real SQLite plan lifecycle; only the private HTTP boundary is substituted."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient as Client

from api.v1.endpoints import runtime_research_plans as endpoint
from src.config import Config
from src.services.runtime_research_plan_service import RuntimeResearchPlanService
from src.storage import DatabaseManager, RuntimeResearchOperationRecord, RuntimeResearchPlanRecord
from src.workspace_scope import workspace_scope
from tests.test_member_workspaces import members  # noqa: F401


class Source:
    url = 'http://isolated-source.invalid/api/ai-stock'

    def __init__(self):
        self.caps = dict(
            engine='quantevo', contractVersion='quantevo.ai-stock.v1', markets=['US'],
            operations=dict(read=True, research=True, candidatePaper=True, cancelTasks=True),
            families=[dict(kind='sma', backtest=True, researchModes=['rules'], candidatePaper=True)],
            policy=dict(id='policy-v3'), asyncRequests=True, idempotentRequests=True,
            periodicResearch=dict(supported=True, scheduler='main_app', minIntervalSeconds=3600,
                                  maxCycles=20, maxBudgetPerCycle=16, researchModes=['rules'], modelCalls=False),
        )
        self.strategy = dict(id=-3, sourceStrategyId='source-strategy', market='US', kind='sma',
                             currentVersionId='version-one')
        self.version = dict(id='version-one', strategyId=-3, definitionId=-4, number=1,
                            parentId=None, current=True, researchSupported=True,
                            iterationEligibility=dict(available=True, eligible=False))
        self.backtest = dict(id='backtest-one', versionId='version-one', createdAt='2026-10-01T00:00:00Z',
                             start='2025-01-01', end='2026-01-01', initialCash=10000., feeBps=3.,
                             slippageBps=10., metrics=dict(totalReturn=-.1), complete=True,
                             cohortKey='frozen-cohort', researchSupported=True)
        self.available = True
        self.calls = []
        self.receipts = {}
        self.on_submit = None
        self.on_read = None

    def capabilities(self):
        return dict(configured=True, available=self.available,
                    capabilities=deepcopy(self.caps) if self.available else None)

    @staticmethod
    def operation(request_id, status='PENDING', **overrides):
        return dict(dict(requestId=request_id, kind='research', status=status, taskId='task-one',
                         portfolioId=None, versionId='version-one', resultId=None, error=None, reused=False), **overrides)

    def source_request(self, method, path, payload=None):
        self.calls.append((method, path, deepcopy(payload)))
        if method == 'GET' and path == '/strategies':
            return dict(items=[deepcopy(self.strategy)])
        if method == 'GET' and path == '/strategies/-3/versions':
            return dict(items=[deepcopy(self.version)])
        if method == 'GET' and path == '/strategies/-3/backtests':
            return dict(items=[deepcopy(self.backtest)])
        if method == 'GET' and path.startswith('/requests/'):
            request_id = path.rsplit('/', 1)[-1]
            if self.on_read:
                return self.on_read(request_id)
            if request_id not in self.receipts:
                raise HTTPException(404, 'Source request receipt not found')
            return deepcopy(self.receipts[request_id])
        if method == 'POST' and path == '/versions/version-one/research':
            if self.on_submit:
                return self.on_submit(payload)
            result = self.operation(payload['requestId'])
            self.receipts[payload['requestId']] = result
            return deepcopy(result)
        raise AssertionError(f'Unexpected source action: {method} {path}')

    def writes(self):
        return [payload for method, _, payload in self.calls if method == 'POST']


@pytest.fixture
def plans(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_FILE', str(tmp_path / 'absent.env'))
    monkeypatch.setattr(Config, '_instance', Config())
    DatabaseManager.reset_instance()
    database = DatabaseManager(f'sqlite:///{tmp_path / "owner.sqlite"}')
    source = Source()
    now = [datetime(2026, 10, 8, 12)]
    service = RuntimeResearchPlanService(database, source, clock=lambda: now[0])
    yield service, source, now
    DatabaseManager.reset_instance()


def payload(**changes):
    return dict(dict(sourceStrategyId=-3, sourceVersionId='version-one', sourceBacktestId='backtest-one',
                     intervalSeconds=3600, budget=4, maxRuns=3), **changes)


def due(service, now, **changes):
    plan = service.create(payload(**changes))
    now[0] += timedelta(hours=1)
    return plan


def test_reservation_is_committed_before_only_rules_submission_and_budget_stops(plans):
    service, source, now = plans
    plan = service.create(payload(maxRuns=2))
    service.tick()
    assert service.get(plan['id'])['runsReserved'] == 0
    assert source.writes() == []

    def submit(body):
        # A separate database read sees both records before the HTTP side effect.
        stored = service.repo.get(plan['id'])
        assert stored['runs_reserved'] == len(source.writes())
        reserved = stored['operations'][-1]
        assert reserved['request_id'] == body['requestId']
        assert str(uuid.UUID(body['requestId'])) == body['requestId']
        assert body == dict(requestId=reserved['request_id'], sourceBacktestId='backtest-one', budget=4)
        return source.operation(body['requestId'], 'SUCCEEDED', resultId='research-result')

    source.on_submit = submit
    for _ in range(3):
        now[0] += timedelta(hours=1)
        service.tick()
    result = service.get(plan['id'])
    assert result['status'] == 'completed'
    assert result['runsReserved'] == len(source.writes()) == 2
    assert [row['ordinal'] for row in result['operations']] == [1, 2]
    assert len({body['requestId'] for body in source.writes()}) == 2
    assert sum(body['budget'] for body in source.writes()) == 8
    assert all(path.endswith('/research') for method, path, _ in source.calls if method == 'POST')


@pytest.mark.parametrize('change', ['unavailable', 'model_missing', 'model_enabled', 'mode', 'async', 'idempotent'])
def test_missing_or_unsafe_capabilities_never_enable_plan(plans, change):
    service, source, _ = plans
    if change == 'unavailable':
        source.available = False
    elif change == 'model_missing':
        source.caps['periodicResearch'].pop('modelCalls')
    elif change == 'model_enabled':
        source.caps['periodicResearch']['modelCalls'] = True
    elif change == 'mode':
        source.caps['periodicResearch']['researchModes'] = ['llm']
    else:
        source.caps['asyncRequests' if change == 'async' else 'idempotentRequests'] = False
    with pytest.raises(HTTPException) as error:
        service.create(payload())
    assert error.value.status_code == 409
    assert service.list() == {'items': []}
    assert source.writes() == []


@pytest.mark.parametrize('field,value', [('intervalSeconds', 7199), ('budget', 5), ('maxRuns', 3)])
def test_advertised_limits_are_enforced(plans, field, value):
    service, source, _ = plans
    source.caps['periodicResearch'].update(minIntervalSeconds=7200, maxBudgetPerCycle=4, maxCycles=2)
    body = payload(intervalSeconds=7200, budget=4, maxRuns=2)
    body[field] = value
    with pytest.raises(HTTPException) as error:
        service.create(body)
    assert error.value.status_code == 422
    assert service.list()['items'] == []


@pytest.mark.parametrize('change', ['current', 'source_id', 'evaluation', 'policy', 'endpoint'])
def test_frozen_source_changes_pause_without_switching_version_or_spending_budget(plans, change):
    service, source, now = plans
    plan = due(service, now)
    if change == 'current':
        source.strategy['currentVersionId'] = 'version-two'
    elif change == 'source_id':
        source.strategy['sourceStrategyId'] = 'replacement-strategy'
    elif change == 'evaluation':
        source.backtest['feeBps'] = 4.
    elif change == 'policy':
        source.caps['policy']['id'] = 'policy-four'
    else:
        source.url = 'http://replacement-source.invalid/api/ai-stock'
    service.tick()
    result = service.get(plan['id'])
    assert result['status'] == 'paused'
    assert result['runsReserved'] == 0
    assert result['sourceVersionId'] == 'version-one'
    assert result['lastError']
    assert source.writes() == []
    with pytest.raises(HTTPException):
        service.control(plan['id'], 'resume')


@pytest.mark.parametrize('change', ['different_version', 'incomplete', 'unsupported'])
def test_backtest_must_be_complete_supported_and_belong_to_frozen_version(plans, change):
    service, source, _ = plans
    source.backtest[{'different_version': 'versionId', 'incomplete': 'complete', 'unsupported': 'researchSupported'}[change]] = (
        'version-two' if change == 'different_version' else False
    )
    with pytest.raises(HTTPException) as error:
        service.create(payload())
    assert error.value.status_code == 409
    assert source.writes() == []


def test_timeout_after_remote_acceptance_and_restart_only_reconcile_same_request(plans):
    service, source, now = plans
    plan = due(service, now)

    def accepted_then_timeout(body):
        source.receipts[body['requestId']] = source.operation(body['requestId'], 'RUNNING')
        raise HTTPException(503, 'Simulated HTTP timeout')

    source.on_submit = accepted_then_timeout
    service.tick()
    request_id = source.writes()[0]['requestId']
    restarted = RuntimeResearchPlanService(service.repo.db, source, clock=lambda: now[0])
    now[0] += timedelta(hours=2)
    restarted.tick()
    assert restarted.get(plan['id'])['runsReserved'] == 1
    assert restarted.get(plan['id'])['operations'][0]['status'] == 'RUNNING'
    assert len(source.writes()) == 1
    source.receipts[request_id] = source.operation(request_id, 'SUCCEEDED')
    restarted.tick()
    assert restarted.get(plan['id'])['operations'][0]['status'] == 'SUCCEEDED'
    assert len(source.writes()) == 1


def test_restart_between_reservation_and_post_reuses_original_uuid_only_after_explicit_404(plans):
    service, source, now = plans
    plan = due(service, now)
    plan_id, token = service.repo.claim_due(now[0])[0]
    reserved = service.repo.reserve(plan_id, token, now[0])
    # The process vanished before HTTP and before releasing its lease.
    now[0] += timedelta(seconds=301)
    restarted = RuntimeResearchPlanService(service.repo.db, source, clock=lambda: now[0])
    restarted.tick()
    result = restarted.get(plan['id'])
    assert result['runsReserved'] == 1
    assert source.writes() == [dict(requestId=reserved['request_id'], sourceBacktestId='backtest-one', budget=4)]
    assert result['operations'][0]['status'] == 'PENDING'
    restarted.tick()
    assert len(source.writes()) == 1


@pytest.mark.parametrize('outcome', ['UNKNOWN', 'rejected', 'unavailable'])
def test_unknown_or_generic_lookup_failure_never_resubmits_or_opens_next_ordinal(plans, outcome):
    service, source, now = plans
    plan = due(service, now)
    service.tick()
    request_id = source.writes()[0]['requestId']

    def lookup(_):
        if outcome == 'UNKNOWN':
            return source.operation(request_id, 'UNKNOWN')
        raise HTTPException(422 if outcome == 'rejected' else 503, 'No authoritative receipt')

    source.on_read = lookup
    for _ in range(3):
        now[0] += timedelta(hours=2)
        service.tick()
    result = service.get(plan['id'])
    assert result['runsReserved'] == 1
    assert len(source.writes()) == 1
    assert result['lastError']
    if outcome == 'UNKNOWN':
        assert result['status'] == 'paused'
        service.control(plan['id'], 'resume')
        service.tick()
        assert service.get(plan['id'])['status'] == 'paused'
        assert len(source.writes()) == 1


def test_pause_and_resume_keep_same_round_and_never_control_paper_accounts(plans):
    service, source, now = plans
    plan = due(service, now)
    service.control(plan['id'], 'pause')
    service.tick()
    assert source.writes() == []
    service.control(plan['id'], 'resume')
    service.tick()
    request_id = source.writes()[0]['requestId']
    service.control(plan['id'], 'pause')
    source.receipts[request_id] = source.operation(request_id, 'SUCCEEDED')
    service.tick()
    assert service.get(plan['id'])['status'] == 'paused'
    assert service.get(plan['id'])['operations'][0]['requestId'] == request_id
    now[0] += timedelta(hours=2)
    service.tick()
    assert len(source.writes()) == 1
    service.control(plan['id'], 'resume')
    service.tick()
    assert len(source.writes()) == 2
    assert all('/portfolios' not in path and '/candidate-paper' not in path for _, path, _ in source.calls)


def test_authoritative_unknown_never_replays_even_if_a_later_lookup_is_missing(plans):
    service, source, now = plans
    plan = due(service, now)
    service.tick()
    request_id = source.writes()[0]['requestId']
    source.receipts[request_id] = source.operation(request_id, 'UNKNOWN')
    service.tick()
    assert service.get(plan['id'])['status'] == 'paused'
    service.control(plan['id'], 'resume')
    source.receipts.pop(request_id)
    service.tick()
    assert service.get(plan['id'])['runsReserved'] == 1
    assert service.get(plan['id'])['operations'][0]['status'] == 'UNKNOWN'
    assert service.get(plan['id'])['status'] == 'paused'
    assert len(source.writes()) == 1


@pytest.mark.parametrize('recovered_status', ['PENDING', 'RUNNING'])
def test_authoritative_unknown_is_durable_after_transient_recovery_and_restart(plans, recovered_status):
    service, source, now = plans
    plan = due(service, now)
    service.tick()
    request_id = source.writes()[0]['requestId']
    source.receipts[request_id] = source.operation(request_id, 'UNKNOWN')
    service.tick()
    source.receipts[request_id] = source.operation(request_id, recovered_status)
    service.tick()
    assert service.get(plan['id'])['operations'][0]['status'] == recovered_status

    restarted = RuntimeResearchPlanService(service.repo.db, source, clock=lambda: now[0])
    restarted.control(plan['id'], 'resume')
    source.receipts.pop(request_id)
    restarted.tick()
    assert restarted.get(plan['id'])['status'] == 'paused'
    assert restarted.get(plan['id'])['runsReserved'] == 1
    assert len(source.writes()) == 1
    assert restarted.repo.get(plan['id'])['operations'][0]['authoritative_unknown_seen'] is True

    # A later authoritative completion can still resolve the existing round.
    source.receipts[request_id] = source.operation(request_id, 'SUCCEEDED')
    restarted.tick()
    assert restarted.get(plan['id'])['operations'][0]['status'] == 'SUCCEEDED'


@pytest.mark.parametrize('legacy_status', ['UNKNOWN', 'PENDING', 'RUNNING'])
def test_legacy_plan_schema_backfills_unknown_without_rewriting_receipts(plans, legacy_status):
    service, source, now = plans
    plan = due(service, now)
    service.tick()
    request_id = source.writes()[0]['requestId']
    source.receipts[request_id] = source.operation(request_id, 'UNKNOWN')
    service.tick()
    if legacy_status != 'UNKNOWN':
        source.receipts[request_id] = source.operation(request_id, legacy_status)
        service.tick()
    before = service.get(plan['id'])
    database_url = service.repo.db._db_url
    with service.repo.db._engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE simulation_runtime_research_operations DROP COLUMN authoritative_unknown_seen')
    DatabaseManager.reset_instance()
    database = DatabaseManager(database_url)
    restarted = RuntimeResearchPlanService(database, source, clock=lambda: now[0])
    assert restarted.get(plan['id']) == before
    assert restarted.repo.get(plan['id'])['operations'][0]['authoritative_unknown_seen'] is True
    # The same additive migration remains safe on the next startup.
    DatabaseManager.reset_instance()
    restarted = RuntimeResearchPlanService(DatabaseManager(database_url), source, clock=lambda: now[0])
    assert restarted.get(plan['id']) == before
    restarted.control(plan['id'], 'resume')
    source.receipts.pop(request_id)
    restarted.tick()
    assert len(source.writes()) == 1


def test_existing_flag_and_safe_reservation_do_not_become_unknown_on_startup(plans):
    service, source, now = plans
    plan = due(service, now)
    plan_id, token = service.repo.claim_due(now[0])[0]
    reserved = service.repo.reserve(plan_id, token, now[0])
    service.repo.release(plan_id, token)
    database_url = service.repo.db._db_url
    with service.repo.db._engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE simulation_runtime_research_operations DROP COLUMN authoritative_unknown_seen')
    DatabaseManager.reset_instance()
    restarted = RuntimeResearchPlanService(DatabaseManager(database_url), source, clock=lambda: now[0])
    assert restarted.repo.get(plan['id'])['operations'][0]['authoritative_unknown_seen'] is False
    restarted.tick()
    assert source.writes()[0]['requestId'] == reserved['request_id']
    assert restarted.get(plan['id'])['operations'][0]['status'] == 'PENDING'
    # Later ordinary restarts must not classify a known pending receipt as UNKNOWN.
    DatabaseManager.reset_instance()
    restarted = RuntimeResearchPlanService(DatabaseManager(database_url), source, clock=lambda: now[0])
    assert restarted.repo.get(plan['id'])['operations'][0]['authoritative_unknown_seen'] is False


@pytest.mark.parametrize('status', ['FAILED', 'CANCELLED'])
def test_terminal_research_failure_stops_plan_without_new_reservation(plans, status):
    service, source, now = plans
    plan = due(service, now)
    source.on_submit = lambda body: source.operation(body['requestId'], status, error='Rules experiment failed')
    service.tick()
    now[0] += timedelta(hours=2)
    service.tick()
    assert service.get(plan['id'])['status'] == 'failed'
    assert len(source.writes()) == 1
    with pytest.raises(HTTPException) as error:
        service.control(plan['id'], 'resume')
    assert error.value.status_code == 409


def test_concurrent_tick_and_expired_worker_cannot_overwrite_new_claim(plans):
    service, source, now = plans
    plan = due(service, now)
    accepted, finish = Event(), Event()

    def pending_submit(body):
        source.receipts[body['requestId']] = source.operation(body['requestId'], 'RUNNING')
        accepted.set()
        assert finish.wait(timeout=5)
        return source.operation(body['requestId'], 'SUCCEEDED')

    source.on_submit = pending_submit
    other = RuntimeResearchPlanService(service.repo.db, source, clock=lambda: now[0])
    with ThreadPoolExecutor(max_workers=1) as workers:
        future = workers.submit(service.tick)
        try:
            assert accepted.wait(timeout=5)
            other.tick()
            assert len(source.writes()) == 1
            # An expired worker may return after a replacement read the receipt.
            now[0] += timedelta(seconds=301)
            other.tick()
            assert other.get(plan['id'])['operations'][0]['status'] == 'RUNNING'
        finally:
            finish.set()
        future.result(timeout=5)
    assert service.get(plan['id'])['operations'][0]['status'] == 'RUNNING'
    assert len(source.writes()) == 1
    with service.repo.db.get_session() as session:
        assert session.get(RuntimeResearchPlanRecord, plan['id']).claim_token is None


def test_receipt_identity_mismatch_never_counts_as_completion(plans):
    service, source, now = plans
    plan = due(service, now)
    source.on_submit = lambda body: source.operation(body['requestId'], 'SUCCEEDED', versionId='another-version')
    service.tick()
    result = service.get(plan['id'])
    assert result['runsReserved'] == 1
    assert result['operations'][0]['status'] == 'UNKNOWN'
    assert result['status'] == 'active'
    assert result['lastError']


def test_member_scope_rejects_all_entries_including_reused_owner_service(plans, tmp_path):
    service, source, _ = plans
    member_db = DatabaseManager.open_workspace(f'sqlite:///{tmp_path / "member.sqlite"}', 'a' * 32)
    try:
        with workspace_scope(member_db):
            for action in (service.list, service.tick, lambda: service.create(payload()),
                           lambda: service.control(1, 'pause'), lambda: RuntimeResearchPlanService()):
                with pytest.raises(HTTPException) as error:
                    action()
                assert error.value.status_code == 403
        with pytest.raises(HTTPException):
            RuntimeResearchPlanService(member_db, source)
    finally:
        member_db._engine.dispose()
    assert source.calls == []
    assert service.list()['items'] == []


def test_api_contract_rejects_coerced_ids_paths_and_extra_actions(plans, monkeypatch):
    service, _, _ = plans
    monkeypatch.setattr(endpoint, 'RuntimeResearchPlanService', lambda: service)
    app = FastAPI()
    app.include_router(endpoint.router)
    client = Client(app)
    for changes in (dict(sourceStrategyId=True), dict(budget='4'), dict(sourceVersionId='../other'),
                    dict(maxRuns=21), dict(endpoint='http://other.invalid')):
        assert client.post('/runtime/research-plans', json=payload(**changes)).status_code == 422
    response = client.post('/runtime/research-plans', json=payload())
    assert response.status_code == 200, response.text
    plan = response.json()
    assert client.get('/runtime/research-plans').json()['items'][0] == plan
    assert client.post(f"/runtime/research-plans/{plan['id']}/control", json=dict(action='pause')).json()['status'] == 'paused'
    assert client.post(f"/runtime/research-plans/{plan['id']}/control", json=dict(action='paper')).status_code == 422
    assert client.post('/runtime/research-plans/0/control', json=dict(action='pause')).status_code == 422
    with service.repo.db.get_session() as session:
        assert session.query(RuntimeResearchOperationRecord).count() == 0


def test_paused_unknown_receipts_rotate_fairly_and_do_not_starve_new_due_plan(plans):
    service, source, now = plans
    paused = [service.create(payload()) for _ in range(3)]
    now[0] += timedelta(hours=1)
    reservations = []
    for plan_id, token in service.repo.claim_due(now[0], limit=3):
        operation = service.repo.reserve(plan_id, token, now[0])
        receipt = source.operation(operation['request_id'], 'UNKNOWN')
        source.receipts[operation['request_id']] = receipt
        service.repo.receive(plan_id, token, operation['id'], receipt, now[0])
        service.repo.release(plan_id, token)
        reservations.append(operation['request_id'])
    fresh = service.create(payload())
    now[0] += timedelta(hours=1)
    source.calls.clear()
    service.tick()
    assert service.get(fresh['id'])['runsReserved'] == 1
    assert len(source.writes()) == 1
    for _ in paused:
        now[0] += timedelta(seconds=15)
        service.tick()
    queried = [path.rsplit('/', 1)[-1] for method, path, _ in source.calls
               if method == 'GET' and path.startswith('/requests/')]
    assert queried == reservations
    assert len(source.writes()) == 1
    assert all(service.get(plan['id'])['status'] == 'paused' for plan in paused)


def test_existing_workspace_loop_runs_plan_tick_after_member_scope_is_restored(monkeypatch):
    from src.services import member_service, simulation_portfolio_service, runtime_research_plan_service
    from src.services.workspace_service import WorkspaceSchedulerService

    sequence = []
    scheduler = WorkspaceSchedulerService(lambda: SimpleNamespace(run_due_schedules=lambda: sequence.append('workspace')))
    scheduler._stop = SimpleNamespace(wait=Mock(side_effect=[False, True]))
    monkeypatch.setattr(simulation_portfolio_service, 'SimulationPortfolioService',
                        lambda: SimpleNamespace(due=lambda: sequence.append('native')))
    monkeypatch.setattr(member_service, 'run_member_maintenance', lambda: sequence.append('members'))
    monkeypatch.setattr(runtime_research_plan_service, 'RuntimeResearchPlanService',
                        lambda: SimpleNamespace(tick=lambda: sequence.append('source-rules')))
    scheduler._loop()
    assert sequence == ['workspace', 'native', 'members', 'source-rules']
    assert scheduler._thread is None


@pytest.mark.parametrize('broken_step', ['workspace', 'native', 'members', 'source-rules'])
def test_scheduler_failure_does_not_starve_other_simulation_or_receipt_steps(monkeypatch, broken_step):
    from src.services import member_service, simulation_portfolio_service, runtime_research_plan_service
    from src.services.workspace_service import WorkspaceSchedulerService

    sequence = []

    def step(name):
        sequence.append(name)
        if name == broken_step:
            raise RuntimeError('One isolated service failed')

    scheduler = WorkspaceSchedulerService(lambda: SimpleNamespace(run_due_schedules=lambda: step('workspace')))
    scheduler._stop = SimpleNamespace(wait=Mock(side_effect=[False, False, True]))
    monkeypatch.setattr(simulation_portfolio_service, 'SimulationPortfolioService',
                        lambda: SimpleNamespace(due=lambda: step('native')))
    monkeypatch.setattr(member_service, 'run_member_maintenance', lambda: step('members'))
    monkeypatch.setattr(runtime_research_plan_service, 'RuntimeResearchPlanService',
                        lambda: SimpleNamespace(tick=lambda: step('source-rules')))
    scheduler._loop()
    assert sequence == ['workspace', 'native', 'members', 'source-rules'] * 2


def test_real_authenticated_member_requests_cannot_read_or_create_owner_plans(members, monkeypatch):  # noqa: F811
    from api.middlewares.auth import add_auth_middleware

    owner, alice, bob, member_service = members
    source = Source()
    monkeypatch.setattr(endpoint, 'RuntimeResearchPlanService', lambda: RuntimeResearchPlanService(member_service.db, source))
    app = FastAPI()
    app.include_router(endpoint.router, prefix='/api/v1/simulation/portfolios')
    add_auth_middleware(app)
    path = '/api/v1/simulation/portfolios/runtime/research-plans'
    clients = []
    for original in (owner, alice, bob):
        client = Client(app, base_url='https://testserver')
        client.cookies.update(original.cookies)
        clients.append(client)
    response = clients[0].post(path, json=payload())
    assert response.status_code == 200, response.text
    assert clients[0].get(path).json()['items'][0]['id'] == response.json()['id']
    calls = deepcopy(source.calls)
    for client in clients[1:]:
        assert client.get(path).status_code == 403
        assert client.post(path, json=payload()).status_code == 403
        assert client.post(path + f"/{response.json()['id']}/control", json=dict(action='pause')).status_code == 403
    assert source.calls == calls
