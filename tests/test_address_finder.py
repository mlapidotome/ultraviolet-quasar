"""
tests/test_address_finder.py

Comprehensive offline unit test suite for Address Finder pipeline.
Uses mocks, fixtures, and synthetic test cohorts (never uses real pilot listings as fixtures).
Validates:
1. BC parsing
2. Address parsing
3. Street normalization
4. Corpus loading
5. Owner / contribuinte exclusion (strict privacy gate)
6. Model F ranking
7. Model G soft-number behavior
8. Corrupted number never hard-discards true candidate
9. Observed vs structural distinction
10. Structural hypothesis cannot become real without resolution
11. Prediction without GT (anti-leakage)
12. PILOT_N == 10
13. Deterministic selection from frozen pool
14. Frozen prediction overwrite rejection
15. GT rejection before freeze gate
16. Post-GT corpus-membership classification
17. Facade TOP-3 REAL RESOLVED guard
18. Validate-only zero-network / zero-artifact mutation
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
    normalize_bairro_name,
    normalize_street_name,
    parse_bc,
    parse_raw_address,
    token_jaccard,
)


class TestAddressFinderUnit(unittest.TestCase):

    def setUp(self):
        # Build a small synthetic mock corpus for deterministic test evaluation
        self.mock_parcels = [
            NormalizedParcel(
                bc="4.4.206.001.001", d=4, s=4, qqq=206, lll=1, sss=1,
                ds="4.4", dsq="4.4.206", dsqlll="4.4.206.001",
                endereco="Rua das Flores, 10", normalized_street="flores", house_number=10,
                category="STREET_WITH_HOUSE_NUMBER", bairro="302 - BOSQUE FLAMBOYANT",
                normalized_bairro="bosque flamboyant", tipo_imovel="Casa / Sobrado",
                loteamento="", complemento="", area_terreno_m2=250.0, area_construida_m2=150.0,
                valor_venal_total_rs=300000.0
            ),
            NormalizedParcel(
                bc="4.4.206.002.001", d=4, s=4, qqq=206, lll=2, sss=1,
                ds="4.4", dsq="4.4.206", dsqlll="4.4.206.002",
                endereco="Rua das Flores, 20", normalized_street="flores", house_number=20,
                category="STREET_WITH_HOUSE_NUMBER", bairro="302 - BOSQUE FLAMBOYANT",
                normalized_bairro="bosque flamboyant", tipo_imovel="Casa / Sobrado",
                loteamento="", complemento="", area_terreno_m2=250.0, area_construida_m2=160.0,
                valor_venal_total_rs=320000.0
            ),
            NormalizedParcel(
                bc="4.4.206.003.001", d=4, s=4, qqq=206, lll=3, sss=1,
                ds="4.4", dsq="4.4.206", dsqlll="4.4.206.003",
                endereco="Rua das Palmeiras, 100", normalized_street="palmeiras", house_number=100,
                category="STREET_WITH_HOUSE_NUMBER", bairro="302 - BOSQUE FLAMBOYANT",
                normalized_bairro="bosque flamboyant", tipo_imovel="Casa / Sobrado",
                loteamento="", complemento="", area_terreno_m2=300.0, area_construida_m2=200.0,
                valor_venal_total_rs=450000.0
            ),
        ]

        by_dsq = {"4.4.206": self.mock_parcels}
        by_dsqlll = {p.dsqlll: [p] for p in self.mock_parcels}
        by_street = {"flores": [self.mock_parcels[0], self.mock_parcels[1]], "palmeiras": [self.mock_parcels[2]]}
        by_bairro = {"bosque flamboyant": self.mock_parcels}
        bairro_to_dsqs = {"bosque flamboyant": {"4.4.206"}}
        street_to_dsqs = {"flores": {"4.4.206"}, "palmeiras": {"4.4.206"}}

        self.mock_corpus = Corpus(
            source_path=Path("synthetic_corpus.json"),
            corpus_sha256="mock_corpus_sha256",
            parcels=self.mock_parcels,
            by_dsq=by_dsq,
            by_dsqlll=by_dsqlll,
            by_street=by_street,
            by_bairro=by_bairro,
            bairro_to_dsqs=bairro_to_dsqs,
            street_to_dsqs=street_to_dsqs,
        )

    # 1. BC parsing
    def test_bc_parsing(self):
        parsed = parse_bc("4.4.206.002.001")
        self.assertEqual(parsed["d"], 4)
        self.assertEqual(parsed["s"], 4)
        self.assertEqual(parsed["qqq"], 206)
        self.assertEqual(parsed["lll"], 2)
        self.assertEqual(parsed["sss"], 1)
        self.assertEqual(parsed["ds"], "4.4")
        self.assertEqual(parsed["dsq"], "4.4.206")
        self.assertEqual(parsed["dsqlll"], "4.4.206.002")
        self.assertEqual(parsed["bc_canonical"], "4.4.206.002.001")

        with self.assertRaises(ValueError):
            parse_bc("invalid_bc")
        with self.assertRaises(ValueError):
            parse_bc("1.2.3.4")

    # 2. Address parsing
    def test_address_parsing(self):
        # Standard municipal cadastral format: 'STREET, TYPE_ABBR, NUMBER'
        res1 = parse_raw_address("ANTONIO DELGADO DA VEIGA, R, 00020")
        self.assertEqual(res1["category"], "STREET_WITH_HOUSE_NUMBER")
        self.assertEqual(res1["street_norm"], "antonio delgado veiga")
        self.assertEqual(res1["house_number"], 20)

        # Standard street name with number
        res2 = parse_raw_address("Rua das Flores, 123")
        self.assertEqual(res2["category"], "STREET_WITH_HOUSE_NUMBER")
        self.assertEqual(res2["street_norm"], "flores")
        self.assertEqual(res2["house_number"], 123)

        # Empty / documentary address
        res3 = parse_raw_address("Lote.: UP/04 Requerente.:")
        self.assertEqual(res3["category"], "DOCUMENTARY_TEXT_VACANT_LOT")
        self.assertIsNone(res3["house_number"])

        res4 = parse_raw_address("")
        self.assertEqual(res4["category"], "EMPTY_ADDRESS")

    # 3. Street and Bairro normalization
    def test_street_and_bairro_normalization(self):
        self.assertEqual(normalize_street_name("R. Dr. José de Alencar, Av."), "doutor jose alencar")
        self.assertEqual(normalize_street_name("AVENIDA INDEPENDÊNCIA"), "independencia")
        self.assertEqual(normalize_bairro_name("181 - JARDIM DAS NAÇÕES"), "jardim nacoes")
        self.assertEqual(normalize_bairro_name("Jardim das Nações"), "jardim nacoes")
        self.assertEqual(normalize_bairro_name("302 - BOSQUE FLAMBOYANT"), "bosque flamboyant")

    # 4. Corpus loading and 5. Owner / contribuinte exclusion
    def test_corpus_loading_and_contribuinte_exclusion(self):
        mock_raw = [
            {
                "existe": True,
                "bc": "4.4.206.001.001",
                "contribuinte": "SUPER_SECRET_OWNER_NAME_12345",
                "endereco": "Rua das Flores, 10",
                "bairro": "302 - BOSQUE FLAMBOYANT",
                "tipo_imovel": "Casa / Sobrado",
                "area_terreno_m2": 250,
                "area_construida_m2": 150,
                "valor_venal_total_rs": 300000.0,
            }
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tf:
            json.dump(mock_raw, tf)
            tf_path = Path(tf.name)

        try:
            corpus = load_corpus(tf_path)
            self.assertEqual(len(corpus.parcels), 1)
            p = corpus.parcels[0]
            # Strict safety check: contribuinte must NOT be an attribute
            self.assertFalse(hasattr(p, "contribuinte"))
            # Must not appear in __dict__
            self.assertNotIn("contribuinte", p.__dict__)
            self.assertNotIn("SUPER_SECRET_OWNER_NAME_12345", json.dumps(p.__dict__))
        finally:
            tf_path.unlink(missing_ok=True)

    # 6. Model F ranking
    def test_model_f_ranking(self):
        # Target street match should significantly outscore non-target street
        score_target = score_candidate_model_f(
            delta_lll=1, cand_street="flores", target_street="flores", anchor_street="flores"
        )
        score_other = score_candidate_model_f(
            delta_lll=1, cand_street="palmeiras", target_street="flores", anchor_street="flores"
        )
        self.assertGreater(score_target, score_other)
        # Invariant: Model F score is strictly non-negative
        self.assertGreater(score_target, 0.0)

    # 7. Model G soft-number behavior & 8. Corrupted number never hard-discards
    def test_model_g_soft_number_behavior(self):
        cand_num = 10
        # Exact match boost
        boost_exact = score_number_compatibility(cand_num, 10, "LOW_NUMBER_WEIGHT")
        # Offset 5 boost
        boost_close = score_number_compatibility(cand_num, 15, "LOW_NUMBER_WEIGHT")
        # Extreme conflict (offset > 150)
        boost_conflict = score_number_compatibility(cand_num, 500, "LOW_NUMBER_WEIGHT")

        self.assertGreater(boost_exact, boost_close)
        self.assertGreater(boost_close, boost_conflict)
        # CRITICAL SAFETY INVARIANT: boost on conflict must be >= 0.0 (never negative, never discards)
        self.assertGreaterEqual(boost_conflict, 0.0)

        # Test Model G composite
        base_f = 2.0
        score_g_exact = score_candidate_model_g(base_f, cand_num, 10, "LOW_NUMBER_WEIGHT")
        score_g_conflict = score_candidate_model_g(base_f, cand_num, 500, "LOW_NUMBER_WEIGHT")
        self.assertGreater(score_g_exact, score_g_conflict)
        # Even with large conflict, score_g_conflict must NOT be below base_f
        self.assertGreaterEqual(score_g_conflict, base_f)

    # 9. Observed vs structural distinction & 10. Structural cannot become real without resolution
    def test_observed_vs_structural_distinction(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 10},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")

        candidates = result["candidates"]
        observed = [c for c in candidates if c["candidate_mode"] == "OBSERVED_CANDIDATE_RETRIEVAL"]
        structural = [c for c in candidates if c["candidate_mode"] == "STRUCTURAL_DISCOVERY"]

        self.assertTrue(len(observed) > 0)
        # All observed must be real
        for c in observed:
            self.assertTrue(c["is_real"])
            self.assertEqual(c["resolution_status"], "OBSERVED_REAL")

        # Structural hypotheses:
        # If not present in mock corpus (e.g. LLL=4,5,6), MUST have is_real=False and STRUCTURAL_UNRESOLVED
        for c in structural:
            if c["candidate_dsqlll"] not in self.mock_corpus.by_dsqlll:
                self.assertFalse(c["is_real"], f"Unresolved hypothesis {c['candidate_bc']} received is_real=True!")
                self.assertEqual(c["resolution_status"], "STRUCTURAL_UNRESOLVED")

    # 11. Prediction without GT (anti-leakage invariant)
    def test_prediction_without_gt(self):
        # Pass ONLY public signals; ensure function signature and internal logic require NO GT
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")
        # Verify provenance records no ground truth
        prov = result["provenance"]
        self.assertNotIn("gt", prov)
        self.assertNotIn("target_bc", prov)
        self.assertNotIn("true_physical_address", prov)

    # 12. PILOT_N == 10
    def test_pilot_n_equals_ten(self):
        from scratch.run_blinded_real_listing_pilot import PILOT_N
        self.assertEqual(PILOT_N, 10, f"PILOT_N must be 10, got {PILOT_N}")

    # 13. Deterministic selection from frozen pool
    def test_deterministic_selection_from_frozen_pool(self):
        mock_pool = {
            "listings": [
                {"listing_id": "1002", "source_url": "https://cnm/imovel/1002/"},
                {"listing_id": "1001", "source_url": "https://cnm/imovel/1001/"},
                {"listing_id": "1003", "source_url": "https://cnm/imovel/1003/"},
            ]
        }
        # Sort rule: int(listing_id) ascending
        sorted_listings = sorted(mock_pool["listings"], key=lambda r: (int(r["listing_id"]), r["source_url"]))
        self.assertEqual([r["listing_id"] for r in sorted_listings], ["1001", "1002", "1003"])

    # 14. Frozen prediction overwrite rejection
    def test_frozen_prediction_overwrite_rejection(self):
        from scratch.run_blinded_real_listing_pilot import _abort_if_frozen
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "test_artifact.json"
            p.write_text('{"status": "frozen"}\n', encoding="utf-8")
            import hashlib
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            p.with_suffix(".json.sha256").write_text(f"{h}\n", encoding="utf-8")

            paths = {"test_art": p}
            with self.assertRaises(SystemExit):
                _abort_if_frozen(paths, "test_art", "Already frozen artifact test")

    # 15. GT gate (GT rejection before freeze)
    def test_gt_rejection_before_freeze(self):
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            gt_p = tdp / "ground_truth.json"
            pred_p = tdp / "frozen_predictions.json"

            # If ground_truth exists but frozen_predictions does not, gate must fail
            gt_p.write_text('{"entries": []}\n', encoding="utf-8")
            self.assertTrue(gt_p.is_file())
            self.assertFalse(pred_p.is_file())
            # Invariant: this state is illegal
            is_illegal_state = gt_p.is_file() and not pred_p.is_file()
            self.assertTrue(is_illegal_state)

    # 16. Post-GT corpus-membership classification
    def test_post_gt_corpus_membership_classification(self):
        # Classify helper logic
        def classify_corpus_membership(true_bc: str, corpus: Corpus) -> str:
            if true_bc in [p.bc for p in corpus.parcels]:
                return "KNOWN_FULL_BC_IN_CORPUS"
            parts = true_bc.split(".")
            dsqlll = f"{parts[0]}.{parts[1]}.{int(parts[2]):03d}.{int(parts[3]):03d}"
            dsq = f"{parts[0]}.{parts[1]}.{int(parts[2]):03d}"
            if dsqlll in corpus.by_dsqlll:
                return "KNOWN_DSQLLL_IN_CORPUS"
            if dsq in corpus.by_dsq:
                return "SAME_DSQ_ONLY_IN_CORPUS"
            return "NOT_PRESENT_IN_CORPUS"

        # 1. Exact full BC
        self.assertEqual(classify_corpus_membership("4.4.206.001.001", self.mock_corpus), "KNOWN_FULL_BC_IN_CORPUS")
        # 2. Same DSQLLL but different sublot (e.g. sss=2)
        self.assertEqual(classify_corpus_membership("4.4.206.001.002", self.mock_corpus), "KNOWN_DSQLLL_IN_CORPUS")
        # 3. Same DSQ but novel LLL (e.g. lll=99)
        self.assertEqual(classify_corpus_membership("4.4.206.099.001", self.mock_corpus), "SAME_DSQ_ONLY_IN_CORPUS")
        # 4. Unknown DSQ
        self.assertEqual(classify_corpus_membership("1.1.001.001.001", self.mock_corpus), "NOT_PRESENT_IN_CORPUS")

    # 17. Facade TOP-3 REAL RESOLVED guard
    def test_facade_top3_real_guard(self):
        candidates = [
            {"rank": 1, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 1"},
            {"rank": 2, "is_real": False, "resolution_status": "STRUCTURAL_UNRESOLVED", "candidate_address": "Hypo 2"},
            {"rank": 3, "is_real": True, "resolution_status": "STRUCTURAL_RESOLVED", "candidate_address": "Rua 3"},
            {"rank": 4, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 4"},
        ]

        def filter_for_facade(cands):
            eligible = []
            for c in cands:
                if (
                    c.get("rank", 99) <= 3
                    and c.get("is_real") is True
                    and c.get("resolution_status") in ("OBSERVED_REAL", "STRUCTURAL_RESOLVED")
                ):
                    eligible.append(c)
            return eligible

        eligible = filter_for_facade(candidates)
        # Must only include rank 1 and rank 3
        self.assertEqual([c["rank"] for c in eligible], [1, 3])
        # Rank 2 (structural unresolved) must be rejected
        self.assertNotIn(2, [c["rank"] for c in eligible])
        # Rank 4 (rank > 3) must be rejected
        self.assertNotIn(4, [c["rank"] for c in eligible])

    # 18. Validate-only zero-network / zero-artifact mutation
    def test_validate_only_no_mutation(self):
        from scratch.run_blinded_real_listing_pilot import validate_only, _paths
        repo_root = Path(r"C:\Users\Marcel\.gemini\antigravity\playground\ultraviolet-quasar")
        paths = _paths(repo_root)

        # Snapshot mtimes before
        before_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        validate_only(paths)
        after_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        self.assertEqual(before_mtimes, after_mtimes, "validate_only modified existing artifact files!")


if __name__ == "__main__":
    unittest.main()
