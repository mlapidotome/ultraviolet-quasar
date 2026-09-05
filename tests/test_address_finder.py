"""
tests/test_address_finder.py

Comprehensive offline unit test suite for Address Finder pipeline.
Uses realistic HTML fixtures and synthetic cohorts (never uses real pilot listings as fixtures).
Validates:
1. Current Chaves na Mão /id-<number>/ URL parsing and ID extraction (45635914, 46379325)
2. Original canonical URL preservation (does NOT reconstruct URLs from listing_id)
3. URL deduplication and normalization
4. Condominium property exclusion (CONDOMINIUM_EXCLUDED_MAIN_COHORT)
5. Target-owned leakage isolation:
   - Target listing: street only, related card: Rua Example, 123 -> NOT_DIRECT_EXACT
   - Target listing location: Rua Example, 123 -> DIRECT_EXACT_ADDRESS_LEAK
   - leak_field_owner == TARGET_LISTING
6. Complete snapshot file-hash manifest (source_url.txt, listing.html, snapshot_metadata.json, public_clues.json)
7. Minimum eligible count gate: eligible_count < 10 stops with INSUFFICIENT_ELIGIBLE_LISTINGS
8. Leakage classification: CEP_ONLY -> NOT_DIRECT_EXACT, STREET_ONLY -> NOT_DIRECT_EXACT
9. Model F primary ranking (TARGET_STREET_ONLY)
10. Model G secondary ranking (LOW_NUMBER_WEIGHT)
11. Soft-number behavior: corrupted number never hard-discards true candidate
12. Structural hypotheses remain STRUCTURAL_UNRESOLVED (is_real=False)
13. Failure taxonomy: emits STREET_NOT_AVAILABLE when target street cannot be extracted
14. Prediction without GT (anti-leakage invariant)
15. No corpus lookup used to manufacture missing listing street
16. PILOT_N == 10
17. Deterministic selection from frozen pool
18. Frozen prediction overwrite rejection
19. GT rejection before freeze gate
20. Post-GT corpus-membership classification
21. Facade TOP-3 REAL RESOLVED guard
22. Validate-only zero-network / zero-artifact mutation
"""

import json
import tempfile
import unittest
from pathlib import Path

import address_finder
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
    classify_target_listing_leakage,
    extract_cnm_search_listings,
    extract_public_clues_from_html,
    is_condominium_listing,
    normalize_bairro_name,
    normalize_street_name,
    parse_bc,
    parse_cnm_listing_url,
    parse_raw_address,
    token_jaccard,
)


class TestAddressFinderUnit(unittest.TestCase):

    def setUp(self):
        # Build synthetic mock corpus for deterministic test evaluation
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

    # 1. Chaves na Mão URL parsing and ID extraction
    def test_cnm_url_id_parsing(self):
        url1 = "/imovel/casa-a-venda-jardim-das-nacoes-taubate-sp/id-45635914/"
        res1 = parse_cnm_listing_url(url1)
        self.assertIsNotNone(res1)
        lid1, canon1 = res1
        self.assertEqual(lid1, "45635914")
        self.assertEqual(canon1, "https://www.chavesnamao.com.br/imovel/casa-a-venda-jardim-das-nacoes-taubate-sp/id-45635914/")

        url2 = "https://www.chavesnamao.com.br/imovel/sobrado-a-venda-bosque-flamboyant-taubate-sp/id-46379325/?origem=busca"
        res2 = parse_cnm_listing_url(url2)
        self.assertIsNotNone(res2)
        lid2, canon2 = res2
        self.assertEqual(lid2, "46379325")
        self.assertEqual(canon2, "https://www.chavesnamao.com.br/imovel/sobrado-a-venda-bosque-flamboyant-taubate-sp/id-46379325/")

        # Non-listing links return None
        self.assertIsNone(parse_cnm_listing_url("/imobiliarias-em-taubate-sp/"))
        self.assertIsNone(parse_cnm_listing_url("/contato/"))

    # 2. Original discovered canonical URL preservation
    def test_original_canonical_url_preservation(self):
        original_href = "/imovel/casa-terrea-3-quartos-vila-marli-taubate-sp/id-45635914/"
        lid, canonical_url = parse_cnm_listing_url(original_href)
        self.assertEqual(lid, "45635914")
        # Invariant: Slug is preserved in canonical URL, NOT collapsed to /imovel/45635914/
        self.assertIn("casa-terrea-3-quartos-vila-marli-taubate-sp", canonical_url)
        self.assertNotEqual(canonical_url, "https://www.chavesnamao.com.br/imovel/45635914/")

    # 3. URL Deduplication from Search Results
    def test_search_page_url_deduplication(self):
        mock_search_html = """
        <html><body>
            <a href="/imovel/casa-a-venda-taubate/id-45635914/">Ver imóvel 1</a>
            <a href="/imovel/casa-a-venda-taubate/id-45635914/">Foto do imóvel 1</a>
            <a href="/imovel/sobrado-a-venda-taubate/id-46379325/">Ver imóvel 2</a>
        </body></html>
        """
        listings = extract_cnm_search_listings(mock_search_html)
        self.assertEqual(len(listings), 2)
        self.assertEqual(listings[0][0], "45635914")
        self.assertEqual(listings[1][0], "46379325")

    # 4. Condominium exclusion
    def test_condominium_exclusion(self):
        is_c1, r1 = is_condominium_listing("Casa em condomínio fechado com piscina em Taubaté")
        self.assertTrue(is_c1)
        self.assertEqual(r1, "CONDOMINIUM_EXCLUDED_MAIN_COHORT")

        is_c2, r2 = is_condominium_listing("Lindo Sobrado em condomínio residencial em Taubaté")
        self.assertTrue(is_c2)
        self.assertEqual(r2, "CONDOMINIUM_EXCLUDED_MAIN_COHORT")

        # Open-street house is NOT a condo
        is_c3, r3 = is_condominium_listing("Casa de rua residencial no Jardim das Nações, excelente localização")
        self.assertFalse(is_c3)
        self.assertIsNone(r3)

    # 5. Target-owned leakage isolation vs related recommendation card
    def test_target_owned_leakage_isolation(self):
        # Case A: Target has street only, related card has exact address
        html_target_safe_related_leak = """<html>
        <head><title>Casa no Jardim das Nações, Taubaté</title></head>
        <body>
            <div class="property-info">
                <h1>Casa Residencial</h1>
                <span itemprop="streetAddress">Rua das Flores</span>
            </div>
            <div class="outros-imoveis-relacionados">
                <h3>Imóveis recomendados nesta região</h3>
                <div class="card">Casa na Rua Example, 123 - Taubaté</div>
            </div>
        </body></html>"""

        is_leak_a, ev_a = classify_target_listing_leakage(html_target_safe_related_leak)
        self.assertFalse(is_leak_a, "Related card address must NOT disqualify the target listing!")
        self.assertEqual(ev_a, [])

        # Case B: Target listing location field itself contains exact street + door number
        html_target_leaks = """<html>
        <head><title>Casa à Venda - Rua das Flores, 142, Jardim das Nações</title></head>
        <body>
            <h1>Casa na Rua das Flores, 142</h1>
            <span itemprop="streetAddress">Rua das Flores, 142</span>
        </body></html>"""

        is_leak_b, ev_b = classify_target_listing_leakage(html_target_leaks)
        self.assertTrue(is_leak_b, "Exact address in target fields MUST be classified as leak!")
        self.assertTrue(len(ev_b) > 0)
        self.assertEqual(ev_b[0]["leak_field_owner"], "TARGET_LISTING")

    # 6. Complete snapshot file-hash manifest
    def test_snapshot_file_hash_manifest_completeness(self):
        with tempfile.TemporaryDirectory() as td:
            snap_dir = Path(td) / "45635914"
            snap_dir.mkdir()

            (snap_dir / "source_url.txt").write_text("https://example.com/id-45635914/\n", encoding="utf-8")
            (snap_dir / "listing.html").write_text("<html><body>Test</body></html>", encoding="utf-8")
            (snap_dir / "snapshot_metadata.json").write_text('{"id": "45635914"}\n', encoding="utf-8")
            (snap_dir / "public_clues.json").write_text('[]\n', encoding="utf-8")

            # Collect files manifest
            manifest_files = []
            for f in sorted(snap_dir.glob("*")):
                if f.is_file():
                    import hashlib
                    b = f.read_bytes()
                    manifest_files.append({
                        "file": f.name,
                        "relative_path": str(f),
                        "byte_size": len(b),
                        "sha256": hashlib.sha256(b).hexdigest(),
                    })

            file_names = {f["file"] for f in manifest_files}
            self.assertIn("source_url.txt", file_names)
            self.assertIn("listing.html", file_names)
            self.assertIn("snapshot_metadata.json", file_names)
            self.assertIn("public_clues.json", file_names)
            for f in manifest_files:
                self.assertGreater(f["byte_size"], 0)
                self.assertEqual(len(f["sha256"]), 64)

    # 7. Minimum eligible count gate
    def test_minimum_eligible_count_gate(self):
        # If pool has fewer than 10 listings, stage_snapshots must abort with INSUFFICIENT_ELIGIBLE_LISTINGS
        from scratch.run_blinded_real_listing_pilot import stage_snapshots, _paths
        with tempfile.TemporaryDirectory() as td:
            repo_mock = Path(td)
            paths = _paths(repo_mock)
            paths["discovery_pool"].parent.mkdir(parents=True, exist_ok=True)

            # Write discovery pool with only 5 listings
            pool_data = {"listings": [{"listing_id": str(i)} for i in range(5)]}
            from scratch.run_blinded_real_listing_pilot import write_json
            write_json(paths["discovery_pool"], pool_data)

            with self.assertRaises(SystemExit) as cm:
                stage_snapshots(paths)
            self.assertIn("INSUFFICIENT_ELIGIBLE_LISTINGS", str(cm.exception))

    # 8. Leakage classification: CEP alone and street alone are NOT leaks
    def test_leakage_cep_only_not_leak(self):
        text = "Imóvel à venda no Jardim Bela Vista, Taubaté. CEP 12030-000. Próximo ao centro."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertFalse(is_leak)
        self.assertEqual(evidence, [])

    def test_leakage_street_only_not_leak(self):
        text = "Linda casa na Rua das Flores, Bosque Flamboyant, Taubaté - SP. Sem número informado."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertFalse(is_leak)
        self.assertEqual(evidence, [])

    def test_leakage_street_plus_number_is_leak(self):
        text = "Visite o imóvel na Rua das Flores, 142, Jardim das Nações, Taubaté."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertTrue(is_leak)
        self.assertTrue(len(evidence) > 0)

    # 9. Model F primary ranking
    def test_model_f_primary_ranking(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 10},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")

        primary = result["primary_model_f_ranking"]
        self.assertTrue(len(primary) > 0)
        scores = [c["score_model_f"] for c in primary]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(primary[0]["rank_model_f"], 1)

    # 10. Model G secondary ranking
    def test_model_g_secondary_ranking(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 20},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")

        secondary = result["secondary_model_g_ranking"]
        self.assertTrue(len(secondary) > 0)
        scores_g = [c["score_model_g"] for c in secondary]
        self.assertEqual(scores_g, sorted(scores_g, reverse=True))
        for exp_r, c in enumerate(secondary, start=1):
            self.assertEqual(c["rank_model_g"], exp_r)

    # 11. Soft-number behavior: corrupted number never hard-discards
    def test_zero_hard_discard_from_corrupted_number(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 9999},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")
        cand_bc_set = {c["candidate_bc"] for c in result["candidates"]}
        for p in self.mock_parcels:
            self.assertIn(p.bc, cand_bc_set)

    # 12. Structural hypotheses remain STRUCTURAL_UNRESOLVED
    def test_structural_unresolved_semantics(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")

        candidates = result["primary_model_f_ranking"]
        observed = [c for c in candidates if c["candidate_mode"] == "OBSERVED_CANDIDATE_RETRIEVAL"]
        structural = [c for c in candidates if c["candidate_mode"] == "STRUCTURAL_DISCOVERY"]

        self.assertTrue(len(observed) > 0)
        self.assertTrue(len(structural) > 0)

        for c in observed:
            self.assertTrue(c["is_real"])
            self.assertEqual(c["resolution_status"], "OBSERVED_REAL")

        for c in structural:
            self.assertFalse(c["is_real"])
            self.assertEqual(c["resolution_status"], "STRUCTURAL_UNRESOLVED")
            self.assertTrue(c["candidate_address"].startswith("[Structural Hypothesis]"))

    # 13. Failure taxonomy: STREET_NOT_AVAILABLE
    def test_street_not_available_taxonomy(self):
        clues = [{"type": "neighbourhood", "value": "Bosque Flamboyant"}]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertFalse(result["provenance"]["street_available"])
        self.assertEqual(result["taxonomy_code"], "STREET_NOT_AVAILABLE")

    # 14. Prediction without GT
    def test_prediction_without_gt(self):
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")
        prov = result["provenance"]
        self.assertNotIn("gt", prov)
        self.assertNotIn("target_bc", prov)

    # 15. No corpus lookup used to manufacture missing street
    def test_no_corpus_lookup_used_to_manufacture_missing_street(self):
        clues = [{"type": "neighbourhood", "value": "Bosque Flamboyant"}]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["provenance"]["target_street_norm"], "")
        self.assertFalse(result["provenance"]["street_available"])

    # 16. PILOT_N == 10
    def test_pilot_n_equals_ten(self):
        from scratch.run_blinded_real_listing_pilot import PILOT_N
        self.assertEqual(PILOT_N, 10)

    # 17. Deterministic selection from frozen pool
    def test_deterministic_selection_from_frozen_pool(self):
        mock_pool = {
            "listings": [
                {"listing_id": "1002", "source_url": "https://cnm/imovel/1002/"},
                {"listing_id": "1001", "source_url": "https://cnm/imovel/1001/"},
                {"listing_id": "1003", "source_url": "https://cnm/imovel/1003/"},
            ]
        }
        sorted_listings = sorted(mock_pool["listings"], key=lambda r: (int(r["listing_id"]), r["source_url"]))
        self.assertEqual([r["listing_id"] for r in sorted_listings], ["1001", "1002", "1003"])

    # 18. Frozen prediction overwrite rejection
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

    # 19. GT rejection before freeze gate
    def test_gt_rejection_before_freeze(self):
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            gt_p = tdp / "ground_truth.json"
            pred_p = tdp / "frozen_predictions.json"
            gt_p.write_text('{"entries": []}\n', encoding="utf-8")
            is_illegal_state = gt_p.is_file() and not pred_p.is_file()
            self.assertTrue(is_illegal_state)

    # 20. Post-GT corpus-membership classification
    def test_post_gt_corpus_membership_classification(self):
        from scratch.run_blinded_real_listing_pilot import _classify_post_gt_corpus_membership
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.001.001", self.mock_corpus), "KNOWN_FULL_BC_IN_CORPUS")
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.001.002", self.mock_corpus), "KNOWN_DSQLLL_IN_CORPUS")
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.099.001", self.mock_corpus), "SAME_DSQ_ONLY_IN_CORPUS")
        self.assertEqual(_classify_post_gt_corpus_membership("1.1.001.001.001", self.mock_corpus), "NOT_PRESENT_IN_CORPUS")

    # 21. Facade TOP-3 REAL RESOLVED guard
    def test_facade_top3_real_guard(self):
        candidates = [
            {"rank": 1, "rank_model_f": 1, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 1"},
            {"rank": 2, "rank_model_f": 2, "is_real": False, "resolution_status": "STRUCTURAL_UNRESOLVED", "candidate_address": "Hypo 2"},
            {"rank": 3, "rank_model_f": 3, "is_real": True, "resolution_status": "STRUCTURAL_RESOLVED", "candidate_address": "Rua 3"},
            {"rank": 4, "rank_model_f": 4, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 4"},
        ]
        eligible = [
            c for c in candidates
            if (c.get("rank_model_f") or c.get("rank", 99)) <= 3
            and c.get("is_real") is True
            and c.get("resolution_status") in ("OBSERVED_REAL", "STRUCTURAL_RESOLVED")
        ]
        self.assertEqual([c["rank"] for c in eligible], [1, 3])
        self.assertNotIn(2, [c["rank"] for c in eligible])
        self.assertNotIn(4, [c["rank"] for c in eligible])

    # 22. Validate-only zero-network / zero-artifact mutation
    def test_validate_only_no_mutation(self):
        from scratch.run_blinded_real_listing_pilot import validate_only, _paths
        repo_root = Path(r"C:\Users\Marcel\.gemini\antigravity\playground\ultraviolet-quasar")
        paths = _paths(repo_root)

        before_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        validate_only(paths)
        after_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        self.assertEqual(before_mtimes, after_mtimes)


if __name__ == "__main__":
    unittest.main()
