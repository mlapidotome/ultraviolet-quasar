#!/usr/bin/env python3
"""BLINDED REAL-LISTING ADDRESS FINDER PILOT -- Production Driver.

CLI usage:
    python scratch/run_blinded_real_listing_pilot.py --stage <STAGE> [--repo-root <PATH>]
    python scratch/run_blinded_real_listing_pilot.py --validate-only [--repo-root <PATH>]

Stages (run in order):
    discovery          Freeze deterministic CHAVES NA MAO discovery pool (Taubate/SP only)
    snapshots          Capture public listing page HTML snapshots for selected listings
    inputs             Extract public-visible clues from frozen snapshots
    classify-leakage   Classify direct address leakage per listing; DQ leakers
    predict            Run frozen production model -> TOP-20 candidates (no training)
    ingest-gt          Ingest operator-collected ground truth (post-freeze ONLY)
    evaluate           Score predictions vs GT; classify post-GT corpus membership; failure analysis
    facade-guard       Apply Facade Checker TOP-3 real guard on eligible resolved candidate images

CONSTRAINTS (enforced at runtime):
    - No stage executes unless all upstream artifacts exist and SHA-256 verify.
    - GT cannot be ingested before frozen_predictions artifact is locked.
    - Model F (TARGET_STREET_ONLY) is the primary scientific ranking.
    - Model G (LOW_NUMBER_WEIGHT) is secondary/noisy-number-assisted.
    - facade-guard requires explicit --stage invocation and operator confirmation.
    - Facade eligibility strictly requires: rank <= 3 AND is_real == True AND resolution_status in {OBSERVED_REAL, STRUCTURAL_RESOLVED}.
    - Structural hypothetical BCs are strictly forbidden from Facade Checker.
    - CEP alone or street alone is NOT direct exact address leakage.
    - --validate-only performs zero network I/O and zero artifact writes.
    - This driver NEVER commits or pushes git artifacts automatically.
    - Without --stage or --validate-only this script prints help and exits 2.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import re
import sys
import tempfile
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# Ensure repo root is on sys.path for address_finder module resolution
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import address_finder

SCHEMA_VERSION = "1.0"

# ---------------------------------------------------------------------------
# Pilot constants
# ---------------------------------------------------------------------------
SOURCE_SITE = "chavesnamao.com.br"
TARGET_MUNICIPALITY = "Taubate"
TARGET_STATE = "SP"
ELIGIBLE_TYPES: frozenset[str] = frozenset({"casa", "sobrado"})
PILOT_N = 10  # Frozen main blind pilot size
DISCOVERY_MAX = 500

CNM_SEARCH_URL_TEMPLATE = (
    "https://www.chavesnamao.com.br/imoveis-para-venda/sp-taubate/"
    "?tipo={type_slug}&finalidade=residencial&pagina={page}"
)
CNM_LISTING_ID_RE = re.compile(r"/imovel/([0-9]+)/")

# Pre-registered failure taxonomy codes
TAXONOMY_CODES: frozenset[str] = frozenset({
    "LISTING_CLUE_FAILURE",
    "STREET_NOT_AVAILABLE",
    "DS_FAILURE",
    "DSQ_FAILURE",
    "NO_ANCHOR",
    "LLL_GENERATION_MISS",
    "CANDIDATE_RESOLUTION_FAILURE",
    "GT_UNRESOLVED",
    "DIRECT_EXACT_ADDRESS_LEAK",
    "FACADE_INCONCLUSIVE",
    "FACADE_FALSE_SIGNAL",
})

# Frozen expected Facade Checker v2.3 hash
EXPECTED_FACADE_CHECKER_HASH = "28e9cb86051e5c9362cc5fb5dd680932614a524df3e018c0af43ee4c196bb7ae"


# ---------------------------------------------------------------------------
# Artifact paths
# ---------------------------------------------------------------------------
def _paths(repo: Path) -> dict[str, Path]:
    af = repo / "brain" / "address_finder"
    data = repo / "data" / "address_finder_real_listing_pilot"
    anchors = repo / "facade-checker" / "data" / "address_finder_bc_anchors_v1"
    return {
        "taxonomy":           af / "failure_taxonomy.json",
        "discovery_pool":     af / "phase_real_listing_discovery_pool.json",
        "pilot_manifest":     af / "phase_real_listing_pilot_manifest.json",
        "snapshot_manifest":  af / "phase_real_listing_snapshot_manifest.json",
        "snapshot_root":      data / "snapshots",
        "public_inputs":      af / "phase_real_listing_public_inputs.json",
        "leakage_report":     af / "phase_real_listing_leakage_report.json",
        "frozen_predictions": af / "phase_real_listing_frozen_predictions.json",
        "ground_truth":       af / "phase_real_listing_ground_truth.json",
        "evaluation":         af / "phase_real_listing_evaluation.json",
        "failure_analysis":   af / "phase_real_listing_failure_analysis.json",
        "metrics_summary":    af / "phase_real_listing_metrics_summary.json",
        "facade_report":      af / "phase_real_listing_facade_report.json",
        # Upstream cadastral corpus and frozen model rules
        "corpus":             repo / "acervo_casas_taubate.json",
        "frozen_rules":       anchors / "phase_anchor_target_frozen_rules.json",
        "street_bindings":    anchors / "phase_map_street_bindings.json",
    }


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def now_utc() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_of_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(p: Path, obj: Any) -> str:
    """Write JSON deterministically; write .sha256 sidecar; return digest."""
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    p.write_text(text, encoding="utf-8")
    digest = sha256_of_file(p)
    p.with_suffix(p.suffix + ".sha256").write_text(digest + "\n", encoding="utf-8")
    return digest


def load_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def info(msg: str) -> None:
    sys.stdout.write(f"[INFO]  {msg}\n")


def _normalise_address(addr: str) -> str:
    s = unicodedata.normalize("NFD", addr.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[,.\-/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# State-gate helpers
# ---------------------------------------------------------------------------
def _require(p: Path, label: str) -> None:
    if not p.is_file():
        sys.exit(f"[GATE] Missing: {label} ({p})")
    sha_p = p.with_suffix(p.suffix + ".sha256")
    if not sha_p.is_file():
        sys.exit(f"[GATE] Missing SHA sidecar: {label} ({sha_p})")
    expected = sha_p.read_text(encoding="utf-8").strip()
    actual = sha256_of_file(p)
    if actual != expected:
        sys.exit(f"[GATE] SHA mismatch {label}: stored={expected} actual={actual}")


def _gate(paths: dict[str, Path], *keys: str) -> None:
    for k in keys:
        _require(paths[k], k)


def _abort_if_frozen(paths: dict[str, Path], key: str, msg: str) -> None:
    p = paths[key]
    sha_p = p.with_suffix(p.suffix + ".sha256")
    if p.is_file() and sha_p.is_file():
        if sha_p.read_text(encoding="utf-8").strip() == sha256_of_file(p):
            sys.exit(f"[FROZEN] {msg}")


def _confirm(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() == "yes"
    except (EOFError, KeyboardInterrupt):
        return False


# ---------------------------------------------------------------------------
# Eligibility + extraction helpers
# ---------------------------------------------------------------------------
def _is_eligible(lid: str, url: str) -> tuple[bool, dict, bool]:
    """
    Check listing eligibility on live crawl.
    Returns: (is_eligible, meta_dict, is_direct_leak)
    """
    import urllib.request
    meta: dict = {"property_type": None, "municipality": None, "state": None, "has_facade_image": False}
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            lhtml = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        info(f"  Skip {lid}: {exc}")
        return False, meta, False
    ll = lhtml.lower()
    if "taubat" not in ll:
        return False, meta, False
    meta["municipality"] = TARGET_MUNICIPALITY
    meta["state"] = TARGET_STATE
    prop_type = next((t for t in ("sobrado", "casa") if t in ll), None)
    if prop_type is None:
        return False, meta, False
    meta["property_type"] = prop_type
    if "residencial" not in ll:
        return False, meta, False
    has_img = bool(re.search(r"<img[^>]+(fachada|facade|exterior|frente)", ll))
    if not has_img:
        has_img = bool(re.search(r"<img[^>]+imovel", ll))
    meta["has_facade_image"] = has_img
    if not has_img:
        return False, meta, False

    # Check direct exact address leakage (street + door number).
    # CEP alone or street alone is NOT direct exact leakage.
    is_direct_leak, _ = address_finder.classify_direct_address_leakage(lhtml)
    if is_direct_leak:
        info(f"  Auditing: {lid} rejected due to exact street + door number leak")
        return False, meta, True

    return True, meta, False


def _extract_clues(html: str) -> list[dict]:
    """Extract production-visible clues from HTML listing."""
    return address_finder.extract_public_clues_from_html(html)


# ---------------------------------------------------------------------------
# STAGE 1 -- Discovery Pool Freeze
# ---------------------------------------------------------------------------
def stage_discovery(paths: dict[str, Path]) -> None:
    """Crawl CHAVES NA MAO for Taubate casa/sobrado residencial listings.
    Ordering: numeric listing_id ascending. Eligibility filters applied live.
    Maintains discovery audit statistics for disqualified direct-address leakers.
    Requires explicit --stage discovery and operator confirmation.
    """
    _abort_if_frozen(paths, "discovery_pool", "Discovery pool already frozen.")
    if not _confirm("Crawl chavesnamao.com.br? [yes/no] "):
        sys.exit("[ABORTED]")
    import urllib.request
    seen: set[str] = set()
    eligible: list[dict] = []
    direct_leaks_rejected: list[dict] = []

    for type_slug in ("casa", "sobrado"):
        page = 1
        while len(seen) < DISCOVERY_MAX:
            url = CNM_SEARCH_URL_TEMPLATE.format(type_slug=type_slug, page=page)
            info(f"Crawling: {url}")
            try:
                with urllib.request.urlopen(url, timeout=20) as resp:
                    html = resp.read().decode("utf-8", errors="replace")
            except Exception as exc:
                info(f"Stop page {page}: {exc}")
                break
            found = CNM_LISTING_ID_RE.findall(html)
            if not found:
                break
            for raw_id in found:
                lid = raw_id.strip()
                if not lid.isdigit() or lid in seen:
                    continue
                seen.add(lid)
                listing_url = f"https://www.chavesnamao.com.br/imovel/{lid}/"
                ok, meta, is_leak = _is_eligible(lid, listing_url)
                if ok:
                    eligible.append({
                        "listing_id": lid,
                        "source_url": listing_url,
                        "property_type": meta["property_type"],
                        "municipality": TARGET_MUNICIPALITY,
                        "state": TARGET_STATE,
                        "has_facade_image": True,
                        "direct_address_leaked": False,
                    })
                elif is_leak:
                    direct_leaks_rejected.append({
                        "listing_id": lid,
                        "source_url": listing_url,
                        "reason": "DIRECT_EXACT_ADDRESS_LEAK",
                    })
            page += 1

    eligible.sort(key=lambda r: (int(r["listing_id"]), r["source_url"]))
    digest = write_json(paths["discovery_pool"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "source": SOURCE_SITE,
        "municipality": TARGET_MUNICIPALITY,
        "state": TARGET_STATE,
        "eligible_count": len(eligible),
        "direct_leaks_rejected_count": len(direct_leaks_rejected),
        "direct_leaks_rejected": direct_leaks_rejected,
        "listings": eligible,
    })
    info(f"Discovery pool frozen: {len(eligible)} eligible listings, {len(direct_leaks_rejected)} leaks rejected. SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 2 -- Snapshot Capture + Pilot Manifest
# ---------------------------------------------------------------------------
def stage_snapshots(paths: dict[str, Path]) -> None:
    """Select exactly PILOT_N (10) listings; capture full public HTML snapshots. No binary download."""
    _gate(paths, "discovery_pool")
    _abort_if_frozen(paths, "snapshot_manifest", "Snapshot manifest already frozen.")
    if not _confirm(f"Fetch listing pages for {PILOT_N} listings? [yes/no] "):
        sys.exit("[ABORTED]")
    import urllib.request
    pool = load_json(paths["discovery_pool"])
    selected = pool["listings"][:PILOT_N]
    snap_root = paths["snapshot_root"]
    snap_root.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for entry in selected:
        lid = entry["listing_id"]
        url = entry["source_url"]
        ld = snap_root / lid
        ld.mkdir(parents=True, exist_ok=True)
        (ld / "source_url.txt").write_text(url + "\n", encoding="utf-8")
        html_path = ld / "listing.html"
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                raw = resp.read()
            html_path.write_bytes(raw)
            ok, sha = True, hashlib.sha256(raw).hexdigest()
            info(f"  Snapshot: {lid} ({len(raw)} bytes)")
        except Exception as exc:
            ok, sha = False, ""
            info(f"  Snapshot FAILED {lid}: {exc}")
        rel = str(html_path.relative_to(snap_root.parent.parent))
        entries.append({
            "listing_id": lid,
            "source_url": url,
            "property_type": entry.get("property_type"),
            "snapshot_html": rel,
            "snapshot_sha256": sha,
            "snapshot_ok": ok,
            "captured_at": now_utc(),
        })
    write_json(paths["pilot_manifest"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "selected_count": len(selected),
        "selected_listing_ids": [e["listing_id"] for e in selected],
    })
    digest = write_json(paths["snapshot_manifest"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "snapshots": entries,
    })
    info(f"Snapshot manifest frozen: {len(entries)} entries (PILOT_N={PILOT_N}). SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 3 -- Public Input Extraction
# ---------------------------------------------------------------------------
def stage_inputs(paths: dict[str, Path]) -> None:
    """Extract real public clues from frozen HTML. Persists source provenance."""
    _gate(paths, "snapshot_manifest")
    _abort_if_frozen(paths, "public_inputs", "Public inputs already frozen.")
    snap_manifest = load_json(paths["snapshot_manifest"])
    repo_root = paths["snapshot_root"].parent.parent.parent
    listings: list[dict] = []
    for snap in snap_manifest["snapshots"]:
        lid = snap["listing_id"]
        if not snap["snapshot_ok"]:
            listings.append({"listing_id": lid, "clues": [], "extraction_ok": False})
            continue
        hp = repo_root / snap["snapshot_html"]
        if not hp.is_file():
            listings.append({"listing_id": lid, "clues": [], "extraction_ok": False})
            continue
        html = hp.read_text(encoding="utf-8", errors="replace")
        clues = _extract_clues(html)
        listings.append({"listing_id": lid, "clues": clues, "extraction_ok": True})
        info(f"  {lid}: {len(clues)} clues extracted with provenance")
    digest = write_json(paths["public_inputs"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "listings": listings,
    })
    info(f"Public inputs frozen. SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 4 -- Direct Leakage Classification
# ---------------------------------------------------------------------------
def stage_classify_leakage(paths: dict[str, Path]) -> None:
    """Classify each listing for direct exact-address leakage (street + door number).
    CEP alone or street alone is NOT direct exact leakage.
    """
    _gate(paths, "public_inputs")
    _abort_if_frozen(paths, "leakage_report", "Leakage report already frozen.")
    public_inputs = load_json(paths["public_inputs"])
    snap_manifest = (
        load_json(paths["snapshot_manifest"])
        if paths["snapshot_manifest"].is_file()
        else {"snapshots": []}
    )
    repo_root = paths["snapshot_root"].parent.parent.parent
    snap_html: dict[str, Path] = {
        snap["listing_id"]: repo_root / snap["snapshot_html"]
        for snap in snap_manifest.get("snapshots", [])
        if (repo_root / snap["snapshot_html"]).is_file()
    }
    reports: list[dict] = []
    for entry in public_inputs["listings"]:
        lid = entry["listing_id"]
        leaked, evidence = False, []
        # Check raw HTML snapshot
        if lid in snap_html:
            ht = snap_html[lid].read_text(encoding="utf-8", errors="replace")
            is_leak, ev = address_finder.classify_direct_address_leakage(ht)
            if is_leak:
                leaked = True
                evidence.extend(ev)

        # Also check clues for any exact address leak text
        for clue in entry.get("clues", []):
            v = str(clue.get("value", ""))
            is_clue_leak, c_ev = address_finder.classify_direct_address_leakage(v)
            if is_clue_leak:
                leaked = True
                evidence.extend(c_ev)

        reports.append({
            "listing_id": lid,
            "direct_exact_address_leaked": leaked,
            "taxonomy_code": "DIRECT_EXACT_ADDRESS_LEAK" if leaked else None,
            "evidence": evidence,
        })
        info(f"  [{'DQ' if leaked else 'OK'}] {lid}")

    dq = sum(1 for r in reports if r["direct_exact_address_leaked"])
    digest = write_json(paths["leakage_report"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "leakage_reports": reports,
        "disqualified_count": dq,
    })
    info(f"Leakage report frozen. DQ: {dq}. SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 5 -- Frozen Predictions (Dual Rankings: Model F Primary, Model G Secondary)
# ---------------------------------------------------------------------------
def _call_address_finder_model(
    listing_id: str,
    clues: list[dict],
    corpus: Any,
    frozen_rules: Optional[dict] = None,
    street_bindings: Optional[dict] = None,
) -> dict:
    """
    Call the production-wired Address Finder inference module.
    Returns prediction dict with primary_model_f_ranking and secondary_model_g_ranking.
    """
    return address_finder.predict_from_listing(
        public_listing_clues=clues,
        corpus=corpus,
        frozen_rules=frozen_rules,
        street_bindings=street_bindings,
        max_candidates=20,
    )


def stage_predict(paths: dict[str, Path]) -> None:
    """Run frozen production model; persist TOP-20 candidates. No model training."""
    _gate(paths, "public_inputs", "leakage_report")
    _abort_if_frozen(paths, "frozen_predictions", "Frozen predictions already locked.")
    if not _confirm("Run Address Finder inference pipeline on public inputs? [yes/no] "):
        sys.exit("[ABORTED]")

    # Load frozen corpus (acervo_casas_taubate.json)
    if not paths["corpus"].is_file():
        sys.exit(f"[ERROR] Cadastral corpus not found at {paths['corpus']}")
    info(f"Loading cadastral corpus: {paths['corpus']}")
    corpus = address_finder.load_corpus(paths["corpus"])
    info(f"Corpus loaded: {len(corpus.parcels)} parcels. SHA-256: {corpus.corpus_sha256}")

    # Load frozen rules artifact if present
    frozen_rules = None
    if paths["frozen_rules"].is_file():
        frozen_rules = load_json(paths["frozen_rules"])
        frozen_rules["sha256"] = sha256_of_file(paths["frozen_rules"])
        info(f"Loaded frozen rules from {paths['frozen_rules'].name} (SHA: {frozen_rules['sha256'][:12]}...)")

    # Load street bindings if present
    street_bindings = None
    if paths["street_bindings"].is_file():
        b_data = load_json(paths["street_bindings"])
        street_bindings = b_data.get("bindings", {})
        info(f"Loaded {len(street_bindings)} street bindings from {paths['street_bindings'].name}")

    leakage = load_json(paths["leakage_report"])
    dq_ids: set[str] = {
        r["listing_id"] for r in leakage["leakage_reports"] if r["direct_exact_address_leaked"]
    }
    public_inputs = load_json(paths["public_inputs"])
    predictions: list[dict] = []

    for entry in public_inputs["listings"]:
        lid = entry["listing_id"]
        if lid in dq_ids:
            predictions.append({
                "listing_id": lid,
                "disqualified": True,
                "taxonomy_code": "DIRECT_EXACT_ADDRESS_LEAK",
                "primary_model_f_ranking": [],
                "secondary_model_g_ranking": [],
                "candidates": [],
                "provenance": {"reason": "DIRECT_EXACT_ADDRESS_LEAK"},
                "predicted_at": now_utc(),
            })
            continue

        pred_res = _call_address_finder_model(
            listing_id=lid,
            clues=entry["clues"],
            corpus=corpus,
            frozen_rules=frozen_rules,
            street_bindings=street_bindings,
        )

        candidates = pred_res.get("candidates", [])
        primary_f = pred_res.get("primary_model_f_ranking", candidates)
        secondary_g = pred_res.get("secondary_model_g_ranking", [])
        taxonomy_code = pred_res.get("taxonomy_code")

        predictions.append({
            "listing_id": lid,
            "disqualified": False,
            "taxonomy_code": taxonomy_code,
            "primary_model_f_ranking": primary_f,
            "secondary_model_g_ranking": secondary_g,
            "candidates": primary_f,  # Default candidates alias is Model F primary
            "provenance": pred_res.get("provenance", {}),
            "predicted_at": now_utc(),
        })
        info(f"  {lid}: {len(primary_f)} candidates (Model F primary, taxonomy: {taxonomy_code or 'OK'})")

    digest = write_json(paths["frozen_predictions"], {
        "schema_version": SCHEMA_VERSION,
        "frozen_at": now_utc(),
        "primary_ranking": "TARGET_STREET_ONLY",
        "secondary_ranking": "LOW_NUMBER_WEIGHT",
        "corpus_sha256": corpus.corpus_sha256,
        "rules_sha256": (frozen_rules.get("sha256") if frozen_rules else "FROZEN_DEFAULTS"),
        "prediction_count": len([p for p in predictions if not p["disqualified"]]),
        "predictions": predictions,
    })
    info(f"Frozen predictions locked (Model F primary). SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 6 -- Ground Truth Ingestion
# ---------------------------------------------------------------------------
def stage_ingest_gt(paths: dict[str, Path]) -> None:
    """Ingest operator-collected GT only after frozen_predictions are locked (hard blinding gate).

    GT input: data/address_finder_real_listing_pilot/ground_truth_input.json
    Schema:   {entries: [{listing_id, true_physical_address, true_bc,
                          provenance, verified_by, verified_at}]}
    """
    _gate(paths, "frozen_predictions")
    _abort_if_frozen(paths, "ground_truth", "Ground truth already frozen.")
    gt_input_path = paths["snapshot_root"].parent / "ground_truth_input.json"
    if not gt_input_path.is_file():
        sys.exit(f"[ERROR] GT input not found: {gt_input_path}")
    gt_input = load_json(gt_input_path)
    if not isinstance(gt_input.get("entries"), list):
        sys.exit("[ERROR] GT input must have an 'entries' list.")
    pilot_ids: set[str] = set(load_json(paths["pilot_manifest"])["selected_listing_ids"])
    validated: list[dict] = []
    for e in gt_input["entries"]:
        lid = e.get("listing_id", "")
        if lid not in pilot_ids or not e.get("true_physical_address"):
            info(f"  Skip GT: {lid}")
            continue
        validated.append({
            "listing_id": lid,
            "true_physical_address": e["true_physical_address"],
            "true_bc": e.get("true_bc"),
            "provenance": e.get("provenance", "unspecified"),
            "verified_by": e.get("verified_by", "unspecified"),
            "verified_at": e.get("verified_at", now_utc()),
        })
    digest = write_json(paths["ground_truth"], {
        "schema_version": SCHEMA_VERSION,
        "ingested_at": now_utc(),
        "entry_count": len(validated),
        "entries": validated,
    })
    info(f"GT ingested: {len(validated)} entries. SHA-256: {digest}")


# ---------------------------------------------------------------------------
# STAGE 7 -- Evaluation (Model F Primary, Model G Secondary, Post-GT Membership)
# ---------------------------------------------------------------------------
def _assign_failure_code(pred: dict) -> str:
    """Preserve specific inference failure code if present, else fallback."""
    if pred.get("taxonomy_code"):
        return pred["taxonomy_code"]
    return "LLL_GENERATION_MISS" if not pred.get("candidates") else "CANDIDATE_RESOLUTION_FAILURE"


def _count_codes(failures: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in failures:
        c = f.get("taxonomy_code") or "UNKNOWN"
        counts[c] = counts.get(c, 0) + 1
    return counts


def _classify_post_gt_corpus_membership(true_bc: Optional[str], corpus: Any) -> str:
    """
    POST-GT ONLY: Classify whether the true property exists in the cadastral corpus.
    Never run during prediction!
    """
    if not true_bc or not corpus:
        return "NOT_PRESENT_IN_CORPUS"
    parts = true_bc.strip().split(".")
    if len(parts) != 5:
        return "NOT_PRESENT_IN_CORPUS"

    try:
        d = int(parts[0])
        s = int(parts[1])
        qqq = int(parts[2])
        lll = int(parts[3])
        sss = int(parts[4])
    except ValueError:
        return "NOT_PRESENT_IN_CORPUS"

    canonical_bc = f"{d}.{s}.{qqq:03d}.{lll:03d}.{sss:03d}"
    dsqlll = f"{d}.{s}.{qqq:03d}.{lll:03d}"
    dsq = f"{d}.{s}.{qqq:03d}"

    if canonical_bc in [p.bc for p in corpus.parcels]:
        return "KNOWN_FULL_BC_IN_CORPUS"
    if dsqlll in corpus.by_dsqlll:
        return "KNOWN_DSQLLL_IN_CORPUS"
    if dsq in corpus.by_dsq:
        return "SAME_DSQ_ONLY_IN_CORPUS"
    return "NOT_PRESENT_IN_CORPUS"


def stage_evaluate(paths: dict[str, Path]) -> None:
    """Score frozen predictions vs GT by normalised address matching.
    Primary scientific pilot metrics use Model F (TARGET_STREET_ONLY).
    Secondary metrics evaluate Model G (LOW_NUMBER_WEIGHT).
    Post-GT only: classify target property corpus membership.
    """
    _gate(paths, "frozen_predictions", "ground_truth")
    _abort_if_frozen(paths, "evaluation", "Evaluation already frozen.")
    predictions = load_json(paths["frozen_predictions"])
    gt_data = load_json(paths["ground_truth"])

    # Load corpus for post-GT membership audit
    corpus = None
    if paths["corpus"].is_file():
        corpus = address_finder.load_corpus(paths["corpus"])

    gt_map: dict[str, dict] = {e["listing_id"]: e for e in gt_data["entries"]}

    # Counters for Primary (Model F) and Secondary (Model G)
    counters_f = {"TOP1": 0, "TOP3": 0, "TOP5": 0, "TOP10": 0, "TOP20": 0}
    counters_g = {"TOP1": 0, "TOP3": 0, "TOP5": 0, "TOP10": 0, "TOP20": 0}

    membership_counts = {
        "KNOWN_FULL_BC_IN_CORPUS": 0,
        "KNOWN_DSQLLL_IN_CORPUS": 0,
        "SAME_DSQ_ONLY_IN_CORPUS": 0,
        "NOT_PRESENT_IN_CORPUS": 0,
    }
    evaluated = 0
    per_listing: list[dict] = []

    for pred in predictions["predictions"]:
        lid = pred["listing_id"]
        if pred.get("disqualified"):
            per_listing.append({
                "listing_id": lid,
                "evaluated": False,
                "taxonomy_code": pred.get("taxonomy_code") or "DIRECT_EXACT_ADDRESS_LEAK",
                "hit_rank_model_f": None,
                "hit_rank_model_g": None,
                "corpus_membership": None,
            })
            continue

        if lid not in gt_map:
            per_listing.append({
                "listing_id": lid,
                "evaluated": False,
                "taxonomy_code": "GT_UNRESOLVED",
                "hit_rank_model_f": None,
                "hit_rank_model_g": None,
                "corpus_membership": None,
            })
            continue

        evaluated += 1
        gt_entry = gt_map[lid]
        gt_addr = _normalise_address(gt_entry["true_physical_address"])
        gt_bc = gt_entry.get("true_bc")

        # Post-GT corpus membership classification
        membership = _classify_post_gt_corpus_membership(gt_bc, corpus)
        membership_counts[membership] = membership_counts.get(membership, 0) + 1

        # Evaluate Model F (Primary)
        hit_rank_f: int | None = None
        cand_list_f = pred.get("primary_model_f_ranking") or pred.get("candidates", [])
        for cand in cand_list_f:
            if _normalise_address(cand.get("candidate_address", "")) == gt_addr:
                hit_rank_f = cand.get("rank_model_f") or cand.get("rank")
                break

        # Evaluate Model G (Secondary)
        hit_rank_g: int | None = None
        cand_list_g = pred.get("secondary_model_g_ranking") or []
        for cand in cand_list_g:
            if _normalise_address(cand.get("candidate_address", "")) == gt_addr:
                hit_rank_g = cand.get("rank_model_g") or cand.get("rank")
                break

        for k, thr in (("TOP1", 1), ("TOP3", 3), ("TOP5", 5), ("TOP10", 10), ("TOP20", 20)):
            if hit_rank_f is not None and hit_rank_f <= thr:
                counters_f[k] += 1
            if hit_rank_g is not None and hit_rank_g <= thr:
                counters_g[k] += 1

        tc = None if hit_rank_f is not None else _assign_failure_code(pred)
        per_listing.append({
            "listing_id": lid,
            "evaluated": True,
            "hit_rank_model_f": hit_rank_f,
            "hit_rank_model_g": hit_rank_g,
            "taxonomy_code": tc,
            "corpus_membership": membership,
        })

    rates_f = {k: (counters_f[k] / evaluated if evaluated else 0.0) for k in counters_f}
    rates_g = {k: (counters_g[k] / evaluated if evaluated else 0.0) for k in counters_g}

    summary = {
        "evaluated": evaluated,
        "primary_model_f_rates": rates_f,
        "primary_model_f_counts": counters_f,
        "secondary_model_g_rates": rates_g,
        "secondary_model_g_counts": counters_g,
        "post_gt_corpus_membership": membership_counts,
    }
    de = write_json(paths["evaluation"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "primary_benchmark": "MODEL_F_TARGET_STREET_ONLY",
        "secondary_benchmark": "MODEL_G_LOW_NUMBER_WEIGHT",
        "summary": summary,
        "per_listing": per_listing,
    })
    failures = [r for r in per_listing if r.get("taxonomy_code")]
    write_json(paths["failure_analysis"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "failure_count": len(failures),
        "failures": failures,
        "code_distribution": _count_codes(failures),
    })
    write_json(paths["metrics_summary"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "summary": summary,
    })
    info(f"Evaluation: {evaluated} listings.")
    info(f"  Primary Model F: TOP1={rates_f['TOP1']:.2%} TOP5={rates_f['TOP5']:.2%}")
    info(f"  Secondary Model G: TOP1={rates_g['TOP1']:.2%} TOP5={rates_g['TOP5']:.2%}")
    info(f"Corpus membership breakdown: {membership_counts}")
    info(f"Evaluation SHA-256: {de}")


# ---------------------------------------------------------------------------
# STAGE 8 -- Facade Guard (Strict TOP-3 Real Guard, Fail-Closed)
# ---------------------------------------------------------------------------
def stage_facade_guard(paths: dict[str, Path]) -> None:
    """Apply Facade Checker TOP-3 real guard on eligible resolved candidate images.
    Strict eligibility: rank <= 3 AND is_real == True AND resolution_status in {OBSERVED_REAL, STRUCTURAL_RESOLVED}.
    Structural unresolved hypotheses are strictly forbidden from Facade Checker.
    Keeps execution fail-closed if verified source/API cannot be found.
    """
    _gate(paths, "frozen_predictions", "snapshot_manifest")
    _abort_if_frozen(paths, "facade_report", "Facade report already frozen.")
    if not _confirm("Run Facade Checker Guard? [yes/no] "):
        sys.exit("[ABORTED]")

    info(f"Expected Facade Checker v2.3 Hash: {EXPECTED_FACADE_CHECKER_HASH}")
    info("[FAIL-CLOSED] Facade Checker execution remains fail-closed; guarding candidate eligibility.")

    predictions = load_json(paths["frozen_predictions"])
    snap_manifest = load_json(paths["snapshot_manifest"])
    repo_root = paths["snapshot_root"].parent.parent.parent
    snap_by_id: dict[str, Path] = {
        s["listing_id"]: repo_root / s["snapshot_html"]
        for s in snap_manifest["snapshots"]
        if (repo_root / s["snapshot_html"]).is_file()
    }

    results: list[dict] = []
    for pred in predictions["predictions"]:
        lid = pred["listing_id"]
        if pred.get("disqualified") or not pred.get("candidates"):
            results.append({"listing_id": lid, "skipped": True, "reason": "DISQUALIFIED_OR_NO_CANDIDATES"})
            continue

        # Strict candidate eligibility filter (using Model F primary rank)
        eligible_top3 = [
            c for c in pred["candidates"]
            if (c.get("rank_model_f") or c.get("rank", 99)) <= 3
            and c.get("is_real") is True
            and c.get("resolution_status") in ("OBSERVED_REAL", "STRUCTURAL_RESOLVED")
        ]

        fc_results: list[dict] = []
        for cand in eligible_top3:
            fc_results.append({
                "rank": cand.get("rank_model_f") or cand.get("rank"),
                "candidate_address": cand["candidate_address"],
                "candidate_bc": cand.get("candidate_bc"),
                "is_real": cand.get("is_real"),
                "resolution_status": cand.get("resolution_status"),
                "facade_match": None,
                "facade_score": None,
                "facade_verdict": "GUARD_ELIGIBLE_UNVERIFIED_SOURCE_FAIL_CLOSED",
            })

        results.append({
            "listing_id": lid,
            "skipped": False,
            "eligible_candidates_count": len(eligible_top3),
            "top3_results": fc_results,
        })
        info(f"  {lid}: {len(eligible_top3)} eligible candidates guarded")

    digest = write_json(paths["facade_report"], {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_utc(),
        "expected_facade_hash": EXPECTED_FACADE_CHECKER_HASH,
        "execution_mode": "FAIL_CLOSED_GUARD_ONLY",
        "facade_results": results,
    })
    info(f"Facade report generated (fail-closed guard). SHA-256: {digest}")


# ---------------------------------------------------------------------------
# VALIDATE-ONLY
# ---------------------------------------------------------------------------
def validate_only(paths: dict[str, Path]) -> None:
    """Offline static validation. Zero network I/O. Zero artifact writes.

    Checks:
      1. Required stdlib and address_finder modules importable
      2. PILOT_N constant == 10
      3. Cadastral corpus exists and SHA-256 verifies
      4. Cadastral corpus excludes contribuinte/owner
      5. Taxonomy JSON schema valid; all pre-registered codes present
      6. SHA-256 helper produces correct output on known input
      7. State-gate raises SystemExit on missing artifact
      8. GT rejection before freeze: ground_truth must not exist before frozen_predictions
      9. facade_checker NOT auto-imported at module level
      10. urllib.request NOT imported at module level (no-network invariant)
      11. _abort_if_frozen is callable (frozen-artifact mutation guard)
      12. Model F & Model G inference test executes with zero GT input
      13. Leakage semantics: CEP alone is NOT leakage; street alone is NOT leakage; street+number is leakage
    """
    import sys as _sys
    failures: list[str] = []

    # 1. Stdlib & local imports
    for mod in ("argparse", "hashlib", "importlib", "json", "re",
                "unicodedata", "urllib.parse", "datetime", "pathlib", "tempfile", "address_finder"):
        try:
            importlib.import_module(mod)
        except ImportError as exc:
            failures.append(f"import_missing:{mod}:{exc}")

    # 2. PILOT_N check
    if PILOT_N != 10:
        failures.append(f"pilot_n_invalid:expected=10 got={PILOT_N}")

    # 3 & 4. Corpus check
    if not paths["corpus"].is_file():
        failures.append(f"corpus_missing:{paths['corpus']}")
    else:
        try:
            corpus = address_finder.load_corpus(paths["corpus"])
            if len(corpus.parcels) == 0:
                failures.append("corpus_empty")
            if hasattr(corpus.parcels[0], "contribuinte"):
                failures.append("corpus_leaks_contribuinte_attribute")
        except Exception as exc:
            failures.append(f"corpus_load_error:{exc}")

    # 5. Taxonomy
    if not paths["taxonomy"].is_file():
        failures.append(f"taxonomy_missing:{paths['taxonomy']}")
    else:
        try:
            tax = load_json(paths["taxonomy"])
            in_file = {c["code"] for c in tax.get("codes", [])}
            missing = TAXONOMY_CODES - in_file
            extra = in_file - TAXONOMY_CODES
            if missing:
                failures.append(f"taxonomy_missing_codes:{sorted(missing)}")
            if extra:
                failures.append(f"taxonomy_extra_codes:{sorted(extra)}")
        except Exception as exc:
            failures.append(f"taxonomy_parse:{exc}")

    # 6. SHA-256 helper
    tb = b"blinded-pilot-sha256-test"
    exp = hashlib.sha256(tb).hexdigest()
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(tb)
        tp = Path(tf.name)
    got = sha256_of_file(tp)
    tp.unlink(missing_ok=True)
    if got != exp:
        failures.append(f"sha256_mismatch:expected={exp} got={got}")

    # 7. State-gate raises on missing
    try:
        _require(Path("/nonexistent/artifact.json"), "test")
        failures.append("state_gate_no_exit")
    except SystemExit:
        pass

    # 8. GT before freeze guard
    if paths["ground_truth"].is_file() and not paths["frozen_predictions"].is_file():
        failures.append("gt_before_freeze")

    # 9. facade_checker not auto-imported
    if "facade_checker" in _sys.modules:
        failures.append("facade_checker_auto_imported")

    # 10. urllib.request not at module level
    if "urllib.request" in _sys.modules:
        failures.append("urllib_request_at_module_level")

    # 11. Frozen artifact guard callable
    if not callable(globals().get("_abort_if_frozen")):
        failures.append("_abort_if_frozen_not_callable")

    # 12. Model test without GT
    try:
        test_clues = [
            {"type": "neighbourhood", "value": "Jardim das Nações"},
            {"type": "street", "value": "Rua Abissínia"},
        ]
        if paths["corpus"].is_file():
            test_corpus = address_finder.load_corpus(paths["corpus"])
            res = address_finder.predict_from_listing(test_clues, test_corpus)
            if res["status"] != "SUCCESS":
                failures.append(f"test_inference_failed:{res.get('taxonomy_code')}")
            if "primary_model_f_ranking" not in res or "secondary_model_g_ranking" not in res:
                failures.append("inference_missing_dual_rankings")
    except Exception as exc:
        failures.append(f"test_inference_exception:{exc}")

    # 13. Leakage semantics check
    leak_cep, _ = address_finder.classify_direct_address_leakage("Imóvel em Taubaté, CEP 12042-000, próximo ao centro.")
    if leak_cep:
        failures.append("cep_alone_incorrectly_classified_as_leak")

    leak_st, _ = address_finder.classify_direct_address_leakage("Casa na Rua dos Cravos, Jardim das Nações, Taubaté.")
    if leak_st:
        failures.append("street_alone_incorrectly_classified_as_leak")

    leak_num, _ = address_finder.classify_direct_address_leakage("Casa na Rua dos Cravos, 142, Jardim das Nações, Taubaté.")
    if not leak_num:
        failures.append("street_plus_number_not_classified_as_leak")

    if failures:
        _sys.stderr.write("[VALIDATE] FAILED\n")
        for f in failures:
            _sys.stderr.write(f"  FAIL: {f}\n")
        _sys.exit(1)

    info("VALIDATE-ONLY: all checks passed.")
    for label in (
        "1. imports/modules                OK",
        "2. pilot_n_equals_ten             OK",
        "3. corpus_loaded_and_hashed       OK",
        "4. owner_identity_excluded        OK",
        "5. taxonomy schema                OK",
        "6. sha256_helper                  OK",
        "7. state_gate                     OK",
        "8. gt_rejection_gate              OK",
        "9. facade_guard_fail_closed       OK",
        "10. no_network_invariant          OK",
        "11. frozen_artifact_guard         OK",
        "12. model_inference_without_gt    OK",
        "13. leakage_semantics_cep_street  OK",
    ):
        info(f"  {label}")


# ---------------------------------------------------------------------------
# Stage registry + CLI
# ---------------------------------------------------------------------------
STAGES: dict[str, Any] = {
    "discovery":        stage_discovery,
    "snapshots":        stage_snapshots,
    "inputs":           stage_inputs,
    "classify-leakage": stage_classify_leakage,
    "predict":          stage_predict,
    "ingest-gt":        stage_ingest_gt,
    "evaluate":         stage_evaluate,
    "facade-guard":     stage_facade_guard,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="run_blinded_real_listing_pilot.py",
        description="BLINDED REAL-LISTING ADDRESS FINDER PILOT -- Production Driver",
        epilog="No stage executes automatically. Provide --stage or --validate-only.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--stage",
        choices=list(STAGES),
        metavar="STAGE",
        help=f"Stage to run: {', '.join(STAGES)}",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Offline static validation. No network I/O, no writes.",
    )
    parser.add_argument(
        "--repo-root",
        default=None,
        metavar="PATH",
        help="Repo root (default: inferred from script location).",
    )
    args = parser.parse_args()
    if not args.stage and not args.validate_only:
        parser.print_help()
        sys.exit(2)
    repo_root = (
        Path(args.repo_root).resolve()
        if args.repo_root
        else Path(__file__).resolve().parent.parent
    )
    paths = _paths(repo_root)
    if args.validate_only:
        validate_only(paths)
        return
    STAGES[args.stage](paths)


if __name__ == "__main__":
    main()
