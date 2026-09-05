"""
address_finder.models

Model F (TARGET_STREET_ONLY) and Model G (LOW_NUMBER_WEIGHT) mathematical scoring,
soft house-number weighting, and structural interval generation.
Extracted directly from the validated Phase Anchor-Target pipeline.
All weights match frozen rules: phase_anchor_target_frozen_rules.json (SHA 083db257...).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# Pre-registered frozen rule artifact SHA-256
FROZEN_RULES_SHA256 = "083db257ebf3e407eddc7cc8d72d4a5e5a19f5c6e7717373c3b06e84e9e50b7a"

# Model F default frozen weights
MODEL_F_WEIGHTS: Dict[str, float] = {
    "w_delta_lll": 1.0,
    "w_target_street_match": 2.5,
    "w_anchor_street_match": 0.5,
    "w_graph_intersection": 0.8,
}

# Model G multiplier (LOW_NUMBER_WEIGHT)
MODEL_G_MULTIPLIER: float = 0.3

# Structural interval tiers
STRUCTURAL_INTERVAL_TIERS: List[int] = [5, 10, 15, 20, 30]


def score_number_compatibility(
    cand_num: Optional[int],
    query_num: Optional[int],
    weight_strength: str = "LOW_NUMBER_WEIGHT",
) -> float:
    """
    Score compatibility between candidate door number and unverified listing number.
    Uses graduated step distance with parity bonus.
    CRITICAL SAFETY RULE:
    Returns non-negative soft boost only. Never returns negative score or discards.
    """
    if cand_num is None or query_num is None:
        return 0.0

    diff = abs(cand_num - query_num)
    if diff == 0:
        base = 1.5
    elif diff <= 10:
        base = 1.0
    elif diff <= 20:
        base = 0.6
    elif diff <= 50:
        base = 0.3
    elif diff <= 100:
        base = 0.1
    else:
        base = 0.0

    parity_bonus = 0.2 if (cand_num % 2 == query_num % 2) else 0.0
    total_boost = base + parity_bonus

    if weight_strength == "NO_NUMBER_WEIGHT":
        return 0.0
    elif weight_strength == "LOW_NUMBER_WEIGHT":
        return MODEL_G_MULTIPLIER * total_boost
    elif weight_strength == "MEDIUM_NUMBER_WEIGHT":
        return 0.8 * total_boost
    return 0.0


def score_candidate_model_f(
    delta_lll: int,
    cand_street: str,
    target_street: str,
    anchor_street: str,
    graph_intersect: float = 0.0,
    weights: Optional[Dict[str, float]] = None,
) -> float:
    """
    Model F (TARGET_STREET_ONLY):
    Score = w_delta / (1 + delta_lll) + w_target * match_target + w_anchor * match_anchor + w_graph * graph_int
    """
    w = weights or MODEL_F_WEIGHTS
    inv_delta = 1.0 / (1.0 + abs(delta_lll))
    match_target = 1.0 if (cand_street and target_street and cand_street == target_street) else 0.0
    match_anchor = 1.0 if (cand_street and anchor_street and cand_street == anchor_street) else 0.0

    return (
        w["w_delta_lll"] * inv_delta
        + w["w_target_street_match"] * match_target
        + w["w_anchor_street_match"] * match_anchor
        + w["w_graph_intersection"] * graph_intersect
    )


def score_candidate_model_g(
    model_f_score: float,
    cand_num: Optional[int],
    listing_num: Optional[int],
    weight_strength: str = "LOW_NUMBER_WEIGHT",
) -> float:
    """
    Model G: Model F score + soft number compatibility boost.
    """
    num_boost = score_number_compatibility(cand_num, listing_num, weight_strength)
    return model_f_score + num_boost


def generate_structural_lll_intervals(anchor_lll: int, width: int = 10) -> List[int]:
    """
    Generate bounded structural interval of LLL lot numbers around an anchor lot.
    Structural intervals are hypotheses only and do not establish parcel existence.
    """
    half_w = width // 2
    l_min = max(1, anchor_lll - half_w)
    l_max = anchor_lll + half_w
    return list(range(l_min, l_max + 1))
