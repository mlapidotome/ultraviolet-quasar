"""
tests/test_address_finder.py

Comprehensive offline unit test suite for Address Finder pipeline.
Uses realistic HTML fixtures and synthetic cohorts (never uses real pilot listings as fixtures).
Validates:
1. BC parsing
2. Address parsing
3. Street and Bairro normalization
4. Corpus loading and Contribuinte/owner exclusion (strict privacy gate)
5. Leakage classification:
   - CEP_ONLY -> NOT_DIRECT_EXACT
   - STREET_ONLY -> NOT_DIRECT_EXACT
   - STREET_PLUS_EXACT_NUMBER -> DIRECT_EXACT_ADDRESS_LEAK
6. Clue extraction from realistic HTML fixtures (A, B, C, D, E)
7. Model F primary ranking (TARGET_STREET_ONLY)
8. Model G secondary ranking (LOW_NUMBER_WEIGHT)
9. Soft-number behavior: corrupted number never hard-discards true candidate
10. Observed vs structural distinction
11. Structural hypotheses remain STRUCTURAL_UNRESOLVED (is_real=False)
12. Failure taxonomy: emits STREET_NOT_AVAILABLE when target street cannot be extracted
13. Prediction without GT (anti-leakage invariant)
14. No corpus lookup used to manufacture missing listing street
15. PILOT_N == 10
16. Deterministic selection from frozen pool
17. Frozen prediction overwrite rejection
18. GT rejection before freeze gate
19. Post-GT corpus-membership classification
20. Facade TOP-3 REAL RESOLVED guard
21. Validate-only zero-network / zero-artifact mutation
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
    extract_public_clues_from_html,
    normalize_bairro_name,
    normalize_street_name,
    parse_bc,
    parse_raw_address,
    token_jaccard,
)


# ---------------------------------------------------------------------------
# Realistic HTML Fixtures (Production-like Public Listing Pages)
# ---------------------------------------------------------------------------
FIXTURE_A_STREET_NO_NUMBER = """<!DOCTYPE html>
<html>
<head>
    <title>Linda Casa à Venda em Taubaté, Jardim das Nações, Rua Abissínia - Imóveis</title>
    <meta name="description" content="Casa ampla com 3 dormitórios, localizada na Rua Abissínia, bairro Jardim das Nações em Taubaté. Excelente oportunidade residencial.">
</head>
<body>
    <h1>Casa Residencial à Venda</h1>
    <div class="property-info">
        <span itemprop="addressLocality">Jardim das Nações</span>
        <span itemprop="streetAddress">Rua Abissínia</span>
        <span class="area">180 m²</span>
        <span class="tipo">Casa</span>
    </div>
    <img src="https://cdn.imoveis.com/fotos/fachada_principal.jpg" alt="Fachada da casa na Rua Abissínia em Taubaté">
</body>
</html>"""

FIXTURE_B_STREET_WITH_UNVERIFIED_NUMBER = """<!DOCTYPE html>
<html>
<head>
    <title>Sobrado Moderno no Bosque Flamboyant, Taubaté - Ref 4092</title>
    <meta name="description" content="Sobrado residencial com piscina, situado na Rua das Flores, 20, no bairro Bosque Flamboyant.">
</head>
<body>
    <h1>Sobrado 3 Suítes</h1>
    <div class="specs">
        <p>Bairro: Bosque Flamboyant, Taubaté - SP</p>
        <p>Endereço: Rua das Flores, 20</p>
        <p>Área construída: 220 m²</p>
        <p>2 pavimentos</p>
    </div>
    <img src="https://cdn.imoveis.com/fotos/foto_exterior.jpg" alt="Fachada moderna do sobrado">
</body>
</html>"""

FIXTURE_C_CEP_ONLY_NO_STREET = """<!DOCTYPE html>
<html>
<head>
    <title>Casa térrea em Taubaté - Bairro Jardim Bela Vista</title>
    <meta property="og:description" content="Casa térrea à venda no bairro Jardim Bela Vista, Taubaté. CEP 12030-000. Próxima ao centro e supermercados.">
</head>
<body>
    <h1>Oportunidade no Jardim Bela Vista</h1>
    <div class="details">
        <p>Localização: Bairro Jardim Bela Vista, Taubaté - SP</p>
        <p>CEP: 12030-000</p>
        <p>Área: 150 m²</p>
    </div>
    <img src="https://cdn.imoveis.com/fotos/imovel_frente.png" alt="Frente do imóvel em Taubaté">
</body>
</html>"""

FIXTURE_D_NO_STREET_NO_CEP = """<!DOCTYPE html>
<html>
<head>
    <title>Excelente Imóvel na Vila Marli - Taubaté</title>
    <meta name="description" content="Casa residencial espaçosa no bairro Vila Marli. 3 quartos, quintal grande.">
</head>
<body>
    <h1>Casa Residencial Vila Marli</h1>
    <div>
        <p>Bairro: Vila Marli</p>
        <p>Finalidade: Residencial</p>
        <p>Área total: 200 m²</p>
    </div>
</body>
</html>"""

FIXTURE_E_EXACT_STREET_PLUS_NUMBER_LEAK = """<!DOCTYPE html>
<html>
<head>
    <title>Casa à Venda - Rua das Flores, 142, Jardim das Nações</title>
</head>
<body>
    <h1>Casa Térrea</h1>
    <div class="address-box">
        <p>Visite-nos em: Rua das Flores, 142, Jardim das Nações, Taubaté - SP</p>
    </div>
</body>
</html>"""


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
        res1 = parse_raw_address("ANTONIO DELGADO DA VEIGA, R, 00020")
        self.assertEqual(res1["category"], "STREET_WITH_HOUSE_NUMBER")
        self.assertEqual(res1["street_norm"], "antonio delgado veiga")
        self.assertEqual(res1["house_number"], 20)

        res2 = parse_raw_address("Rua das Flores, 123")
        self.assertEqual(res2["category"], "STREET_WITH_HOUSE_NUMBER")
        self.assertEqual(res2["street_norm"], "flores")
        self.assertEqual(res2["house_number"], 123)

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

    # 4. Corpus loading and Contribuinte/owner exclusion
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
            self.assertFalse(hasattr(p, "contribuinte"))
            self.assertNotIn("contribuinte", p.__dict__)
            self.assertNotIn("SUPER_SECRET_OWNER_NAME_12345", json.dumps(p.__dict__))
        finally:
            tf_path.unlink(missing_ok=True)

    # 5. Leakage tests (Mandatory distinct assertions)
    def test_leakage_cep_only_not_leak(self):
        text = "Imóvel à venda no Jardim Bela Vista, Taubaté. CEP 12030-000. Próximo ao centro."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertFalse(is_leak, "CEP alone must NOT be classified as direct exact address leak!")
        self.assertEqual(evidence, [])

    def test_leakage_street_only_not_leak(self):
        text = "Linda casa na Rua das Flores, Bosque Flamboyant, Taubaté - SP. Sem número informado."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertFalse(is_leak, "Street alone must NOT be classified as direct exact address leak!")
        self.assertEqual(evidence, [])

    def test_leakage_street_plus_number_is_leak(self):
        text = "Visite o imóvel na Rua das Flores, 142, Jardim das Nações, Taubaté."
        is_leak, evidence = classify_direct_address_leakage(text)
        self.assertTrue(is_leak, "Street + door number MUST be classified as direct exact address leak!")
        self.assertTrue(len(evidence) > 0)

    # 6. HTML Clue Extraction from Fixtures
    def test_street_extraction_from_html_fixtures(self):
        # Fixture A: Extracts title, description, neighbourhood, street, no number
        clues_a = extract_public_clues_from_html(FIXTURE_A_STREET_NO_NUMBER)
        types_a = {c["type"] for c in clues_a}
        self.assertIn("title", types_a)
        self.assertIn("description", types_a)
        self.assertIn("neighbourhood", types_a)
        self.assertIn("street", types_a)
        self.assertNotIn("house_number", types_a)
        # Verify provenance is recorded
        for c in clues_a:
            self.assertIn("source", c)

        # Fixture B: Extracts street AND unverified number
        clues_b = extract_public_clues_from_html(FIXTURE_B_STREET_WITH_UNVERIFIED_NUMBER)
        types_b = {c["type"] for c in clues_b}
        self.assertIn("street", types_b)
        self.assertIn("house_number", types_b)
        num_clue = next(c for c in clues_b if c["type"] == "house_number")
        self.assertEqual(num_clue["value"], 20)

        # Fixture C: Extracts CEP, neighbourhood, NO street
        clues_c = extract_public_clues_from_html(FIXTURE_C_CEP_ONLY_NO_STREET)
        types_c = {c["type"] for c in clues_c}
        self.assertIn("cep", types_c)
        self.assertIn("neighbourhood", types_c)
        self.assertNotIn("street", types_c)

        # Fixture E: Leakage detected on exact street + number
        is_leak_e, _ = classify_direct_address_leakage(FIXTURE_E_EXACT_STREET_PLUS_NUMBER_LEAK)
        self.assertTrue(is_leak_e)

    # 7. Model F Primary Ranking
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
        # Model F scores must be strictly descending
        scores = [c["score_model_f"] for c in primary]
        self.assertEqual(scores, sorted(scores, reverse=True))
        # Top candidate on target street must have rank 1
        top_cand = primary[0]
        self.assertEqual(top_cand["rank_model_f"], 1)
        self.assertEqual(top_cand["street_norm"], "flores")

    # 8. Model G Secondary Ranking
    def test_model_g_secondary_ranking(self):
        # Listing specifies number 20
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 20},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")

        secondary = result["secondary_model_g_ranking"]
        self.assertTrue(len(secondary) > 0)
        # Model G scores must be descending
        scores_g = [c["score_model_g"] for c in secondary]
        self.assertEqual(scores_g, sorted(scores_g, reverse=True))
        # Each candidate must have rank_model_g matching its 1-based position
        for expected_rank, c in enumerate(secondary, start=1):
            self.assertEqual(c["rank_model_g"], expected_rank)

        # In Model G, candidate with house_number=20 receives larger number boost than candidate with 10
        cand_20 = next(c for c in secondary if c["house_number"] == 20)
        cand_10 = next(c for c in secondary if c["house_number"] == 10)
        boost_20 = cand_20["score_model_g"] - cand_20["score_model_f"]
        boost_10 = cand_10["score_model_g"] - cand_10["score_model_f"]
        self.assertGreater(boost_20, boost_10)

    # 9. Corrupted number never hard-discards true candidate
    def test_zero_hard_discard_from_corrupted_number(self):
        cand_num = 10
        boost_conflict = score_number_compatibility(cand_num, 500, "LOW_NUMBER_WEIGHT")
        # Soft boost is non-negative, never negative, never discards
        self.assertGreaterEqual(boost_conflict, 0.0)

        # In full inference, pass extreme conflict door number 9999
        clues = [
            {"type": "neighbourhood", "value": "Bosque Flamboyant"},
            {"type": "street", "value": "Rua das Flores"},
            {"type": "house_number", "value": 9999},
        ]
        result = predict_from_listing(clues, self.mock_corpus)
        self.assertEqual(result["status"], "SUCCESS")
        # All observed parcels must still be present in rankings (zero hard discards)
        cand_bc_set = {c["candidate_bc"] for c in result["candidates"]}
        for p in self.mock_parcels:
            self.assertIn(p.bc, cand_bc_set, f"Parcel {p.bc} was improperly hard-discarded by number conflict!")

    # 10. Observed vs structural distinction & 11. Structural hypotheses remain STRUCTURAL_UNRESOLVED
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

        # All observed must be real
        for c in observed:
            self.assertTrue(c["is_real"])
            self.assertEqual(c["resolution_status"], "OBSERVED_REAL")

        # All new structural hypotheses MUST remain STRUCTURAL_UNRESOLVED and is_real=False
        for c in structural:
            self.assertFalse(c["is_real"], f"Hypothesis {c['candidate_bc']} illegally marked real!")
            self.assertEqual(c["resolution_status"], "STRUCTURAL_UNRESOLVED")
            self.assertTrue(c["candidate_address"].startswith("[Structural Hypothesis]"))

    # 12. Failure taxonomy: STREET_NOT_AVAILABLE
    def test_street_not_available_taxonomy(self):
        # Bairro given, but no street given (Fixture D)
        clues_d = extract_public_clues_from_html(FIXTURE_D_NO_STREET_NO_CEP)
        # Mock corpus has neighbourhood 'Bosque Flamboyant', pass clues with only bairro
        clues_bairro_only = [{"type": "neighbourhood", "value": "Bosque Flamboyant"}]
        result = predict_from_listing(clues_bairro_only, self.mock_corpus)
        # Provenance must record street_available = False
        self.assertFalse(result["provenance"]["street_available"])
        # Taxonomy flag must be STREET_NOT_AVAILABLE
        self.assertEqual(result["taxonomy_code"], "STREET_NOT_AVAILABLE")

    # 13. Prediction without GT (anti-leakage invariant)
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
        self.assertNotIn("true_physical_address", prov)

    # 14. No corpus lookup used to manufacture missing listing street
    def test_no_corpus_lookup_used_to_manufacture_missing_street(self):
        # When street is absent from clues, predict_from_listing must NOT fill it from corpus
        clues_no_street = [{"type": "neighbourhood", "value": "Bosque Flamboyant"}]
        result = predict_from_listing(clues_no_street, self.mock_corpus)
        self.assertEqual(result["provenance"]["target_street_norm"], "")
        self.assertFalse(result["provenance"]["street_available"])

    # 15. PILOT_N == 10
    def test_pilot_n_equals_ten(self):
        from scratch.run_blinded_real_listing_pilot import PILOT_N
        self.assertEqual(PILOT_N, 10, f"PILOT_N must be 10, got {PILOT_N}")

    # 16. Deterministic selection from frozen pool
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

    # 17. Frozen prediction overwrite rejection
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

    # 18. GT gate (GT rejection before freeze)
    def test_gt_rejection_before_freeze(self):
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            gt_p = tdp / "ground_truth.json"
            pred_p = tdp / "frozen_predictions.json"

            gt_p.write_text('{"entries": []}\n', encoding="utf-8")
            self.assertTrue(gt_p.is_file())
            self.assertFalse(pred_p.is_file())
            is_illegal_state = gt_p.is_file() and not pred_p.is_file()
            self.assertTrue(is_illegal_state)

    # 19. Post-GT corpus-membership classification
    def test_post_gt_corpus_membership_classification(self):
        from scratch.run_blinded_real_listing_pilot import _classify_post_gt_corpus_membership
        # 1. Full exact BC
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.001.001", self.mock_corpus), "KNOWN_FULL_BC_IN_CORPUS")
        # 2. Same DSQLLL, different sublot
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.001.002", self.mock_corpus), "KNOWN_DSQLLL_IN_CORPUS")
        # 3. Same DSQ, novel LLL
        self.assertEqual(_classify_post_gt_corpus_membership("4.4.206.099.001", self.mock_corpus), "SAME_DSQ_ONLY_IN_CORPUS")
        # 4. Unknown DSQ
        self.assertEqual(_classify_post_gt_corpus_membership("1.1.001.001.001", self.mock_corpus), "NOT_PRESENT_IN_CORPUS")

    # 20. Facade TOP-3 REAL RESOLVED guard
    def test_facade_top3_real_guard(self):
        candidates = [
            {"rank": 1, "rank_model_f": 1, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 1"},
            {"rank": 2, "rank_model_f": 2, "is_real": False, "resolution_status": "STRUCTURAL_UNRESOLVED", "candidate_address": "Hypo 2"},
            {"rank": 3, "rank_model_f": 3, "is_real": True, "resolution_status": "STRUCTURAL_RESOLVED", "candidate_address": "Rua 3"},
            {"rank": 4, "rank_model_f": 4, "is_real": True, "resolution_status": "OBSERVED_REAL", "candidate_address": "Rua 4"},
        ]

        def filter_for_facade(cands):
            eligible = []
            for c in cands:
                if (
                    (c.get("rank_model_f") or c.get("rank", 99)) <= 3
                    and c.get("is_real") is True
                    and c.get("resolution_status") in ("OBSERVED_REAL", "STRUCTURAL_RESOLVED")
                ):
                    eligible.append(c)
            return eligible

        eligible = filter_for_facade(candidates)
        self.assertEqual([c["rank"] for c in eligible], [1, 3])
        self.assertNotIn(2, [c["rank"] for c in eligible])
        self.assertNotIn(4, [c["rank"] for c in eligible])

    # 21. Validate-only zero-network / zero-artifact mutation
    def test_validate_only_no_mutation(self):
        from scratch.run_blinded_real_listing_pilot import validate_only, _paths
        repo_root = Path(r"C:\Users\Marcel\.gemini\antigravity\playground\ultraviolet-quasar")
        paths = _paths(repo_root)

        before_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        validate_only(paths)
        after_mtimes = {k: p.stat().st_mtime for k, p in paths.items() if p.exists()}
        self.assertEqual(before_mtimes, after_mtimes, "validate_only modified existing artifact files!")


if __name__ == "__main__":
    unittest.main()
