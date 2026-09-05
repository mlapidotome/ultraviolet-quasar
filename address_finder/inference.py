"""
address_finder.inference

Production-oriented, strictly NON-GT Address Finder candidate generation and ranking pipeline.
Enforces all core scientific invariants:
- Zero ground truth input or access (anti-leakage)
- Model F (TARGET_STREET_ONLY) is the PRIMARY scientific ranking
- Model G (LOW_NUMBER_WEIGHT) is the SECONDARY noisy-number-assisted ranking
- Two explicit rankings produced: primary_model_f_ranking and secondary_model_g_ranking
- Candidate mode: OBSERVED_CANDIDATE_RETRIEVAL vs STRUCTURAL_DISCOVERY
- Reality & resolution gate: Structural hypotheses remain STRUCTURAL_UNRESOLVED (is_real=False)
- Soft house-number policy: HOUSE_NUMBER_PRESENT_UNVERIFIED is never used to hard-discard
- Meaningful failure taxonomy: emits STREET_NOT_AVAILABLE when target street cannot be extracted
- Reference parcel labeled CORPUS_REFERENCE_FOR_RANKING (no overclaim of external anchor)
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from address_finder.corpus import Corpus, NormalizedParcel
from address_finder.models import (
    FROZEN_RULES_SHA256,
    MODEL_F_WEIGHTS,
    MODEL_G_MULTIPLIER,
    generate_structural_lll_intervals,
    score_candidate_model_f,
    score_candidate_model_g,
)
from address_finder.normalization import (
    normalize_bairro_name,
    normalize_street_name,
    parse_raw_address,
)


def extract_clue_value(clues: List[Dict[str, Any]] | Dict[str, Any], clue_type: str) -> Optional[str]:
    """Helper to extract a clue by type from listing clues."""
    if isinstance(clues, dict):
        val = clues.get(clue_type)
        return str(val) if val is not None else None
    for c in clues:
        if c.get("type") == clue_type:
            return str(c.get("value", ""))
    return None


def predict_from_listing(
    public_listing_clues: List[Dict[str, Any]] | Dict[str, Any],
    corpus: Corpus,
    frozen_rules: Optional[Dict[str, Any]] = None,
    street_bindings: Optional[Dict[str, Any]] = None,
    max_candidates: int = 20,
) -> Dict[str, Any]:
    """
    Execute full deterministic Address Finder inference on public listing clues.
    STRICT ANTI-LEAKAGE INVARIANT:
    No ground truth (GT), true BC, true address, or holdout label is received or referenced.
    """
    # -------------------------------------------------------------------------
    # STAGE 1: Parse and Normalize Public Clues
    # -------------------------------------------------------------------------
    raw_bairro = extract_clue_value(public_listing_clues, "neighbourhood") or ""
    norm_bairro = normalize_bairro_name(raw_bairro)

    raw_street = extract_clue_value(public_listing_clues, "street") or ""
    norm_street = normalize_street_name(raw_street)

    raw_cep = extract_clue_value(public_listing_clues, "cep") or ""

    raw_num = extract_clue_value(public_listing_clues, "house_number")
    listing_house_number: Optional[int] = None
    if raw_num:
        m = re.search(r"\b(\d+)\b", str(raw_num))
        if m:
            listing_house_number = int(m.group(1))

    # Inspect title / description / alt-text clues ONLY if text contains a real street designator
    if not norm_street and isinstance(public_listing_clues, list):
        for c in public_listing_clues:
            val = c.get("value", "")
            if c.get("type") in ("image_alt_geo", "title", "description"):
                m_st = re.search(r"\b((?:Rua|Avenida|Alameda|Travessa|Praça|Praca|Estrada)\s+[^,]+)", val, re.I)
                if m_st:
                    parsed = parse_raw_address(m_st.group(1))
                    if parsed["street_norm"] and parsed["category"] != "DOCUMENTARY_TEXT_VACANT_LOT":
                        norm_street = parsed["street_norm"]
                        if parsed["house_number"] and not listing_house_number:
                            listing_house_number = parsed["house_number"]
                        break

    house_number_status = (
        "HOUSE_NUMBER_PRESENT_UNVERIFIED"
        if listing_house_number is not None
        else "HOUSE_NUMBER_ABSENT"
    )

    provenance = {
        "pipeline_version": "2.3",
        "corpus_sha256": corpus.corpus_sha256,
        "rules_sha256": (frozen_rules.get("sha256") if frozen_rules else FROZEN_RULES_SHA256),
        "primary_ranking": "TARGET_STREET_ONLY",
        "secondary_ranking": "LOW_NUMBER_WEIGHT",
        "target_bairro_norm": norm_bairro,
        "target_street_norm": norm_street,
        "street_available": bool(norm_street),
        "bairro_available": bool(norm_bairro),
        "cep_available": bool(raw_cep),
        "house_number_status": house_number_status,
        "listing_house_number": listing_house_number,
    }

    # Taxonomy checks for missing public inputs:
    # 1. Zero usable clues (neither bairro nor street)
    if not norm_bairro and not norm_street:
        return {
            "status": "FAILED",
            "taxonomy_code": "LISTING_CLUE_FAILURE",
            "failure_stage": "CLUE_EXTRACTION",
            "primary_model_f_ranking": [],
            "secondary_model_g_ranking": [],
            "candidates": [],
            "provenance": provenance,
        }

    # 2. Bairro is known, but street is NOT available
    street_missing = not bool(norm_street)
    taxonomy_flag: Optional[str] = "STREET_NOT_AVAILABLE" if street_missing else None

    # -------------------------------------------------------------------------
    # STAGE 2: Infer DS and DSQ Hypotheses
    # -------------------------------------------------------------------------
    candidate_dsqs: Set[str] = set()

    # Prioritize street-to-DSQ mapping if street is available
    if norm_street:
        candidate_dsqs.update(corpus.get_candidate_dsqs_for_street(norm_street))

    # Cross-reference with neighbourhood DSQ set
    if norm_bairro:
        bairro_dsqs = corpus.get_candidate_dsqs_for_bairro(norm_bairro)
        if candidate_dsqs:
            intersection = candidate_dsqs.intersection(bairro_dsqs)
            if intersection:
                candidate_dsqs = intersection
        else:
            candidate_dsqs.update(bairro_dsqs)

    if not candidate_dsqs:
        # Check if DS alone could be localized
        matched_ds = bool(norm_bairro and corpus.get_candidate_dsqs_for_bairro(norm_bairro))
        tax_code = "DSQ_FAILURE" if matched_ds else ("STREET_NOT_AVAILABLE" if street_missing else "DS_FAILURE")
        return {
            "status": "FAILED",
            "taxonomy_code": tax_code,
            "failure_stage": "DSQ_HYPOTHESIS",
            "primary_model_f_ranking": [],
            "secondary_model_g_ranking": [],
            "candidates": [],
            "provenance": provenance,
        }

    # -------------------------------------------------------------------------
    # STAGE 3: Retrieve Legitimate Observed Candidates & Choose Reference Parcel
    # -------------------------------------------------------------------------
    observed_candidates: List[NormalizedParcel] = []
    for dsq in sorted(candidate_dsqs):
        observed_candidates.extend(corpus.get_parcels_in_dsq(dsq))

    if not observed_candidates:
        return {
            "status": "FAILED",
            "taxonomy_code": "NO_ANCHOR",
            "failure_stage": "ANCHOR_RETRIEVAL",
            "primary_model_f_ranking": [],
            "secondary_model_g_ranking": [],
            "candidates": [],
            "provenance": provenance,
        }

    # Group observed candidates by DSQ to choose reference parcels for relative LLL delta
    parcels_by_dsq: Dict[str, List[NormalizedParcel]] = {}
    for p in observed_candidates:
        parcels_by_dsq.setdefault(p.dsq, []).append(p)

    scored_entries: List[Dict[str, Any]] = []

    for dsq, plist in parcels_by_dsq.items():
        if not plist:
            continue
        # Choose a corpus reference parcel for relative LLL scoring in this DSQ.
        # SEMANTICS: This is labeled CORPUS_REFERENCE_FOR_RANKING (never overclaimed as external GT anchor)
        ref_parcel = next((p for p in plist if p.normalized_street == norm_street), None)
        if not ref_parcel:
            sorted_by_lll = sorted(plist, key=lambda x: x.lll)
            ref_parcel = sorted_by_lll[len(sorted_by_lll) // 2]

        ref_lll = ref_parcel.lll
        ref_street = ref_parcel.normalized_street

        # Cross-street lookup if bindings are supplied
        def are_cross_streets(s1: str, s2: str) -> float:
            if not street_bindings or not s1 or not s2:
                return 0.0
            b1 = street_bindings.get(s1, {})
            b2 = street_bindings.get(s2, {})
            osm1 = b1.get("matched_osm_key")
            osm2 = b2.get("matched_osm_key")
            if osm1 and osm2:
                if osm1 in b2.get("direct_cross_streets", []) or osm2 in b1.get("direct_cross_streets", []):
                    return 1.0
            return 0.0

        # ---------------------------------------------------------------------
        # STAGE 4: Model F & Model G Scoring of Observed Parcels
        # ---------------------------------------------------------------------
        for p in plist:
            delta_lll = p.lll - ref_lll
            graph_int = are_cross_streets(p.normalized_street, norm_street)

            score_f = score_candidate_model_f(
                delta_lll=delta_lll,
                cand_street=p.normalized_street,
                target_street=norm_street,
                anchor_street=ref_street,
                graph_intersect=graph_int,
                weights=MODEL_F_WEIGHTS,
            )

            score_g = score_candidate_model_g(
                model_f_score=score_f,
                cand_num=p.house_number,
                listing_num=listing_house_number,
                weight_strength="LOW_NUMBER_WEIGHT",
            )

            scored_entries.append({
                "candidate_bc": p.bc,
                "candidate_dsqlll": p.dsqlll,
                "candidate_address": p.endereco or f"{p.normalized_street}, {p.house_number or 'S/N'}",
                "street_norm": p.normalized_street,
                "house_number": p.house_number,
                "dsq": p.dsq,
                "lll": p.lll,
                "score_model_f": score_f,
                "score_model_g": score_g,
                "candidate_mode": "OBSERVED_CANDIDATE_RETRIEVAL",
                "is_real": True,
                "resolution_status": "OBSERVED_REAL",
                "source_signal": "CORPUS_OBSERVED_PARCEL",
                "reference_type": "CORPUS_REFERENCE_FOR_RANKING",
                "reference_dsqlll": ref_parcel.dsqlll,
            })

        # ---------------------------------------------------------------------
        # STAGE 5: Structural LLL Hypotheses (Search Intervals)
        # ---------------------------------------------------------------------
        observed_llls = {p.lll for p in plist}
        hypo_llls = generate_structural_lll_intervals(anchor_lll=ref_lll, width=10)
        for h_lll in hypo_llls:
            if h_lll in observed_llls:
                continue  # Already represented by observed candidate record

            delta_lll = h_lll - ref_lll
            score_f_hypo = score_candidate_model_f(
                delta_lll=delta_lll,
                cand_street="",
                target_street=norm_street,
                anchor_street=ref_street,
                graph_intersect=0.0,
            )

            # MANDATORY RESOLUTION SEMANTICS:
            # Structural hypotheses are search hypotheses only.
            # Without an external legitimate resolver, they remain STRUCTURAL_UNRESOLVED and is_real = False.
            hypo_bc = f"{dsq}.{h_lll:03d}.001"
            hypo_dsqlll = f"{dsq}.{h_lll:03d}"

            scored_entries.append({
                "candidate_bc": hypo_bc,
                "candidate_dsqlll": hypo_dsqlll,
                "candidate_address": f"[Structural Hypothesis] {hypo_dsqlll}",
                "street_norm": "",
                "house_number": None,
                "dsq": dsq,
                "lll": h_lll,
                "score_model_f": score_f_hypo * 0.8,  # Search penalty for unresolved hypotheses
                "score_model_g": score_f_hypo * 0.8,
                "candidate_mode": "STRUCTURAL_DISCOVERY",
                "is_real": False,
                "resolution_status": "STRUCTURAL_UNRESOLVED",
                "source_signal": "STRUCTURAL_LLL_INTERVAL",
                "reference_type": "CORPUS_REFERENCE_FOR_RANKING",
                "reference_dsqlll": ref_parcel.dsqlll,
            })

    if not scored_entries:
        return {
            "status": "FAILED",
            "taxonomy_code": "LLL_GENERATION_MISS",
            "failure_stage": "LLL_GENERATION",
            "primary_model_f_ranking": [],
            "secondary_model_g_ranking": [],
            "candidates": [],
            "provenance": provenance,
        }

    # -------------------------------------------------------------------------
    # STAGE 6: Deduplication and Dual Rankings Generation
    # -------------------------------------------------------------------------
    # Deduplicate by candidate_dsqlll
    unique_by_dsqlll: Dict[str, Dict[str, Any]] = {}
    for entry in scored_entries:
        key = entry["candidate_dsqlll"]
        if key not in unique_by_dsqlll or entry["score_model_f"] > unique_by_dsqlll[key]["score_model_f"]:
            unique_by_dsqlll[key] = entry

    all_candidates = list(unique_by_dsqlll.values())

    # PRIMARY RANKING: MODEL F (TARGET_STREET_ONLY)
    sorted_by_f = sorted(all_candidates, key=lambda x: x["score_model_f"], reverse=True)
    primary_model_f_ranking: List[Dict[str, Any]] = []
    for rank_idx, item in enumerate(sorted_by_f[:max_candidates], start=1):
        item_copy = dict(item)
        item_copy["rank"] = rank_idx
        item_copy["rank_model_f"] = rank_idx
        item_copy["score"] = item_copy["score_model_f"]  # Default score is Model F
        primary_model_f_ranking.append(item_copy)

    # SECONDARY RANKING: MODEL G (LOW_NUMBER_WEIGHT)
    sorted_by_g = sorted(all_candidates, key=lambda x: x["score_model_g"], reverse=True)
    secondary_model_g_ranking: List[Dict[str, Any]] = []
    for rank_idx, item in enumerate(sorted_by_g[:max_candidates], start=1):
        item_copy = dict(item)
        item_copy["rank"] = rank_idx
        item_copy["rank_model_g"] = rank_idx
        item_copy["score"] = item_copy["score_model_g"]
        secondary_model_g_ranking.append(item_copy)

    # Reality check
    has_real_candidate = any(c["is_real"] for c in primary_model_f_ranking)
    if not has_real_candidate:
        return {
            "status": "FAILED",
            "taxonomy_code": "CANDIDATE_RESOLUTION_FAILURE",
            "failure_stage": "CANDIDATE_RESOLUTION",
            "primary_model_f_ranking": primary_model_f_ranking,
            "secondary_model_g_ranking": secondary_model_g_ranking,
            "candidates": primary_model_f_ranking,
            "provenance": provenance,
        }

    return {
        "status": "SUCCESS",
        "taxonomy_code": taxonomy_flag,
        "primary_model_f_ranking": primary_model_f_ranking,
        "secondary_model_g_ranking": secondary_model_g_ranking,
        "candidates": primary_model_f_ranking,  # Defaults to primary Model F ranking
        "provenance": provenance,
    }
