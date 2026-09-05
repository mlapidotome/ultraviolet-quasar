import os

plan_text = r"""# Implementation Plan — Phase Anchor to Target Street LLL Prediction
## Directed Cadastral Candidate Generation & Rank Compression

## 1. Problem Statement & Scientific Objective

In the previous phases, we demonstrated that:
1. Within a Taubaté cadastral block (`D.S.QQQ`), lot numbers (`LLL`) along the same street face exhibit monotonic alignment with physical addresses (median Spearman $|\rho| = 1.00$).
2. Immediate lot transitions ($\Delta\text{LLL}=1$) between different streets match physical road network intersections **71.7%** of the time and confirmed physical block corners **80.8%** of the time.
3. Supplying the target street name from a real estate listing compresses candidate generation by **2.2x–2.4x** at Top 5 recall.

The core product and engineering question for **Address Finder** is:
> **Given the correct cadastral block (`DSQ`), one known reference anchor (`BC_anchor`, `Street_anchor`, `LLL_anchor`), and the target street name from a listing (`Street_target`), can a directed cadastral model accurately predict the target property's `LLL` position and generate a highly compressed candidate list ($\le 5$ to $10$ candidates) with high recall?**

This phase will **NOT** query protected municipal portals, solve CAPTCHAs, or run Facade Checker.

---

## 2. User Review Required & Pre-Registered Criteria

> [!IMPORTANT]
> **Product Success Thresholds (Pre-Registered on Blind Holdout)**:
> - **`HIGH_VALUE`**: Blind holdout achieves **Top 5 Recall $\ge 70\%$** AND **Top 10 Recall $\ge 85\%$** with candidate list size dramatically smaller than naive $001..080$ bounded generation.
> - **`PARTIAL_VALUE`**: Blind holdout achieves **Top 5 Recall $\ge 45\%$** OR **Top 10 Recall $\ge 65\%$** with stable out-of-sample replication.
> - **`LOW_VALUE`**: Performance fails to improve meaningfully over Baseline A ($\Delta\text{LLL}$ only) or Baseline E (Random same-DSQ window).

> [!IMPORTANT]
> **Strict Separation of Target Street Relationships**:
> Predictions must be explicitly benchmarked across 4 topological relationships:
> 1. `SAME_STREET_TARGET`: Target is on the same street as anchor (`Street_target == Street_anchor`).
> 2. `ADJACENT_STREET_TARGET`: Target is on a direct intersecting cross-street connected to anchor street.
> 3. `NON_ADJACENT_STREET_TARGET`: Target is on a different, non-intersecting street in the same DSQ.
> 4. `UNRESOLVED_MAP_TARGET`: Target or anchor street cannot be resolved to the OSM road graph.

> [!IMPORTANT]
> **Directional LLL Prediction Evaluation**:
> In addition to rank recall, we will test whether the model can predict the sign of lot displacement:
> $$\text{Direction} = \text{sign}(\text{LLL}_{\text{target}} - \text{LLL}_{\text{anchor}})$$
> without observing the true target LLL. Directional accuracy will be reported for all qualifying street runs.

---

## 3. End-to-End Pipeline Architecture

```mermaid
graph TD
    subgraph Stage 1: Dataset & Topological Feature Binding
        A1[Audited Cohort: 1,325 Records / 1,306 Unique DSQLLLs / 63 DSQs] --> A2[Collapse SSS to DSQLLL]
        A3[OSM Road Network: 3,452 Streets & 3,360 Road Blocks] --> B1[Pre-Computed Street & Block Associations]
        A2 & B1 --> B2[Construct Complete Pairwise Query Space]
    end

    subgraph Stage 2: Pre-Registered Blind Holdout Split
        B2 --> C1[Stratified Complete-DSQ Split - Seed 42]
        C1 --> C2[Development Cohort: ~48 DSQs]
        C1 --> C3[Holdout Cohort: ~15 DSQs]
        C3 --> C4[Freeze phase_anchor_target_holdout_manifest.json + SHA-256]
    end

    subgraph Stage 3: Model Calibration on Dev Cohort
        C2 --> D1[Feature Extraction: Delta-LLL, Target Match, Graph Corner, Run Direction]
        D1 --> D2[Simulate 5 Baselines: A, B, C, D, E]
        D1 --> D3[Calibrate Directed Transition Ranker Weights]
        D1 --> D4[Directional LLL Sign Prediction Test]
        D2 & D3 & D4 --> D5[Evaluate Top 1, 3, 5, 10, 20 Recall, MRR & Candidate Counts]
    end

    subgraph Stage 4: Rule Freezing & Holdout Evaluation
        D5 --> E1[Freeze phase_anchor_target_frozen_rules.json + SHA-256]
        E1 & C4 --> F1[Evaluate Untouched Blind Holdout Cohort]
        F1 --> F2[Verify Out-of-Sample Stability & Generalization]
    end

    subgraph Stage 5: Reporting & Deliverables
        F2 --> G1[Generate 6 JSON Deliverables + SHA-256 Checksums]
        G1 --> G2[Update LATEST_PHASE_REPORT.md & LATEST_PHASE_RESULTS.json]
        G2 --> G3[Commit, Push main & STOP_FOR_HUMAN_REVIEW]
    end
```

---

## 4. Methodological Components

### 4.1 Input Ingestion & Query Simulation Setup
- **Dataset**: Audited Taubaté cadastral cohort (1,325 raw records, 1,306 unique `DSQLLL` spatial parcels, 63 unique `DSQ` blocks).
- **Query Definition**: Each query simulates an Address Finder search:
  - **Inputs available to model**:
    - Anchor parcel: `bc_anchor`, `dsq`, `lll_anchor`, `street_anchor`.
    - Listing query: `street_target`.
    - Independent road network context: graph intersections, physical block border sequence (where resolved).
  - **Hidden Ground Truth**: `lll_target`, `bc_target` (hidden during scoring/ranking).
- **Deliverable**: `phase_anchor_target_queries.json`.

### 4.2 Candidate Ranking Baselines
For every query $(i, j)$ where $i \neq j$ in the same DSQ:
- **Baseline A (`DELTA_LLL_ONLY`)**:
  $$\text{Score}(c) = \frac{1}{1 + |\text{LLL}_c - \text{LLL}_{\text{anchor}}|}$$
- **Baseline B (`TARGET_STREET_FILTER_PLUS_DELTA_LLL`)**:
  Hard filter / large boost for candidates matching `street_target`, ranked by $\Delta\text{LLL}$:
  $$\text{Score}(c) = 100 \cdot \mathbb{I}(\text{Street}_c == \text{Street}_{\text{target}}) + \frac{1}{1 + |\text{LLL}_c - \text{LLL}_{\text{anchor}}|}$$
- **Baseline C (`TARGET_STREET_PLUS_GRAPH_INTERSECTION`)**:
  $$\text{Score}(c) = \frac{1}{1 + \Delta\text{LLL}} + 2.5 \cdot \mathbb{I}(\text{MatchTargetStreet}) + 0.5 \cdot \mathbb{I}(\text{MatchAnchorStreet}) + 0.8 \cdot \mathbb{I}(\text{GraphIntersect})$$
- **Baseline D (`TARGET_STREET_PLUS_MAP_AWARE_PERIMETER_MODEL`)**:
  Incorporate cyclic perimeter hop distance along block polygon edges when block geometry is resolved:
  $$\text{Score}(c) = \text{Score}_{\text{BaseC}}(c) + 1.2 \cdot \frac{1}{1 + \text{PerimeterHopDistance}(\text{Street}_{\text{anchor}}, \text{Street}_c)}$$
- **Baseline E (`RANDOM_SAME_DSQ`)**:
  Uniform random permutation of same-DSQ candidates (Control B).

### 4.3 Output Metrics & Compression Profile
For all baselines and models across Dev and Holdout cohorts:
1. **Rank Recall**: Top 1, Top 3, Top 5, Top 10, Top 20.
2. **Mean Reciprocal Rank (MRR)**:
   $$\text{MRR} = \frac{1}{Q} \sum_{q=1}^Q \frac{1}{\text{Rank}_q}$$
3. **Candidate Burden / Compression Profile**:
   - Median candidate count to reach target.
   - P75 and P90 candidate count.
   - Effective candidate list size reduction vs naive $001..080$ generation (80 candidates).

### 4.4 Transition-Aware & Directional Analysis
1. **Transition Breakdown**:
   - `SAME_STREET_TARGET`
   - `ADJACENT_STREET_TARGET` (direct graph intersection)
   - `NON_ADJACENT_STREET_TARGET`
   - `UNRESOLVED_MAP_TARGET`
2. **Directional LLL Sign Prediction**:
   - For queries along monotonic street runs, predict whether $\text{LLL}_{\text{target}} > \text{LLL}_{\text{anchor}}$ or $\text{LLL}_{\text{target}} < \text{LLL}_{\text{anchor}}$ based on door number parity / house number trend or perimeter traversal direction.
   - Measure binary directional classification accuracy.

### 4.5 Pre-Registration & Rule Freezing Protocol
- Model weights, feature sets, and decision thresholds will be fitted strictly on the Development DSQs (~48 DSQs).
- Rules will be serialized into `phase_anchor_target_frozen_rules.json` and hashed with SHA-256 before opening the Holdout dataset (~15 DSQs).

### 4.6 Deliverables Inventory
The following 6 JSON deliverables will be created in `facade-checker/data/address_finder_bc_anchors_v1/`:
1. `phase_anchor_target_queries.json` (Full query catalog)
2. `phase_anchor_target_rankings.json` (Simulation results across all baselines)
3. `phase_anchor_target_holdout_manifest.json` (Pre-registered holdout split + SHA-256)
4. `phase_anchor_target_frozen_rules.json` (Pre-registered frozen rules + SHA-256)
5. `phase_anchor_target_holdout_results.json` (Blind holdout evaluation metrics)
6. `phase_anchor_target_metrics_summary.json` (Consolidated metrics & final classification)

---

## 5. Verification Plan

### Automated Execution & Artifact Generation
- Pipeline script: `python scratch/run_phase_anchor_target_master.py`.
- Verify all 6 JSON deliverables and `.sha256` checksums in `facade-checker/data/address_finder_bc_anchors_v1/`.
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

print("Raw string implementation plan written cleanly!")
