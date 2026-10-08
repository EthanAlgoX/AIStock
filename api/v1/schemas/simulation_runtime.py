"""Bounded public contract for the owner-only source strategy workspace."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt

SourceId = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]
PrivateId = Annotated[StrictInt, Field(lt=0)]
Text = Annotated[str, Field(max_length=2000)]
Stamp = Annotated[str, Field(max_length=80)]
Metrics = dict[str, StrictFloat | StrictInt | None]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Eligibility(ContractModel):
    eligible: StrictBool | None
    available: StrictBool
    reason: Text
    policyId: SourceId | None
    evidence: dict = Field(default_factory=dict)


class SourceFamily(ContractModel):
    kind: SourceId
    backtest: StrictBool
    researchModes: list[Literal['rules', 'llm']] = Field(max_length=2)
    candidatePaper: StrictBool
    reason: Text | None = None


class SourceOperations(ContractModel):
    read: StrictBool
    candidatePaper: StrictBool
    research: StrictBool
    cancelTasks: StrictBool


class PeriodicResearch(ContractModel):
    supported: StrictBool
    scheduler: Literal['main_app']
    minIntervalSeconds: StrictInt = Field(ge=60, le=604800)
    maxCycles: StrictInt = Field(ge=1, le=100)
    maxBudgetPerCycle: StrictInt = Field(ge=1, le=16)
    researchModes: list[Literal['rules']] = Field(max_length=1)
    modelCalls: Literal[False]


class SourcePolicy(ContractModel):
    id: SourceId


class SourceCapabilities(ContractModel):
    engine: Literal['quantevo']
    contractVersion: Literal['quantevo.ai-stock.v1']
    markets: list[Literal['US', 'HK', 'CN', 'CRYPTO']] = Field(max_length=4)
    operations: SourceOperations
    families: list[SourceFamily] = Field(max_length=50)
    policy: SourcePolicy
    periodicResearch: PeriodicResearch
    asyncRequests: StrictBool
    idempotentRequests: StrictBool


class SourceStrategy(ContractModel):
    id: PrivateId
    sourceStrategyId: SourceId
    name: Annotated[str, Field(min_length=1, max_length=200)]
    market: Literal['US', 'HK', 'CN', 'CRYPTO']
    kind: SourceId
    currentVersionId: SourceId | None
    versionCount: StrictInt = Field(ge=0)
    paperAccountCount: StrictInt = Field(ge=0)


class SourceVersion(ContractModel):
    id: SourceId
    definitionId: PrivateId
    strategyId: PrivateId
    number: StrictInt = Field(ge=1)
    status: Annotated[str, Field(min_length=1, max_length=40)]
    parentId: SourceId | None
    current: StrictBool
    iterationEligibility: Eligibility
    paperEligibility: Eligibility
    researchSupported: StrictBool
    executionSupported: StrictBool


class SourceBacktest(ContractModel):
    id: SourceId
    versionId: SourceId
    createdAt: Stamp
    start: Stamp | None
    end: Stamp | None
    initialCash: StrictFloat | None
    feeBps: StrictFloat | None
    slippageBps: StrictFloat | None
    metrics: Metrics
    complete: StrictBool | None
    cohortKey: Text | None
    researchSupported: StrictBool


class SourceExperiment(ContractModel):
    ordinal: StrictInt = Field(ge=0)
    decision: Annotated[str, Field(max_length=40)]
    reason: Text
    metrics: Metrics


class SourceResearch(ContractModel):
    id: SourceId
    versionId: SourceId
    candidateVersionId: SourceId | None
    status: Annotated[str, Field(max_length=40)]
    completed: StrictInt = Field(ge=0)
    budget: StrictInt = Field(ge=1, le=50)
    createdAt: Stamp
    policyId: SourceId | None
    baselineMetrics: Metrics | None
    candidateMetrics: Metrics | None
    experiments: list[SourceExperiment] = Field(max_length=50)


class SourceTask(ContractModel):
    id: SourceId
    type: SourceId
    status: Literal['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']
    progress: StrictFloat | None
    message: Text
    error: Text | None
    resultId: SourceId | None
    createdAt: Stamp
    finishedAt: Stamp | None


class CandidatePreview(ContractModel):
    versionId: SourceId
    strategyId: PrivateId
    iterationEligibility: Eligibility
    paperEligibility: Eligibility
    existingPortfolioId: PrivateId | None
    symbols: list[Annotated[str, Field(max_length=40)]] = Field(max_length=100)
    initialCash: StrictFloat | None
    policyId: SourceId | None
    reason: Text


class SourceOperation(ContractModel):
    requestId: Annotated[str, Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')]
    kind: Literal['candidate-paper', 'research']
    status: Literal['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']
    taskId: SourceId | None
    portfolioId: PrivateId | None
    versionId: SourceId
    resultId: SourceId | None
    error: Text | None
    reused: StrictBool


class SourceStrategies(ContractModel):
    items: list[SourceStrategy] = Field(max_length=100)


class SourceVersions(ContractModel):
    items: list[SourceVersion] = Field(max_length=100)


class SourceBacktests(ContractModel):
    items: list[SourceBacktest] = Field(max_length=100)


class SourceResearches(ContractModel):
    items: list[SourceResearch] = Field(max_length=100)


class SourceTasks(ContractModel):
    items: list[SourceTask] = Field(max_length=100)
