"""Owner-only durable periodic rules research against the private source."""
from fastapi import APIRouter, Path

from src.services.runtime_research_plan_service import (
    ResearchPlanControl, ResearchPlanCreate, RuntimeResearchPlanService,
)

router = APIRouter(prefix='/runtime/research-plans')


@router.get('')
def list_plans():
    return RuntimeResearchPlanService().list()


@router.post('')
def create_plan(body: ResearchPlanCreate):
    return RuntimeResearchPlanService().create(body.model_dump())


@router.post('/{plan_id}/control')
def control_plan(body: ResearchPlanControl, plan_id: int = Path(ge=1)):
    return RuntimeResearchPlanService().control(plan_id, body.action)
