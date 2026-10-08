"""Bounded periodic source rules research, without native/LLM execution."""
import hashlib
import json
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from src.repositories.runtime_research_plans import RuntimeResearchPlanRepository, UNRESOLVED
from src.services.simulation_runtime_service import SimulationRuntimeService
from src.storage import DatabaseManager, to_utc_naive_datetime, utc_naive_now
from src.workspace_scope import current_workspace_database

SourceId = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]


class ResearchPlanCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    sourceStrategyId: StrictInt = Field(lt=0)
    sourceVersionId: SourceId
    sourceBacktestId: SourceId
    intervalSeconds: StrictInt = Field(ge=3600, le=2147483647)
    budget: StrictInt = Field(ge=1, le=16)
    maxRuns: StrictInt = Field(ge=1, le=20)


class ResearchPlanControl(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['pause', 'resume']


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _iso(value):
    return value.isoformat() + 'Z' if value is not None else None


def _payload(plan):
    return dict(sourceStrategyId=plan['source_strategy_id'], sourceVersionId=plan['source_version_id'],
                sourceBacktestId=plan['source_backtest_id'], intervalSeconds=plan['interval_seconds'],
                budget=plan['budget'], maxRuns=plan['max_runs'])


class RuntimeResearchPlanService:
    def __init__(self, database=None, runtime=None, clock=utc_naive_now):
        if current_workspace_database() is not None:
            raise HTTPException(403, 'Source research plans are available only to the owner')
        self.repo = RuntimeResearchPlanRepository(database or DatabaseManager.get_instance())
        self.runtime = runtime or SimulationRuntimeService()
        self.clock = clock

    def _now(self):
        return to_utc_naive_datetime(self.clock())

    @staticmethod
    def _public(plan):
        operations = []
        for operation in plan['operations']:
            receipt = json.loads(operation['receipt_json']) if operation['receipt_json'] else dict(
                requestId=operation['request_id'], kind='research', status='UNKNOWN', taskId=None,
                portfolioId=None, versionId=plan['source_version_id'], resultId=None, error=None, reused=False,
            )
            operations.append(dict(receipt, ordinal=operation['ordinal'], createdAt=_iso(operation['created_at']),
                                   updatedAt=_iso(operation['updated_at'])))
        return dict(
            id=plan['id'], sourceStrategyId=plan['source_strategy_id'], sourceVersionId=plan['source_version_id'],
            sourceBacktestId=plan['source_backtest_id'], intervalSeconds=plan['interval_seconds'], budget=plan['budget'],
            maxRuns=plan['max_runs'], runsReserved=plan['runs_reserved'], status=plan['status'],
            nextRunAt=_iso(plan['next_run_at']), lastError=plan['last_error'], operations=operations,
        )

    def list(self):
        self.repo.guard_owner()
        return {'items': [self._public(row) for row in self.repo.list()]}

    def get(self, plan_id):
        self.repo.guard_owner()
        return self._public(self.repo.get(plan_id))

    def _source_context(self, payload):
        """Require explicit rule-only scheduling and a complete frozen cohort."""
        self.repo.guard_owner()
        status = self.runtime.capabilities()
        caps = status.get('capabilities')
        if not status.get('configured') or not status.get('available') or not isinstance(caps, dict):
            raise HTTPException(409, 'Source rules research capabilities are unavailable')
        periodic = caps.get('periodicResearch', {})
        operations = caps.get('operations', {})
        if (caps.get('engine') != 'quantevo' or caps.get('contractVersion') != 'quantevo.ai-stock.v1'
                or periodic.get('supported') is not True or periodic.get('scheduler') != 'main_app'
                or periodic.get('researchModes') != ['rules'] or periodic.get('modelCalls') is not False
                or operations.get('research') is not True or operations.get('read') is not True
                or caps.get('asyncRequests') is not True or caps.get('idempotentRequests') is not True):
            raise HTTPException(409, 'Source does not support asynchronous idempotent periodic rules research')
        if (payload['intervalSeconds'] < max(3600, periodic['minIntervalSeconds'])
                or payload['budget'] > min(16, periodic['maxBudgetPerCycle'])
                or payload['maxRuns'] > min(20, periodic['maxCycles'])):
            raise HTTPException(422, 'Research plan exceeds source interval, budget or cycle limits')
        strategy_id = payload['sourceStrategyId']
        strategies = self.runtime.source_request('GET', '/strategies')['items']
        strategy = next((item for item in strategies if item['id'] == strategy_id), None)
        if strategy is None or strategy['currentVersionId'] != payload['sourceVersionId']:
            raise HTTPException(409, 'Research plan requires the current source strategy version')
        family = next((item for item in caps['families'] if item['kind'] == strategy['kind']), None)
        if (family is None or family.get('backtest') is not True or 'rules' not in family.get('researchModes', [])
                or strategy['market'] not in caps['markets']):
            raise HTTPException(409, 'This source strategy family does not support rules research')
        versions = self.runtime.source_request('GET', f'/strategies/{strategy_id}/versions')['items']
        version = next((item for item in versions if item['id'] == payload['sourceVersionId']), None)
        if (version is None or version['strategyId'] != strategy_id or version['current'] is not True
                or version['researchSupported'] is not True):
            raise HTTPException(409, 'Source version is unavailable for rules research')
        backtests = self.runtime.source_request('GET', f'/strategies/{strategy_id}/backtests')['items']
        backtest = next((item for item in backtests if item['id'] == payload['sourceBacktestId']), None)
        if (backtest is None or backtest['versionId'] != payload['sourceVersionId']
                or backtest['complete'] is not True or backtest['researchSupported'] is not True):
            raise HTTPException(409, 'Research plan requires a complete matching source backtest')
        source = dict(
            strategy={key: strategy[key] for key in ('id', 'sourceStrategyId', 'market', 'kind')},
            version={key: version[key] for key in ('id', 'definitionId', 'strategyId', 'number', 'parentId')},
            backtest=backtest,
        )
        contract = dict(
            endpoint=getattr(self.runtime, 'url', ''),
            **{key: caps[key] for key in ('engine', 'contractVersion', 'policy', 'periodicResearch',
                                          'operations', 'asyncRequests', 'idempotentRequests')},
            family={key: family[key] for key in ('kind', 'backtest', 'researchModes')},
        )
        return _fingerprint(source), _fingerprint(contract)

    def _validate_frozen(self, plan):
        source, capability = self._source_context(_payload(plan))
        if source != plan['source_fingerprint'] or capability != plan['capability_fingerprint']:
            raise HTTPException(409, 'Source contract or frozen evaluation changed; create a new research plan')

    def create(self, payload):
        self.repo.guard_owner()
        payload = ResearchPlanCreate.model_validate(payload).model_dump()
        source, capability = self._source_context(payload)
        plan_id = self.repo.create(payload, source, capability, self._now())
        return self.get(plan_id)

    def control(self, plan_id, action):
        self.repo.guard_owner()
        plan = self.repo.get(plan_id)
        if action == 'resume':
            self._validate_frozen(plan)
        self.repo.control(plan_id, action, self._now())
        return self.get(plan_id)

    @staticmethod
    def _check_receipt(plan, operation, receipt):
        if (receipt['requestId'] != operation['request_id'] or receipt['kind'] != 'research'
                or receipt['versionId'] != plan['source_version_id']):
            raise HTTPException(502, 'Source research receipt does not match the reserved request')

    def _submit(self, plan, operation, token, now):
        if operation['authoritative_unknown_seen'] or not self.repo.owns(plan['id'], token, active=True):
            return
        try:
            receipt = self.runtime.source_request('POST', f"/versions/{plan['source_version_id']}/research", dict(
                requestId=operation['request_id'], sourceBacktestId=plan['source_backtest_id'], budget=plan['budget'],
            ))
            self._check_receipt(plan, operation, receipt)
            self.repo.receive(plan['id'], token, operation['id'], receipt, now)
        except HTTPException as exc:
            self.repo.note_error(plan['id'], token,
                                 'Source research submission has no confirmed receipt; the original request is retained',
                                 now, pause=exc.status_code < 500)

    def _tick_claim(self, plan_id, token, now):
        plan = self.repo.get(plan_id)
        pending = next((item for item in plan['operations'] if item['status'] in UNRESOLVED), None)
        if pending is not None:
            try:
                receipt = self.runtime.source_request('GET', f"/requests/{pending['request_id']}")
                self._check_receipt(plan, pending, receipt)
            except HTTPException as exc:
                # Only an explicit missing-receipt response permits a replay.
                # UNKNOWN or a generic rejected/unavailable response never does.
                if (exc.status_code == 404 and plan['status'] == 'active'
                        and not pending['authoritative_unknown_seen']):
                    self._validate_frozen(plan)
                    self._submit(plan, pending, token, now)
                else:
                    self.repo.note_error(plan_id, token,
                                         'Source receipt unavailable; the original request is retained', now,
                                         pause=pending['authoritative_unknown_seen'])
                return
            self.repo.receive(plan_id, token, pending['id'], receipt, now)
            return
        if plan['status'] != 'active':
            return
        self._validate_frozen(plan)
        operation = self.repo.reserve(plan_id, token, now)
        if operation is not None:
            self._submit(plan, operation, token, now)

    def tick(self):
        """One bounded pass, called exclusively by the existing workspace loop."""
        self.repo.guard_owner()
        now = self._now()
        for plan_id, token in self.repo.claim_due(now):
            try:
                self._tick_claim(plan_id, token, now)
            except HTTPException:
                self.repo.note_error(plan_id, token,
                                     'Source capabilities, current version or frozen evaluation require verification; plan paused',
                                     now, pause=True)
            finally:
                self.repo.release(plan_id, token)
