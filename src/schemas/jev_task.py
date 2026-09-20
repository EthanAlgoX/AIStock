"""Validated per-strategy customization for TypeSafe Choice requests."""
from pydantic import BaseModel, ConfigDict, Field


class JevCriteria(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    buy: str = Field(default='', max_length=2000)
    sell: str = Field(default='', max_length=2000)
    hold: str = Field(default='', max_length=2000)


class JevTaskConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    question: str = Field(default='', max_length=4000)
    criteria: JevCriteria = Field(default_factory=JevCriteria)
    background: str = Field(default='', max_length=6000)
    lookbackDays: int = Field(default=21, ge=3, le=21, strict=True)
