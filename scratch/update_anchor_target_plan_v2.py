import os

plan_text = r"""# Implementation Plan — Phase Anchor to Target Street LLL Prediction
## Directed Cadastral Candidate Generation, House-Number Reliability & Structural Interval Prediction

## 1. Problem Statement & Scientific Objective

In prior validation phases, we demonstrated that:
1. Within a Taubaté cadastral block (`D.S.QQQ`), lot numbers (`LLL`) along the same street face exhibit monotonic alignment with physical addresses (median Spearman $|\rho| = 1.00$).
2. Immediate lot transitions ($\Delta\text{LLL}=1$) between different streets match physical road network intersections **71.7%** of the time and confirmed physical block corners **80.8%** of the time.
3. Supplying the target street name from a real estate listing compresses candidate generation by **2.2x–2.4x** at Top 5 recall.

The core production and engineering questions for **Address Finder** are:
> **1. Primary Question (`TARGET_STREET_ONLY`)**: Given the correct cadastral block (`DSQ`), one known reference anchor (`BC_anchor`, `Street_anchor`, `LLL_anchor`), and the target street name from a listing (`Street_target`), can a directed cadastral model accurately predict the target property's `LLL` position and produce a highly compressed candidate list without any house number input?
> **2. Secondary Question (`UNVERIFIED_HOUSE_NUMBER`)**: When a listing displays an unverified house number, can it be used safely as a soft ranking feature without ever hard-filtering candidates or breaking retrieval when the listing number is erroneous, approximate, or obfuscated?
> **3. Structural Question (`STRUCTURAL_INTERVAL_PREDICTION`)**: Can the model predict a compact numeric LLL search interval ($[L_{\min}, L_{\max}]$) when searching for unindexed or newly subdivided properties not yet present in the observed cadastral cohort?

This phase is **measurement and validation only**. It will **NOT** query protected municipal portals, solve CAPTCHAs, or execute Facade Checker.

---

## 2. User Review Required & Pre-Registered Criteria

> [!IMPORTANT]
> **Mandatory House-Number Reliability Policy**:
> - Any house number extracted from a listing must be treated strictly as **`HOUSE_NUMBER_PRESENT_UNVERIFIED`** by default.
> - Advertised numbers are never treated as ground truth and must **NEVER** act as hard candidate elimination filters.
> - **Mandatory Invariant**: `TRUE_TARGET_DISCARDED_BY_NUMBER_RULE = 0`. Mismatches may alter ranking order but must never drop candidates from candidate pools.

> [!IMPORTANT]
> **Primary vs Secondary Evaluation Regimes**:
> - **Primary Benchmark (`TARGET_STREET_ONLY`)**: Evaluated strictly without house numbers or parity features. Global classification (`HIGH_VALUE`, `PARTIAL_VALUE`, `LOW_VALUE`) is governed exclusively by this primary regime.
> - **Secondary Benchmark (`TARGET_STREET_PLUS_UNVERIFIED_HOUSE_NUMBER`)**: Evaluates soft proxy features (exact match, difference bands: $0, 1\text{--}10, 11\text{--}20, 21\text{--}50, 51\text{--}100, >100$, parity compatibility).
> - **Synthetic Robustness Suite**: Stress-tests ranking degradation across 8 synthetic corruption regimes (`NUMBER_CORRECT`, offsets $1\text{--}10, 11\text{--}20, 21\text{--}50, 51\text{--}100$, `LARGE_CONFLICT`, `PARITY_FLIPPED`, `MISSING`).
> - **Theoretical Upper Bound (`VERIFIED_HOUSE_NUMBER_UPPER_BOUND`)**: Benchmarks performance when a number is independently verified by trusted spatial evidence (not production baseline).

> [!IMPORTANT]
> **Observed Retrieval vs Structural Interval Distinction**:
> - **`OBSERVED_CANDIDATE_RETRIEVAL`**: Ranks existing observed BC records in the cadastral database.
> - **`STRUCTURAL_INTERVAL_PREDICTION`**: Predicts a continuous numeric LLL window $[L_{\min}, L_{\max}]$ for unindexed targets. Reports interval width, true LLL capture recall, and candidate burden ($P_{50}, P_{75}, P_{90}$).

---

## 3. End-to-End Pipeline Architecture

```mermaid
graph TD
    subgraph Stage 1: Cohort & Topology Ingestion
        A1[Audited Cohort: 1,325 Records / 1,306 Unique DSQLLLs / 63 DSQs] --> A2[Collapse SSS to DSQLLL Spatial Parcels]
        A3[OSM Road Graph: 3,452 Streets & 3,360 Blocks] --> B1[Street Bindings & Block Associations]
        A2 & B1 --> B2[Generate Pairwise Anchor-Target Query Space]
    end

    subgraph Stage 2: Pre-Registered Complete-DSQ Holdout Split
        B2 --> C1[Stratified Complete-DSQ Split - Seed 42]
        C1 --> C2[Development Cohort: ~48 DSQs]
        C1 --> C3[Holdout Cohort: ~15 DSQs]
        C3 --> C4[Freeze phase_anchor_target_holdout_manifest.json + SHA-256]
    end

    subgraph Stage 3: Multi-Model Evaluation on Dev Cohort
        C2 --> D1[Primary Model F: MULTI_SIGNAL_TARGET_STREET_ONLY]
        C2 --> D2[Secondary Model G: MULTI_SIGNAL_UNVERIFIED_HOUSE_NUMBER]
        C2 --> D3[Upper Bound Model H: VERIFIED_HOUSE_NUMBER_UPPER_BOUND]
        C2 --> D4[Baselines A, B, C, D, E]
        D1 & D2 & D3 & D4 --> D5[Evaluate Top 1..20, MRR & Candidate Burden]
        D2 --> D6[Synthetic House-Number Corruption Suite - 8 Regimes]
        D1 --> D7[Directional LLL Sign Prediction & Structural Interval Sizing]
    end

    subgraph Stage 4: Rule Freezing & Blind Holdout Evaluation
        D5 & D6 & D7 --> E1[Freeze phase_anchor_target_frozen_rules.json + SHA-256]
        E1 & C4 --> F1[Evaluate Untouched Blind Holdout Cohort]
        F1 --> F2[Verify Out-of-Sample Generalization & Robustness]
    end

    subgraph Stage 5: Deliverables & Recommendations
        F2 --> G1[Generate 7 JSON Artifacts + SHA-256 Checksums]
        G1 --> G2[Update LATEST_PHASE_REPORT.md & LATEST_PHASE_RESULTS.json]
        G2 --> G3[Commit, Push main & STOP_FOR_HUMAN_REVIEW]
    end
```

---

## 4. Methodological Components

### 4.1 Input Ingestion & Query Simulation
- **Dataset**: Audited cohort (1,325 raw records, 1,306 unique `DSQLLL` spatial parcels, 63 unique `DSQ` blocks).
- **Query Inputs**:
  - `bc_anchor`, `dsq`, `lll_anchor`, `street_anchor`
  - `street_target` (from listing)
  - `listing_house_number` (optional, unverified)
  - Independent road graph topology & block boundaries (where resolved)
- **Hidden Labels**: `lll_target`, `bc_target`, `true_house_number`, coordinates.
- **Deliverable**: `phase_anchor_target_queries.json`.

### 4.2 Comprehensive Model & Baseline Inventory
For every query $(i, j)$ where $i \neq j$ in the same DSQ:
- **Baseline A (`DELTA_LLL_ONLY`)**:
  $$\text{Score}(c) = \frac{1}{1 + |\text{LLL}_c - \text{LLL}_{\text{anchor}}|}$$
- **Baseline B (`TARGET_STREET_FILTER_PLUS_DELTA_LLL`)**:
  $$\text{Score}(c) = 100 \cdot \mathbb{I}(\text{Street}_c == \text{Street}_{\text{target}}) + \frac{1}{1 + |\text{LLL}_c - \text{LLL}_{\text{anchor}}|}$$
- **Baseline C (`TARGET_STREET_PLUS_GRAPH_INTERSECTION`)**:
  $$\text{Score}(c) = \frac{1}{1 + \Delta\text{LLL}} + 2.5 \cdot \mathbb{I}(\text{MatchTargetStreet}) + 0.5 \cdot \mathbb{I}(\text{MatchAnchorStreet}) + 0.8 \cdot \mathbb{I}(\text{GraphIntersect})$$
- **Baseline D (`TARGET_STREET_PLUS_MAP_AWARE_PERIMETER_MODEL`)**:
  $$\text{Score}(c) = \text{Score}_{\text{BaseC}}(c) + 1.2 \cdot \frac{1}{1 + \text{PerimeterHopDistance}(\text{Street}_{\text{anchor}}, \text{Street}_c)}$$
- **Baseline E (`RANDOM_SAME_DSQ`)**: Uniform random ranking of candidates in DSQ.
- **Model F (`MULTI_SIGNAL_TARGET_STREET_ONLY`) [Primary Production Candidate]**:
  Directional and corner-aware weighting without house number inputs.
- **Model G (`MULTI_SIGNAL_UNVERIFIED_HOUSE_NUMBER`) [Secondary Soft Candidate]**:
  $$\text{Score}(c) = \text{Score}_F(c) + w_{\text{num}} \cdot \text{SoftNumberCompatibility}(\text{Num}_c, \text{Num}_{\text{listing}})$$
  *Compatibility Bands: Exact match ($+1.5$), Diff $\le 10$ ($+1.0$), Diff $11\text{--}20$ ($+0.6$), Diff $21\text{--}50$ ($+0.3$), Parity match ($+0.2$), Large conflict ($0.0$). Zero candidate discards.*
- **Model H (`VERIFIED_HOUSE_NUMBER_UPPER_BOUND`) [Theoretical Upper Bound]**:
  Evaluates ranking when true house number is verified by independent spatial ground truth.

### 4.3 House-Number Robustness Suite
Stress-test Model G against 8 synthetic corruption regimes on numbered targets:
1. `NUMBER_CORRECT`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}}$
2. `NUMBER_OFFSET_1_TO_10`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} \pm \text{Unif}(1, 10)$
3. `NUMBER_OFFSET_11_TO_20`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} \pm \text{Unif}(11, 20)$
4. `NUMBER_OFFSET_21_TO_50`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} \pm \text{Unif}(21, 50)$
5. `NUMBER_OFFSET_51_TO_100`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} \pm \text{Unif}(51, 100)$
6. `NUMBER_LARGE_CONFLICT`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} \pm \text{Unif}(150, 500)$
7. `NUMBER_PARITY_FLIPPED`: $\text{Num}_{\text{listing}} = \text{Num}_{\text{true}} + 1$
8. `NUMBER_MISSING`: $\text{Num}_{\text{listing}} = \text{None}$

Metrics reported per regime:
- Top 1, Top 3, Top 5, Top 10, Top 20, MRR
- $\Delta\text{Top5 vs Model F}$, $\Delta\text{Top10 vs Model F}$
- `TRUE_TARGET_RANK_DEGRADATION`
- `TRUE_TARGET_DISCARDED_BY_NUMBER_RULE` (Mandatory: $= 0$)
- **Deliverable**: `phase_anchor_target_house_number_robustness.json`.

### 4.4 Structural Interval Prediction
For unindexed cadastral exploration:
1. Predict target LLL displacement interval $[L_{\min}, L_{\max}]$ centered on anchor LLL + predicted directional offset:
   - Width tiers: $W \in \{5, 10, 15, 20, 30\}$
2. Measure:
   - Interval recall: $P(\text{LLL}_{\text{target}} \in [L_{\min}, L_{\max}])$
   - Candidate count burden: Median, $P_{75}$, $P_{90}$
   - Candidate reduction factor vs naive $001..080$ generation (80 candidates).

### 4.5 Pre-Registered Classification Criteria
Evaluated strictly on the primary `TARGET_STREET_ONLY` model across Blind Holdout DSQs:
- **`HIGH_VALUE`**: Holdout achieves **Top 5 $\ge 70\%$** AND **Top 10 $\ge 85\%$** with candidate list size dramatically smaller than naive $001..080$ generation.
- **`PARTIAL_VALUE`**: Holdout achieves **Top 5 $\ge 45\%$** OR **Top 10 $\ge 65\%$** with stable out-of-sample replication.
- **`LOW_VALUE`**: No meaningful improvement over Baselines A or E.

### 4.6 Deliverables Inventory
1. `phase_anchor_target_queries.json`
2. `phase_anchor_target_rankings.json`
3. `phase_anchor_target_holdout_manifest.json`
4. `phase_anchor_target_frozen_rules.json`
5. `phase_anchor_target_holdout_results.json`
6. `phase_anchor_target_metrics_summary.json`
7. `phase_anchor_target_house_number_robustness.json`

---

## 5. Verification Plan

### Automated Execution & Artifact Generation
- Pipeline script: `python scratch/run_phase_anchor_target_master.py`.
- Verify all 7 JSON deliverables and `.sha256` checksums in `facade-checker/data/address_finder_bc_anchors_v1/`.
- Validate pre-registered holdout hash and frozen rule hash timestamps.
- Generate full reports:
  - `brain/address_finder/reports/PHASE_ANCHOR_TO_TARGET_STREET_LLL_PREDICTION.md`
  - `brain/address_finder/LATEST_PHASE_REPORT.md`
  - `brain/address_finder/LATEST_PHASE_RESULTS.json`
- Commit and push to `origin main`.
- Conclude with `STOP_FOR_HUMAN_REVIEW`.
"""

with open('brain/address_finder/LATEST_IMPLEMENTATION_PLAN.md', 'w', encoding='utf-8') as f:
    f.write(plan_text.strip() + '\n')

with open(r'C:\Users\Marcel\.gemini\antigravity\brain\5c4a2f49-593d-45c6-935f-4c04d23e5787\implementation_plan.md', 'w', encoding='utf-8') as f:
    f.write(plan_text.strip() + '\n')

print("Plan updated successfully with all house-number reliability safeguards!")
