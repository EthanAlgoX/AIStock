# -*- coding: utf-8 -*-
"""Contracts for the isolated strategy-lab simulation API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SimulationRunStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
SimulationExecutionMode = Literal["preview", "paper"]


class SimulationStrategyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    config: Dict[str, Any] = Field(default_factory=dict, description="Initial immutable strategy configuration")
    version_label: Optional[str] = Field(None, max_length=120)


class SimulationStrategyUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    enabled: Optional[bool] = None


class SimulationStrategyVersionCreateRequest(BaseModel):
    config: Dict[str, Any] = Field(default_factory=dict)
    label: Optional[str] = Field(None, max_length=120)


class SimulationStrategyVersionItem(BaseModel):
    id: int
    strategy_id: int
    version: int
    label: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class SimulationStrategyItem(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    enabled: bool
    created_at: datetime
    updated_at: datetime
    latest_version: Optional[SimulationStrategyVersionItem] = None


class SimulationStrategyListResponse(BaseModel):
    items: List[SimulationStrategyItem] = Field(default_factory=list)


class SimulationTemplateItem(BaseModel):
    id: str
    name: str
    description: str
    category: str
    screening_strategy_id: str
    skill_ids: List[str] = Field(default_factory=list)
    orchestrator_mode: Literal["quick", "standard", "full", "specialist"]
    recommended_sources: List[str] = Field(default_factory=list)
    risk_rules: Dict[str, Any] = Field(default_factory=dict)
    position_rules: Dict[str, Any] = Field(default_factory=dict)
    agent_prompts: Dict[str, str] = Field(default_factory=dict)
    source_files: List[str] = Field(default_factory=list)


class SimulationTemplateListResponse(BaseModel):
    items: List[SimulationTemplateItem] = Field(default_factory=list)


class SimulationRunCreateRequest(BaseModel):
    strategy_version_id: int = Field(..., ge=1)
    execution_mode: SimulationExecutionMode = "preview"
    input_snapshot: Dict[str, Any] = Field(default_factory=dict)


class SimulationRunItem(BaseModel):
    id: int
    strategy_version_id: int
    status: SimulationRunStatus
    execution_mode: SimulationExecutionMode
    input_snapshot: Dict[str, Any] = Field(default_factory=dict)
    result_snapshot: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class SimulationRunExecuteResponse(BaseModel):
    item: SimulationRunItem


class SimulationRunDetailResponse(BaseModel):
    item: SimulationRunItem


class SimulationRunListResponse(BaseModel):
    items: List[SimulationRunItem] = Field(default_factory=list)


class PublishedStrategyRunCandidate(BaseModel):
    strategyId: int
    strategyName: str
    strategyDescription: Optional[str] = None
    versionId: int
    versionNumber: Optional[int] = None
    publishedAt: Optional[datetime] = None
    agentCount: int = 0
    connectionCount: int = 0
    validationStatus: Literal["not_started", "queued", "running", "completed", "validated", "failed"] = "not_started"
    latestValidationExperimentId: Optional[int] = None
    validatedAt: Optional[datetime] = None
    strategyPurpose: str = "trading_decision"
    outputContract: str = "DecisionProposal"
    kernelRuntime: Optional[str] = None
    kernelEntrypoint: Optional[str] = None
    kernelExecutionStatus: Optional[str] = None
    market: Optional[str] = None
    timeHorizon: Optional[str] = None


class PublishedStrategyRunCreateRequest(BaseModel):
    strategyVersionId: int = Field(..., ge=1)
    inputSnapshot: Dict[str, Any] = Field(default_factory=dict)


class PublishedStrategyRunItem(BaseModel):
    id: int
    strategyId: int
    strategyName: str
    strategyVersionId: int
    versionNumber: Optional[int] = None
    status: SimulationRunStatus
    executionMode: SimulationExecutionMode
    inputSnapshot: Dict[str, Any] = Field(default_factory=dict)
    resultSnapshot: Optional[Dict[str, Any]] = None
    errorMessage: Optional[str] = None
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime
    outputContract: str = "DecisionProposal"
    kernelRuntime: Optional[str] = None


class PublishedStrategyRunListResponse(BaseModel):
    items: List[PublishedStrategyRunItem] = Field(default_factory=list)


AutomaticStrategyRunStatus = Literal["queued", "running", "completed", "completed_with_failures", "failed", "cancelled"]


class AutomaticStrategyRunCreateRequest(BaseModel):
    strategyVersionId: int = Field(..., ge=1)


class AutomaticStrategyRunCandidate(BaseModel):
    runId: int
    code: str
    name: Optional[str] = None
    screenScore: Optional[float] = None
    status: SimulationRunStatus


class AutomaticStrategyRunBatchItem(BaseModel):
    id: int
    strategyId: int
    strategyName: str
    strategyVersionId: int
    versionNumber: Optional[int] = None
    status: AutomaticStrategyRunStatus
    screeningPolicy: Dict[str, Any] = Field(default_factory=dict)
    screeningRunId: Optional[str] = None
    candidateCount: int = 0
    candidates: List[AutomaticStrategyRunCandidate] = Field(default_factory=list)
    screening: Dict[str, Any] = Field(default_factory=dict)
    errorMessage: Optional[str] = None
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime
    outputContract: str = "DecisionProposal"
    kernelRuntime: Optional[str] = None


class AutomaticStrategyRunBatchListResponse(BaseModel):
    items: List[AutomaticStrategyRunBatchItem] = Field(default_factory=list)


ContinuousStrategyRunStatus = Literal["running", "paused", "terminated"]


class ContinuousStrategyRunStartRequest(BaseModel):
    strategyVersionId: int = Field(..., ge=1)
    intervalSeconds: int = Field(900, ge=60, le=86400)


class ContinuousStrategyRunControlItem(BaseModel):
    id: int
    strategyVersionId: int
    status: ContinuousStrategyRunStatus
    intervalSeconds: int
    lastBatchId: Optional[int] = None
    nextRunAt: Optional[datetime] = None
    lastStartedAt: Optional[datetime] = None
    lastCompletedAt: Optional[datetime] = None
    errorMessage: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class ContinuousStrategyRunControlListResponse(BaseModel):
    items: List[ContinuousStrategyRunControlItem] = Field(default_factory=list)


StrategyValidationExperimentStatus = Literal["queued", "running", "completed", "failed"]
StrategyValidationVersionStatus = Literal["not_started", "queued", "running", "completed", "validated", "failed"]


class StrategyValidationConfig(BaseModel):
    startDate: date
    endDate: date
    initialCapital: float = Field(1_000_000, ge=10_000, le=1_000_000_000)
    commissionRate: float = Field(0.0003, ge=0, le=0.05)
    minimumCommission: Optional[float] = Field(None, ge=0, le=10_000)
    slippageRate: float = Field(0.001, ge=0, le=0.05)
    executionRule: Literal["next_open"] = "next_open"
    rebalanceFrequency: Literal["daily", "weekly", "monthly"] = "weekly"
    market: Literal["cn", "hk", "us"] = "cn"
    # None keeps older clients that already sent explicit symbols compatible;
    # the service infers override only for that legacy request shape.
    universeMode: Optional[Literal["strategy", "override"]] = None
    experimentPurpose: Optional[Literal["validation", "diagnostic"]] = None
    maxPositions: int = Field(3, ge=1, le=10)
    maxUniverseSize: int = Field(50, ge=1, le=100)
    symbols: List[str] = Field(default_factory=list, max_length=100)


class StrategyValidationExperimentCreateRequest(BaseModel):
    strategyVersionId: int = Field(..., ge=1)
    idempotencyKey: str = Field(..., min_length=8, max_length=128)
    config: StrategyValidationConfig


class StrategyValidationExperimentItem(BaseModel):
    id: int
    strategyId: Optional[int] = None
    strategyName: Optional[str] = None
    strategyVersionId: int
    versionNumber: Optional[int] = None
    versionStatus: Optional[str] = None
    versionRevision: int
    status: StrategyValidationExperimentStatus
    engineVersion: str
    config: Dict[str, Any]
    result: Optional[Dict[str, Any]] = None
    barCount: int = 0
    inputSnapshotHash: Optional[str] = None
    integrityStatus: Literal["verified", "legacy_unverified", "failed"] = "legacy_unverified"
    errorMessage: Optional[str] = None
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class StrategyValidationExperimentListResponse(BaseModel):
    items: List[StrategyValidationExperimentItem] = Field(default_factory=list)


class StrategyValidationComparisonRequest(BaseModel):
    baselineExperimentId: int = Field(..., ge=1)
    targetExperimentId: int = Field(..., ge=1)


class StrategyValidationComparisonSide(BaseModel):
    experimentId: int
    strategyVersionId: int
    versionNumber: Optional[int] = None
    versionStatus: Optional[str] = None
    completedAt: Optional[datetime] = None
    inputSnapshotHash: str
    symbolCount: int
    metrics: Dict[str, Any]


class StrategyValidationComparisonMetric(BaseModel):
    key: str
    label: str
    format: Literal["percent", "number", "integer", "currency"]
    preference: Literal["higher", "lower", "neutral"]
    baselineValue: Optional[float] = None
    targetValue: Optional[float] = None
    delta: Optional[float] = None


class StrategyValidationComparisonResponse(BaseModel):
    strategyId: int
    strategyName: str
    baseline: StrategyValidationComparisonSide
    target: StrategyValidationComparisonSide
    metrics: List[StrategyValidationComparisonMetric]
    comparisonBasis: Dict[str, Any]


class StrategyValidationVersionStatusItem(BaseModel):
    strategyVersionId: int
    versionRevision: int
    status: StrategyValidationVersionStatus
    latestExperimentId: Optional[int] = None
    latestCompletedExperimentId: Optional[int] = None
    completedAt: Optional[datetime] = None
    validatedAt: Optional[datetime] = None


class SimulationAccountCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    initial_cash: float = Field(..., gt=0)
    currency: str = Field("CNY", min_length=3, max_length=8)


class SimulationAccountItem(BaseModel):
    id: int
    name: str
    currency: str
    initial_cash: float
    cash_balance: float
    status: str
    created_at: datetime

class SimulationAccountListResponse(BaseModel):
    items: List[SimulationAccountItem] = Field(default_factory=list)

class SimulationPaperOrderItem(BaseModel):
    id: int; simulation_run_id: int; strategy_version_id: int; stock_code: str; side: str; quantity: int; status: str; reject_reason: Optional[str] = None; created_at: datetime

class SimulationPaperOrderListResponse(BaseModel):
    items: List[SimulationPaperOrderItem] = Field(default_factory=list)

class SimulationPaperExecutionRequest(BaseModel):
    account_id: int = Field(..., ge=1)
    run_id: int = Field(..., ge=1)

class SimulationPaperExecutionResponse(BaseModel):
    order_id: int
    status: str
    idempotent: bool
    reason: Optional[str] = None


# Strategy-definition contracts.  They intentionally live beside the legacy
# simulation contracts so old /api/v1/simulation endpoints remain compatible.
class StrategyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    templateId: Optional[str] = Field(None, max_length=120)
    basedOnVersionId: Optional[int] = Field(None, ge=1)
    kernelVersionId: Optional[int] = Field(None, ge=1)


class StrategyKernelExecuteRequest(BaseModel):
    inputs: Dict[str, Any] = Field(default_factory=dict)
    data: Dict[str, Any] = Field(default_factory=dict)
    mode: Literal["preview", "research", "backtest"] = "preview"
    asOf: Optional[str] = Field(None, max_length=64)


class StrategyDataSourceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    connectionKey: str = Field(..., min_length=2, max_length=160)
    kind: Literal["kline", "news", "fundamentals", "macro", "other"]
    markets: list[Literal["cn", "hk", "us"]] = Field(..., min_length=1, max_length=3)


AgentDefinitionType = Literal["SCREENING", "ANALYSIS", "DECISION", "REFLECTION"]


class AgentTemplateCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    agentType: AgentDefinitionType
    defaultRole: str = Field(..., min_length=1, max_length=4000)
    defaultSystemPrompt: str = Field(..., min_length=1, max_length=30000)
    defaultPromptTemplate: str = Field("", max_length=30000)
    inputSchema: Dict[str, Any]
    outputSchema: Dict[str, Any]
    supportedTools: List[str] = Field(default_factory=list)
    supportedDataTypes: List[str] = Field(default_factory=list)


class AgentTemplateUpdateRequest(BaseModel):
    currentVersion: int = Field(..., ge=1)
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    agentType: Optional[AgentDefinitionType] = None
    defaultRole: Optional[str] = Field(None, min_length=1, max_length=4000)
    defaultSystemPrompt: Optional[str] = Field(None, min_length=1, max_length=30000)
    defaultPromptTemplate: Optional[str] = Field(None, max_length=30000)
    inputSchema: Optional[Dict[str, Any]] = None
    outputSchema: Optional[Dict[str, Any]] = None
    supportedTools: Optional[List[str]] = None
    supportedDataTypes: Optional[List[str]] = None


class AgentWorkflowCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    basedOnStrategyVersionId: Optional[int] = Field(None, ge=1)
    agents: List[Dict[str, Any]] = Field(default_factory=list)
    connections: List[Dict[str, Any]] = Field(default_factory=list)


class AgentWorkflowDraftSaveRequest(BaseModel):
    revision: int = Field(..., ge=1)
    workflow: Dict[str, Any] = Field(default_factory=dict)
    agents: List[Dict[str, Any]] = Field(default_factory=list)
    connections: List[Dict[str, Any]] = Field(default_factory=list)


class AgentWorkflowPublishRequest(BaseModel):
    revision: int = Field(..., ge=1)
    changeLog: str = Field(..., min_length=1, max_length=4000)
    idempotencyKey: str = Field(..., min_length=8, max_length=128)


class AgentWorkflowCreateDraftRequest(BaseModel):
    basedOnVersionId: int = Field(..., ge=1)


class StrategyDraftSaveRequest(BaseModel):
    revision: int = Field(..., ge=1)
    strategy: Dict[str, Any] = Field(default_factory=dict)
    version: Dict[str, Any] = Field(default_factory=dict)
    agents: List[Dict[str, Any]] = Field(default_factory=list)
    connections: List[Dict[str, Any]] = Field(default_factory=list)


class StrategyPublishRequest(BaseModel):
    revision: int = Field(..., ge=1)
    changeLog: str = Field(..., min_length=1, max_length=4000)
    acknowledgedWarningCodes: List[str] = Field(default_factory=list)
    idempotencyKey: str = Field(..., min_length=8, max_length=128)
    validationExperimentId: Optional[int] = Field(None, ge=1)


class StrategyCreateDraftRequest(BaseModel):
    basedOnVersionId: int = Field(..., ge=1)


class StrategyForkLocalRequest(BaseModel):
    baseRevision: int = Field(..., ge=1)
    newStrategyName: str = Field(..., min_length=1, max_length=120)
    newStrategyDescription: Optional[str] = Field(None, max_length=4000)
    localDraft: Dict[str, Any]
    idempotencyKey: str = Field(..., min_length=8, max_length=128)


class StrategyDefinitionResponse(BaseModel):
    """Flexible response boundary while definition fields evolve independently."""
    model_config = {"extra": "allow"}
