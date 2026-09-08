# -*- coding: utf-8 -*-
"""API contracts for the Agent-first financial workspace."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from src.services.expert_avatar import validate_avatar


class WorkspaceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CapabilityBindings(WorkspaceModel):
    skillIds: List[str] = Field(default_factory=list, max_length=50)
    toolIds: List[str] = Field(default_factory=list, max_length=100)
    mcpIds: List[str] = Field(default_factory=list, max_length=30)
    dataSourceIds: List[str] = Field(default_factory=list, max_length=30)
    expertIds: List[int] = Field(default_factory=list, max_length=20)
    expertTeamIds: List[int] = Field(default_factory=list, max_length=10)


class CapabilityPreferenceRequest(WorkspaceModel):
    enabledIds: List[str | int] = Field(default_factory=list, max_length=200)


class PortfolioResearchRules(WorkspaceModel):
    lossPct: float = Field(10, ge=0.1, le=100, allow_inf_nan=False)
    profitPct: float = Field(20, ge=0.1, le=100, allow_inf_nan=False)
    dailyMovePct: float = Field(5, ge=0.1, le=100, allow_inf_nan=False)


class PortfolioResearchRequest(WorkspaceModel):
    strategyVersionId: Optional[int] = Field(None, gt=0)
    capabilities: Optional[CapabilityBindings] = None
    rules: Optional[PortfolioResearchRules] = None
    dailyEnabled: bool = False
    intervalDays: Optional[int] = Field(None, strict=True, ge=1, le=365)
    runAt: Optional[str] = Field(None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class DataSourceCreateRequest(WorkspaceModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    connectionKey: str = Field(..., min_length=2, max_length=160)
    setupUrl: Optional[str] = Field(None, max_length=2048)
    accessMode: Literal["no_credential", "api_key", "token", "base_url", "account", "custom"] = "custom"
    kind: Literal["kline", "news", "fundamentals", "macro", "other"]
    markets: List[Literal["cn", "hk", "us"]] = Field(..., min_length=1, max_length=3)


class SkillCreateRequest(WorkspaceModel):
    id: Optional[str] = Field(None, min_length=2, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    category: Literal["research", "screening", "risk", "trading", "general"] = "general"
    description: str = Field("", max_length=4000)
    instructions: str = Field(..., min_length=1, max_length=30000)
    enabled: bool = True


class SkillUpdateRequest(WorkspaceModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    category: Optional[Literal["research", "screening", "risk", "trading", "general"]] = None
    description: Optional[str] = Field(None, max_length=4000)
    instructions: Optional[str] = Field(None, min_length=1, max_length=30000)
    enabled: Optional[bool] = None


class McpServerCreateRequest(WorkspaceModel):
    id: Optional[str] = Field(None, min_length=2, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    transport: Literal["http", "stdio"] = "http"
    location: str = Field(..., min_length=1, max_length=4000)
    credentialKey: str = Field("", max_length=160)
    enabled: bool = True


class McpServerUpdateRequest(WorkspaceModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    transport: Optional[Literal["http", "stdio"]] = None
    location: Optional[str] = Field(None, min_length=1, max_length=4000)
    credentialKey: Optional[str] = Field(None, max_length=160)
    enabled: Optional[bool] = None


class ExpertCreateRequest(WorkspaceModel):
    avatar: Optional[str] = Field(None, max_length=180000)
    _validate_avatar = field_validator("avatar")(validate_avatar)
    name: str = Field(..., min_length=1, max_length=120)
    style: str = Field("自定义投资视角", min_length=1, max_length=240)
    description: str = Field("", max_length=4000)
    philosophy: str = Field("", max_length=4000)
    focus: List[str] = Field(default_factory=list, max_length=30)
    prompt: str = Field(..., min_length=1, max_length=30000)
    enabled: bool = True


class ExpertUpdateRequest(WorkspaceModel):
    avatar: Optional[str] = Field(None, max_length=180000)
    _validate_avatar = field_validator("avatar")(validate_avatar)
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    style: Optional[str] = Field(None, min_length=1, max_length=240)
    description: Optional[str] = Field(None, max_length=4000)
    philosophy: Optional[str] = Field(None, max_length=4000)
    focus: Optional[List[str]] = Field(None, max_length=30)
    prompt: Optional[str] = Field(None, min_length=1, max_length=30000)
    enabled: Optional[bool] = None


class ExpertTeamCreateRequest(WorkspaceModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=4000)
    memberIds: List[int] = Field(..., min_length=1, max_length=20)
    protocol: str = Field(..., min_length=1, max_length=10000)
    enabled: bool = True


class ExpertTeamUpdateRequest(WorkspaceModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    memberIds: Optional[List[int]] = Field(None, min_length=1, max_length=20)
    protocol: Optional[str] = Field(None, min_length=1, max_length=10000)
    enabled: Optional[bool] = None


class TaskCreateRequest(WorkspaceModel):
    kind: Literal["research", "screening", "trading", "expert_review", "market_analysis", "industry_analysis"]
    name: str = Field(..., min_length=1, max_length=160)
    market: Literal["CN", "HK", "US", "GLOBAL"] = "CN"
    objective: str = Field(..., min_length=1, max_length=30000)
    subject: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)
    capabilities: CapabilityBindings = Field(default_factory=CapabilityBindings)
    enabled: bool = True


class TaskUpdateRequest(WorkspaceModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    market: Optional[Literal["CN", "HK", "US", "GLOBAL"]] = None
    objective: Optional[str] = Field(None, min_length=1, max_length=30000)
    subject: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
    capabilities: Optional[CapabilityBindings] = None
    enabled: Optional[bool] = None


class RunCreateRequest(WorkspaceModel):
    triggerType: Literal["manual", "schedule", "retry"] = "manual"


class ScheduleCreateRequest(WorkspaceModel):
    intervalDays: int = Field(1, strict=True, ge=1, le=365)
    taskId: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=160)
    scheduleMode: Literal["daily", "interval"]
    runAt: Optional[str] = Field(None, max_length=8)
    intervalMinutes: Optional[int] = Field(None, ge=5, le=10080)
    timezone: str = Field("Asia/Shanghai", min_length=1, max_length=64)
    enabled: bool = True
    publishToMarket: bool = False
    marketDashboardTitle: Optional[str] = Field(None, min_length=1, max_length=160)


class ScheduleUpdateRequest(WorkspaceModel):
    intervalDays: Optional[int] = Field(None, strict=True, ge=1, le=365)
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    runAt: Optional[str] = Field(None, max_length=8)
    intervalMinutes: Optional[int] = Field(None, ge=5, le=10080)
    timezone: Optional[str] = Field(None, min_length=1, max_length=64)
    enabled: Optional[bool] = None


class MarketDashboardUpdateRequest(WorkspaceModel):
    widgetIds: List[Literal["overview", "macro", "indices", "breadth", "sectors", "news", "subscriptions"]] = Field(..., min_length=1, max_length=7)
    newsSourceIds: List[int] = Field(default_factory=list, max_length=100)
    newsKeywords: List[str] = Field(default_factory=list, max_length=20)


class MarketSubscriptionCreateRequest(WorkspaceModel):
    taskId: str = Field(..., min_length=1, max_length=64)
    market: Literal["CN", "HK", "US", "GLOBAL"]
    title: Optional[str] = Field(None, min_length=1, max_length=160)
    enabled: bool = True


class MarketSubscriptionUpdateRequest(WorkspaceModel):
    title: Optional[str] = Field(None, min_length=1, max_length=160)
    enabled: Optional[bool] = None
    position: Optional[int] = Field(None, ge=0, le=10000)
