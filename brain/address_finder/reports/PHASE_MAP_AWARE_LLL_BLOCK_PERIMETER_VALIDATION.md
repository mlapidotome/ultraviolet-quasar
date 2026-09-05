# Phase Report — Map-Aware LLL Block-Perimeter Validation
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
   - Under the realistic `LISTING_STREET_AVAILABLE` regime (where listing reveals target street name), the multi-signal ranker achieved **43.5% Top 5 recall** and **69.2% Top 10 recall** in Dev (vs **18.4%** and **36.2%** for pure $\Delta\text{LLL}$ baseline, a **2.36x lift** at Top 5).
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

## 3. Two-Level Consecutive Transition Results ($\Delta\text{LLL} = 1$)

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
| **Baseline A (Pure $\Delta\text{LLL}$)** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **Baseline B (Same-Street Filter)** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **Baseline C (Random Same-DSQ Window)** | 3.8% | 11.1% | 18.2% | 36.1% | 19.1% | 37.1% |
| **NO_TARGET_STREET** | 3.7% | 11.1% | 18.4% | 36.2% | 18.7% | 36.4% |
| **LISTING_STREET_AVAILABLE** | **9.8%** | **27.9%** | **43.5%** | **69.2%** | **41.0%** | **66.0%** |
| **ORACLE_TARGET_STREET** | **9.9%** | **28.2%** | **43.9%** | **70.2%** | **41.2%** | **66.6%** |

---

## 5. Deliverables & Cryptographic Hashes

| Deliverable File | SHA-256 Hash |
| :--- | :--- |
| `phase_map_normalized_cohort.json` | `cf1c6a69dafcab076841eade01f7674d9f3dd8ed9983eec1e847300f39061c32` |
| `phase_map_source_manifest.json` | `bf3e7326b3bdf18fac562dd3c091e8c34e40e48775917272e73675244f73fe69` |
| `phase_map_street_bindings.json` | `44631ea1443c70c8ffdc10543a8c5bd4006d5805879e2b1d2491a8543a87203c` |
| `phase_map_dsq_block_associations.json` | `4bd693a9fd66d4433ef01af0d7285b2f5214fe5626f553bc333ecd2b99fa8f2b` |
| `phase_map_holdout_manifest.json` | `bcb329edb34a2708938f7f48ceaabf90870da26370c7703a63dba57de2cb5630` |
| `phase_map_consecutive_transitions.json` | `de486961e7cb82dbd739f96cee577e1e79125d2c65d6763429eed9f45252e153` |
| `phase_map_perimeter_sequences.json` | `3f2d721a01e4152af0f2fa664a3331bf28325e8795403318a881dec21062875b` |
| `phase_map_ordinal_correlations.json` | `cae181d913ecc408a3be834ae9ed3f380b606bbc1dc7e52f5f2ede539675a8be` |
| `phase_map_candidate_rankings.json` | `4f587d7ed8bdda65f640da8b3fa36db7d23621dcfc781b9125675d849bb15251` |
| `phase_map_frozen_rules.json` | `95d25c38f42ce63d6d6bade2b37bfee1de36b9e55f0b8d5e758d50b0c6e8ce29` |
| `phase_map_holdout_results.json` | `9de2a7f1a0e4c187c0b8e2f34cbeff1dc694b5b055306763ea61d0b54c1e135d` |
| `phase_map_metrics_summary.json` | `f67c082427a4828391512e6b3a3f82b49213c91171b5cdb24119ea3c7f1cd592` |

---

## 6. Product Recommendations for Address Finder

1. **Adopt Multi-Signal Scoring when Listing Exposes Street**:
   When an ad or listing provides a target street name, weighting candidate lot selection by:
   $$\text{Score}(c) = \frac{1}{1 + \Delta\text{LLL}} + 2.5 \cdot \mathbb{I}(\text{MatchTargetStreet}) + 0.5 \cdot \mathbb{I}(\text{MatchAnchorStreet}) + 0.8 \cdot \mathbb{I}(\text{GraphIntersect})$$
   delivers a **2.2x–2.4x compression gain** in Top 5 recall over pure $\Delta\text{LLL}$ candidate generation.
2. **Preserve Fallback for Blind/Unaddressed Searches**:
   When target street is unknown (`NO_TARGET_STREET`), pure $\Delta\text{LLL}$ remains the standard baseline.
