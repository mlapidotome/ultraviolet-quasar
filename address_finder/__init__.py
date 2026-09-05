"""
address_finder

Production Address Finder inference package for Blinded Real-Listing Pilot.
Implements non-GT candidate generation, cadastral corpus indexing,
Model F (TARGET_STREET_ONLY) primary ranking, Model G (LOW_NUMBER_WEIGHT) secondary ranking,
HTML public clue extraction, and exact-address leakage classification.
"""

from address_finder.corpus import Corpus, NormalizedParcel, load_corpus
from address_finder.inference import predict_from_listing
from address_finder.models import (
    FROZEN_RULES_SHA256,
    MODEL_F_WEIGHTS,
    MODEL_G_MULTIPLIER,
    generate_structural_lll_intervals,
    score_candidate_model_f,
    score_candidate_model_g,
    score_number_compatibility,
)
from address_finder.normalization import (
    classify_direct_address_leakage,
    extract_public_clues_from_html,
    normalize_bairro_name,
    normalize_street_name,
    parse_bc,
    parse_raw_address,
    token_jaccard,
)

__all__ = [
    "Corpus",
    "NormalizedParcel",
    "load_corpus",
    "predict_from_listing",
    "extract_public_clues_from_html",
    "classify_direct_address_leakage",
    "normalize_street_name",
    "normalize_bairro_name",
    "parse_raw_address",
    "parse_bc",
    "token_jaccard",
    "score_candidate_model_f",
    "score_candidate_model_g",
    "score_number_compatibility",
    "generate_structural_lll_intervals",
    "FROZEN_RULES_SHA256",
    "MODEL_F_WEIGHTS",
    "MODEL_G_MULTIPLIER",
]
