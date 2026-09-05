# Implementation Plan: Phase Address Finder 2.3X3 — Cross-Microarea Street-Face Replication

## Executive Summary

Phase 2.3X2 established strong local street-face cadastral homogeneity within candidate micro-area `CAND-MICRO-14585` (Bosque Flamboyant / Barranco), reducing conditional Shannon entropy from **0.6713 bits** to **0.0000 bits** and raising purity from **77.78%** to **100.00%**.

However, as emphasized in the Phase 2.3X3 prompt:
> **Do NOT describe 2.3X2 as "Definitive Proof".**  
> Observed in `CAND-MICRO-14585`: only 6 faces had usable evidence, much spatial ground truth was `PROBABLE`, and blinded holdout succeeded at Rank 2 rather than Rank 1. This is a **STRONG LOCAL TOPOLOGY SIGNAL**, not yet a general Taubaté cadastral rule.

The objective of **Phase 2.3X3** is an independent, out-of-sample scientific **REPLICATION** in a second urban micro-area (**Microarea B**) selected strictly using pre-analysis data availability criteria, without prior QQQ purity filtering or circular model optimization.

---

## User Review Required

> [!IMPORTANT]
> **Pre-Analysis Microarea Selection**:
> Candidate microareas were screened across Taubaté strictly by pre-analysis criteria (geographic separation from Barranco, residential urban fabric, 4–8 contiguous physical blocks, complete OSM geometry, and data availability score based on volume of documentary BCs, distinct DSQLLLs, and anchored streets). **No QQQ purity or topological homogeneity was computed during selection.**
>
> The top candidate selected for **Microarea B** is **`CAND-MICRO-05186`** (Jardim das Nações / Independência):
> - 4 contiguous physical blocks: `PRB-0326`, `PRB-0327`, `PRB-0732`, `PRB-0746` (Total area: 46,799 m²).
> - Completely distinct urban neighborhood in Sector 3 (versus Barranco in Sector 4).
> - 278 real BC records across 7 distinct DSQLLLs (`3.1.004.013`, `3.1.009.004`, `3.1.009.006`, `3.1.014.001`, `3.3.019.005`, `3.3.019.006`, `4.5.102.004`).
> - 4 anchored streets (`Rua França`, `Rua Argentina`, `Av. Prof. Walter Thaumaturgo`, `Rua Síria`).

> [!IMPORTANT]
> **Scientific Neutrality on Replication Outcomes**:
> The replication pipeline is completely unconstrained and will report whatever empirical metrics emerge:
> - $H(\text{Face}) < H(\text{Block})$, $H(\text{Face}) = H(\text{Block})$, or $H(\text{Face}) > H(\text{Block})$
> - $\text{Purity}(\text{Face}) > \text{Purity}(\text{Block})$, equal, or lower
> No automated assertion will fail the pipeline if the hypothesis fails to replicate. Negative replication is an informative scientific result.

---

## Pre-Analysis Candidate Micro-Area Scoring

Scoring formula based strictly on data availability:
$$\text{Data Availability Score} = 2.0 \times \text{BC\_COUNT} + 5.0 \times \text{DSQLLL\_COUNT} + 10.0 \times \text{ANCHORED\_STREETS} + 1.0 \times \text{STREET\_COUNT}$$

| Candidate ID | Neighborhood | Blocks | Real BCs | Distinct DSQLLLs | Anchored Streets | Total Streets | OSM Coverage | Data Availability Score |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`CAND-MICRO-05186`** *(Selected)* | **Jardim das Nações** | **4** | **278** | **7** | **4** | **14** | **100% (High)** | **1127.2** |
| `CAND-MICRO-27948` | Vila São Geraldo | 4 | 5 | 5 | 3 | 10 | 100% (High) | 830.0 |
| `CAND-MICRO-06598` | Jardim das Nações | 7 | 278 | 7 | 4 | 26 | 100% (High) | 504.0 |
| `CAND-MICRO-02808` | Centro / Bom Conselho | 7 | 377 | 3 | 3 | 29 | 100% (High) | 511.0 |
| `CAND-MICRO-03376` | Centro Histórico | 7 | 106 | 3 | 2 | 27 | 100% (High) | 223.0 |

---

## Frozen Specification for Microarea B

1. **`MICROAREA_B_ID`**: `CAND-MICRO-05186`
2. **`PHYSICAL_BLOCK_IDS`**: `['PRB-0326', 'PRB-0327', 'PRB-0732', 'PRB-0746']`
3. **`NEIGHBORHOOD`**: Jardim das Nações / Independência, Taubaté
4. **`BBOX`**: Longitude `[-45.5745, -45.5703]`, Latitude `[-23.0332, -23.0283]`
5. **`TOTAL_AREA`**: 46,799.7 m²
6. **`STREET_LIST`**: `['Rua França', 'Alameda Cuba', 'Rua Argentina', 'Avenida Professor Walter Thaumaturgo', 'Avenida John Fitzgerald Kennedy', 'Rua Grécia', 'Rua Panamá', 'Rua Peru', 'Rua Venezuela', 'Rua Síria', 'Rua Espanha', 'Rua Áustria', 'Rua Bolívia', 'Rua Equador']`
7. **`SELECTION_RULE`**: Ranked highest on pre-analysis data availability score among all candidate micro-areas of 4–8 contiguous blocks outside Barranco/Bosque Flamboyant.
8. **`SELECTION_HASH`**: Computed SHA-256 over candidate metadata and frozen road network.

---

## Proposed Changes

### Scripts & Pipelines

#### [NEW] [run_phase_2_3x3_master.py](file:///C:/Users/Marcel/.gemini/antigravity/brain/5c4a2f49-593d-45c6-935f-4c04d23e5787/scratch/run_phase_2_3x3_master.py)
Master execution script implementing:
1. Pre-analysis candidate table serialization (`microarea_b_selection.json`).
2. Standardization of 16 directed street faces across the 4 physical blocks:
   - `PRB-0326_FACE_{N,S,E,W}`
   - `PRB-0327_FACE_{N,S,E,W}`
   - `PRB-0732_FACE_{N,S,E,W}`
   - `PRB-0746_FACE_{N,S,E,W}`
3. Exhaustive offline evidence inventory and parcel matrix matching (`microarea_b_existing_evidence_inventory.json`, `microarea_b_face_parcel_matrix.json`).
4. Strict confidence classification: `EXACT_PARCEL`, `EXACT_STREET_FACE`, `PROBABLE_STREET_FACE`, `STREET_ONLY`, `UNRESOLVED`.
5. Information-theoretic topology metrics:
   - $H(QQQ \mid \text{Block})$
   - $H(QQQ \mid \text{Face})$
   - $\Delta \text{Entropy} = H(\text{Face}) - H(\text{Block})$
   - $\text{Purity}(\text{Block})$, $\text{Purity}(\text{Face})$, $\Delta \text{Purity}$
   - $P(\text{Single } QQQ \mid \text{Face})$
6. **Leave-One-Street-Face-Out (LOFO) Experiment**:
   - For every eligible face $i \in \{1 \dots N\}$, hold out all QQQ/BC evidence on face $i$.
   - Predict candidate QQQ ranking using surrounding block and street topology.
   - Unblind ground truth and record Top-1, Top-3, Top-5 accuracy, Mean Reciprocal Rank (MRR), and median rank.
7. **Topology Purity vs Predictability Distinction**:
   - Report `TOPOLOGY_PURITY` (intrinsic mono-cadastrality) and `OUT_OF_SAMPLE_QQQ_PREDICTION` (inferability from neighbors) as separate capabilities.
8. **Cross-Microarea Comparison**:
   - Tabulate Microarea A (`CAND-MICRO-14585`) vs Microarea B (`CAND-MICRO-05186`).
9. Cartographic rendering: `microarea_b_cadastral_map.png`.
10. Historical reports and results synchronization in `brain/address_finder/`.

### Deliverables Created / Updated

- `facade-checker/data/address_finder_bc_anchors_v1/microarea_b_selection.json`
- `facade-checker/data/address_finder_bc_anchors_v1/microarea_b_existing_evidence_inventory.json`
- `facade-checker/data/address_finder_bc_anchors_v1/microarea_b_face_parcel_matrix.json`
- `facade-checker/data/address_finder_bc_anchors_v1/microarea_b_topology_metrics.json`
- `facade-checker/data/address_finder_bc_anchors_v1/microarea_b_lofo_results.json`
- `facade-checker/data/address_finder_bc_anchors_v1/cross_microarea_comparison.json`
- `brain/address_finder/maps/microarea_b_cadastral_map.png`
- `brain/address_finder/reports/PHASE_2.3X3_CROSS_MICROAREA_REPLICATION.md`
- `brain/address_finder/LATEST_PHASE_REPORT.md`
- `brain/address_finder/LATEST_PHASE_RESULTS.json`
- `walkthrough.md`

---

## Verification Plan

### Automated Execution & Validation
1. Execute `python run_phase_2_3x3_master.py` and ensure exit code 0.
2. Verify all JSON deliverables are valid JSON and non-empty.
3. Verify SHA-256 dataset hashes.
4. Verify cartographic map PNG is rendered and saved.
5. Verify cross-microarea comparison table accurately pulls from Phase 2.3X2 metrics without regressions.

### Git Version Control
1. Commit all Phase 2.3X3 deliverables and reports.
2. Push cleanly to `origin main` at `https://github.com/mlapidotome/facade-checker.git`.
3. Provide full git commit hash and termination signal `STOP_FOR_HUMAN_REVIEW`.
