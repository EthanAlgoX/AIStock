"""Adapt workspace expert opinions to the existing deterministic conflict detector."""

from dataclasses import asdict
import math

from src.agent.protocols import StrategyOpinion
from src.agent.skills.synthesis import ConflictDetector


def material_expert_conflicts(opinions: list[dict]) -> list[dict]:
    normalized = []
    for opinion in opinions:
        data = opinion.get("structured")
        if not isinstance(data, dict):
            continue
        stance, confidence = data.get("stance"), data.get("confidence")
        if stance not in {"strong_buy", "buy", "hold", "sell", "strong_sell"}:
            continue
        if type(confidence) not in {int, float} or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            continue
        normalized.append(StrategyOpinion(skill_id=str(opinion["expertId"]), signal=stance, confidence=confidence))
    return [asdict(conflict) for conflict in ConflictDetector().detect(normalized)
            if conflict.conflict_type == "directional_opposition" and conflict.severity == "high"]
