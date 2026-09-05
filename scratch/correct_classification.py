import json, os, hashlib

def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

sum_path = 'facade-checker/data/address_finder_bc_anchors_v1/phase_map_metrics_summary.json'
with open(sum_path, 'r', encoding='utf-8') as f:
    summary = json.load(f)

# Update classification
summary['classification'] = 'MAP_AWARE_LLL_TOPOLOGY_PARTIAL_VALUE'
summary['classification_rationale'] = 'The observed map-aware LLL topology signal is strong in the currently resolved subset and replicates on holdout, but local-block coverage remains too limited to establish a broad cadastral rule.'

# Re-save metrics summary and re-hash
with open(sum_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)
summary_hash = compute_sha256(sum_path)
with open(sum_path + '.sha256', 'w', encoding='utf-8') as f:
    f.write(f"{summary_hash}  phase_map_metrics_summary.json\n")
summary['deliverable_hashes']['phase_map_metrics_summary.json'] = summary_hash

with open('facade-checker/data/address_finder_bc_anchors_v1/phase_map_holdout_results.json', 'r', encoding='utf-8') as f:
    holdout = json.load(f)

report_md = f"""# Phase Report — Map-Aware LLL Block-Perimeter Validation
## Physical Road-Block Topology, Corner Transitions & Multi-Signal Candidate Ranking

**Phase Status**: `COMPLETED`
**Global Classification**: `MAP_AWARE_LLL_TOPOLOGY_PARTIAL_VALUE`
**Evaluation Protocol**: `PRE_REGISTERED_STRATIFIED_COMPLETE_DSQ_ISOLATION` (Seed 42)

---

## 1. Executive Summary & Scientific Interpretation

This scientific validation phase evaluated whether cadastral lot numbering (`LLL`) within Taubaté cadastral blocks (`D.S.QQQ`) carries physical perimeter and corner transition information when bound to an independent OpenStreetMap road graph and physical block polygon model.

> [!NOTE]
> **Interpretation & Generalization Bound**:
> The observed map-aware LLL topology signal is strong in the currently resolved subset and replicates on holdout, but local-block coverage remains too limited to establish a broad cadastral rule.
> Level 2 local physical geometry evaluations were based on 26 resolved block transitions in Development (21 confirmed corners, 5 not confirmed) and 10 in Holdout (8 confirmed corners, 2 not confirmed).

### Key Experimental Findings:

1. **Consecutive Street Changes Follow Physical Corners**:
   - In Development blocks, **71.7%** of resolved consecutive LLL street changes physically intersect in the road graph, and **80.8%** of resolved block transitions match a physical corner bounding the road block polygon.
   - In Blind Holdout blocks, this result replicated with **71.4%** graph intersection and **80.0%** physical corner confirmation.
2. **Perimeter Progression Consistency**:
   - Across all 10 qualifying blocks with mapped physical perimeter boundaries (6 Dev, 4 Holdout), observed LLL sequences exhibited **100% cyclic perimeter consistency** (`PERIMETER_CONSISTENT`).
3. **Multi-Signal Candidate Ranking Lift**:
   - Under the realistic `LISTING_STREET_AVAILABLE` regime (where listing reveals target street name), the multi-signal ranker achieved **43.5% Top 5 recall** and **69.2% Top 10 recall** in Dev (vs **18.4%** and **36.2%** for pure $\\Delta\\text{{LLL}}$ baseline, a **2.36x lift** at Top 5).
   - In Blind Holdout, Top 5 recall reached **41.0%** (vs **18.7%** baseline, a **2.19x lift**), demonstrating strong out-of-sample stability.

---

## 2. Audited Cohort Denominators

| Category | Unique Spatial Parcels (DSQLLL) | Raw Records (BC) | Definition / Scope |
| :--- | :---: | :---: | :--- |
| **Street with House Number** | 856 | 868 | Valid parsed street name and valid positive integer door number |
| **Street without House Number** | 93 | 94 | Valid parsed street name, but no house number (S/N, 0, or unnumbered) |
| **Documentary-Text Vacant Lots** | 346 | 352 | Certidão venal description (e.g. 'LOTE X QD Y', 'REQUERENTE...') |
| **Empty Address** | 11 | 11 | Missing or blank address fields |
| **Total Cohort** | **1,306** | **1,325** | **63 Unique Cadastral Blocks (DSQ)** |

*Note: Multi-unit condominium desdobros (SSS) collapsed under the Anti-Condo Inflation Rule.*

---

## 3. Two-Level Consecutive Transition Results ($\\Delta\\text{{LLL}} = 1$)

### Level 1: Street-Graph Topology (Global Connectivity)

| Metric | Development Cohort (48 DSQs) | Blind Holdout Cohort (15 DSQs) |
| :--- | :---: | :---: |
| **Total Consecutive Pairs** | 867 | 284 |
| **Same Street Count (Rate)** | 563 (64.9%) | 162 (57.0%) |
| **Graph Intersecting Count** | 43 | 15 |
| **Graph Non-Intersecting Count** | 17 | 6 |
| **Map Unresolved / Ambiguous** | 244 | 101 |
| **Graph Intersect Rate on Resolved Changes** | **71.7%** | **71.4%** |

### Level 2: Local Physical Block Corner Confirmation

| Metric | Development Cohort | Blind Holdout Cohort |
| :--- | :---: | :---: |
| **Local Corner Confirmed** | 21 | 8 |
| **Local Corner Not Confirmed** | 5 | 2 |
| **Local Block Unresolved** | 278 | 112 |
| **Physical Corner Rate on Resolved Blocks** | **80.8%** | **80.0%** |

---

## 4. Multi-Signal Candidate Ranking Performance

Simulated across 34,900 anchor-target queries (26,362 Dev, 8,538 Holdout):

| Ranking Regime / Baseline | Dev Top 1 | Dev Top 3 | Dev Top 5 | Dev Top 10 | Holdout Top 5 | Holdout Top 10 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline A (Pure $\\Delta\\text{{LLL}}$)** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **Baseline B (Same-Street Filter)** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **Baseline C (Random Same-DSQ Window)** | 3.8% | 11.1% | 18.2% | 36.1% | 19.1% | 37.1% |
| **NO_TARGET_STREET** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **LISTING_STREET_AVAILABLE** | **9.8%** | **27.9%** | **43.5%** | **69.2%** | **41.0%** | **66.0%** |
| **ORACLE_TARGET_STREET** | **9.9%** | **28.2%** | **43.9%** | **70.2%** | **41.2%** | **66.6%** |

---

## 5. Deliverables & Cryptographic Hashes

| Deliverable File | SHA-256 Hash |
| :--- | :--- |
| `phase_map_normalized_cohort.json` | `{summary['deliverable_hashes']['phase_map_normalized_cohort.json']}` |
| `phase_map_source_manifest.json` | `{summary['deliverable_hashes']['phase_map_source_manifest.json']}` |
| `phase_map_street_bindings.json` | `{summary['deliverable_hashes']['phase_map_street_bindings.json']}` |
| `phase_map_dsq_block_associations.json` | `{summary['deliverable_hashes']['phase_map_dsq_block_associations.json']}` |
| `phase_map_holdout_manifest.json` | `{summary['deliverable_hashes']['phase_map_holdout_manifest.json']}` |
| `phase_map_consecutive_transitions.json` | `{summary['deliverable_hashes']['phase_map_consecutive_transitions.json']}` |
| `phase_map_perimeter_sequences.json` | `{summary['deliverable_hashes']['phase_map_perimeter_sequences.json']}` |
| `phase_map_ordinal_correlations.json` | `{summary['deliverable_hashes']['phase_map_ordinal_correlations.json']}` |
| `phase_map_candidate_rankings.json` | `{summary['deliverable_hashes']['phase_map_candidate_rankings.json']}` |
| `phase_map_frozen_rules.json` | `{summary['deliverable_hashes']['phase_map_frozen_rules.json']}` |
| `phase_map_holdout_results.json` | `{summary['deliverable_hashes']['phase_map_holdout_results.json']}` |
| `phase_map_metrics_summary.json` | `{summary['deliverable_hashes']['phase_map_metrics_summary.json']}` |

---

## 6. Product Recommendations for Address Finder

1. **Adopt Multi-Signal Scoring when Listing Exposes Street**:
   When an ad or listing provides a target street name, weighting candidate lot selection by:
   $$\\text{{Score}}(c) = \\frac{{1}}{{1 + \\Delta\\text{{LLL}}}} + 2.5 \\cdot \\mathbb{{I}}(\\text{{MatchTargetStreet}}) + 0.5 \\cdot \\mathbb{{I}}(\\text{{MatchAnchorStreet}}) + 0.8 \\cdot \\mathbb{{I}}(\\text{{GraphIntersect}})$$
   delivers a **2.2x–2.4x compression gain** in Top 5 recall over pure $\\Delta\\text{{LLL}}$ candidate generation.
2. **Preserve Fallback for Blind/Unaddressed Searches**:
   When target street is unknown (`NO_TARGET_STREET`), pure $\\Delta\\text{{LLL}}$ remains the standard baseline.
"""

# Write historical report
hist_path = 'brain/address_finder/reports/PHASE_MAP_AWARE_LLL_BLOCK_PERIMETER_VALIDATION.md'
with open(hist_path, 'w', encoding='utf-8') as f:
    f.write(report_md.strip() + '\n')

# Write active report
latest_report_path = 'brain/address_finder/LATEST_PHASE_REPORT.md'
with open(latest_report_path, 'w', encoding='utf-8') as f:
    f.write(report_md.strip() + '\n')

# Write latest results json
latest_results_path = 'brain/address_finder/LATEST_PHASE_RESULTS.json'
with open(latest_results_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)

print("Report classification corrected to MAP_AWARE_LLL_TOPOLOGY_PARTIAL_VALUE!")
