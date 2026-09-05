# Implementation Plan: Phase Address Finder 2.3X3 — Cross-Microarea Street-Face Replication (Revised)

## Executive Summary & Plan Status

**Status**: `PLAN_CORRECTED_AND_READY_FOR_REVIEW`  
This revised plan addresses 100% of the methodological corrections mandated in the **PHASE 2.3X3 PLAN REVIEW**:

1. **Exact Arithmetic Score Reconciliation**: Every score is calculated using an auditable, reproducible formula with every term explicitly published (`RAW_INPUT_VALUES`, `FORMULA`, `TERM_DSQLLL`, `TERM_ANCHORED_STREETS`, `TERM_OPEN`, `TERM_BLOCKS`, `TERM_LOG_BC`, `TERM_STREETS`, `FINAL_SCORE`).
2. **Parcel-Level Denominator & SSS Collapse**: Raw BCs are collapsed by SSS into distinct physical parcels (`DISTINCT_DSQLLL`). Raw BC counts are log-transformed ($2.0 \times \log_2(1 + N)$) so condominium unit volume cannot dominate spatial parcel density.
3. **Audit of the 278 → 7 Collapse**: Full breakdown of all 7 DSQLLLs in Jardim das Nações, identifying that 272 BCs came from a single vertical condominium (**Condomínio Jatobá**, `4.5.102.004`) without a door number.
4. **Geographic Consistency Audit**: Per Addendum Point 5, `4.5.102.004` (Sector 4 / Subsector 5, unnumbered avenue location) is **audited out** from local block assignment because it lacks independent spatial evidence placing it inside the micro-area blocks.
5. **Batch-Blinded Leave-One-Street-Face-Out (LOFO)**: All predictions across all eligible folds are generated and frozen in `LOFO_PREDICTIONS.json` with a cryptographic SHA-256 hash *before* ground truth is loaded and evaluated in a single unblinding pass.
6. **Scientific Neutrality**: Complete acceptance of replication outcomes without invariant constraints.

---

## 1. Audit of the 278 → 7 Record Collapse (`CAND-MICRO-05186`)

| DSQLLL | D | S | QQQ | LLL | Full BC Count | Distinct SSS | Property Type | Documented Street | House Number | Spatial Evidence Level | Source ID & Document |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- | :---: | :--- | :--- |
| `3.1.004.013` | 3 | 1 | 004 | 013 | 1 | 1 | Residential Lot | Rua Argentina | None | `STREET_ONLY` | `ANCHOR-EXT-035-04` (Public Doc) |
| `3.1.009.004` | 3 | 1 | 009 | 004 | 1 | 1 | Residential Lot | Rua França | None | `STREET_ONLY` | `ANCHOR-010` (Public Address) |
| `3.1.009.006` | 3 | 1 | 009 | 006 | 1 | 1 | Residential Lot | Rua França | None | `STREET_ONLY` | `ANCHOR-EXT-010-03` (Public Doc) |
| `3.1.014.001` | 3 | 1 | 014 | 001 | 1 | 1 | Residential Lot | Rua França | None | `STREET_ONLY` | `ANCHOR-011` (Public Address) |
| `3.3.019.005` | 3 | 3 | 019 | 005 | 1 | 1 | Residential Lot | Rua Síria | None | `STREET_ONLY` | `ANCHOR-EXT-004-02` (Public Doc) |
| `3.3.019.006` | 3 | 3 | 019 | 006 | 1 | 1 | Residential Lot | Rua Síria | None | `STREET_ONLY` | `ANCHOR-012` (Public Address) |
| `4.5.102.004` | 4 | 5 | 102 | 004 | 272 | 272 | Vertical Condo (Jatobá) | Av. Prof. Walter Thaumaturgo | None | `UNVERIFIED_AVENUE` | `cadastros_jatoba.xlsx` |

### Audit Findings & Geographic Consistency Decision
- **272 of the 278 BCs** in `CAND-MICRO-05186` are SSS apartment units (`.001` to `.272`) from `cadastros_jatoba.xlsx` belonging to **Condomínio Jatobá** on Avenida Professor Walter Thaumaturgo.
- **Geographic Misalignment**: The microarea blocks are in Sector 3 (Jardim das Nações), while Jatobá is registered under Sector 4 (`4.5.102`).
- **No Door Number**: The record contains no house number or corner description.
- **Mandatory Decision**: Per Review Point 5, **`4.5.102.004` is audited out from local spatial assignment** in Microarea B. Only verifiable parcels with independent spatial connection to the microarea are included.

---

## 2. Reconciled Pre-Analysis Selection Formula (V2.0 Audited)

To reward independent spatial evidence and prevent condominium unit distortion:

$$\begin{aligned}
\text{Score} &= 20.0 \times \text{DISTINCT\_DSQLLL\_COUNT} \\
&\quad + 15.0 \times \text{ANCHORED\_STREET\_COUNT} \\
&\quad + 10.0 \times \text{OPEN\_STREET\_PARCEL\_COUNT} \\
&\quad + 5.0 \times \text{PHYSICAL\_BLOCK\_COUNT} \\
&\quad + 2.0 \times \log_2(1 + \text{RAW\_BC\_COUNT}) \\
&\quad + 1.0 \times \text{TOTAL\_STREET\_COUNT}
\end{aligned}$$

> [!NOTE]
> **Strict Pre-Analysis Constraint**: No QQQ purity, entropy, same-face consistency, or topological performance is used in this formula. Every term is calculated strictly from geometric and inventory availability.

---

## 3. Audited Candidate Micro-Area Scoring Table

Every score below reconciles exactly to the arithmetic sum of its terms:

| Candidate ID | Neighborhood | Blocks | Raw BCs | Distinct DSQLLLs | Open Parcels | Anchored Streets | Total Streets | Term DSQLLL | Term Anchored | Term Open | Term Blocks | Term LogBC | Term Streets | Final Score |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`CAND-MICRO-06598`** *(Rank 1 Overall)* | **Jardim das Nações** | **7** | **6** | **6** | **6** | **3** | **26** | **120.0** | **45.0** | **60.0** | **35.0** | **5.61** | **26.0** | **291.61** |
| `CAND-MICRO-06883` | Jardim das Nações | 7 | 6 | 6 | 6 | 3 | 26 | 120.0 | 45.0 | 60.0 | 35.0 | 5.61 | 26.0 | 291.61 |
| `CAND-MICRO-06600` | Jardim das Nações | 7 | 6 | 6 | 6 | 3 | 26 | 120.0 | 45.0 | 60.0 | 35.0 | 5.61 | 26.0 | 291.61 |
| **`CAND-MICRO-04592`** *(Rank 1 in 4-Block)* | **Jardim das Nações** | **4** | **6** | **6** | **6** | **3** | **19** | **120.0** | **45.0** | **60.0** | **20.0** | **5.61** | **19.0** | **269.61** |
| `CAND-MICRO-04682` | Jardim das Nações | 4 | 6 | 6 | 6 | 3 | 19 | 120.0 | 45.0 | 60.0 | 20.0 | 5.61 | 19.0 | 269.61 |
| `CAND-MICRO-05186` | Jardim das Nações | 4 | 6 | 6 | 6 | 3 | 14 | 120.0 | 45.0 | 60.0 | 20.0 | 5.61 | 14.0 | 264.61 |
| `CAND-MICRO-27948` | Vila São Geraldo | 4 | 5 | 5 | 5 | 3 | 10 | 100.0 | 45.0 | 50.0 | 20.0 | 5.17 | 10.0 | 230.17 |
| `CAND-MICRO-08704` | Jardim Continental | 7 | 3 | 3 | 3 | 2 | 21 | 60.0 | 30.0 | 30.0 | 35.0 | 4.00 | 21.0 | 180.00 |

### Arithmetic Verification Sample
- **`CAND-MICRO-06598`**: $120.0 + 45.0 + 60.0 + 35.0 + 5.61 + 26.0 = \mathbf{291.61}$.
- **`CAND-MICRO-04592`**: $120.0 + 45.0 + 60.0 + 20.0 + 5.61 + 19.0 = \mathbf{269.61}$.
- **`CAND-MICRO-05186`**: $120.0 + 45.0 + 60.0 + 20.0 + 5.61 + 14.0 = \mathbf{264.61}$.
- **`CAND-MICRO-27948`**: $100.0 + 45.0 + 50.0 + 20.0 + 5.17 + 10.0 = \mathbf{230.17}$.

---

## 4. Automatic Selection & Frozen Specification for Microarea B

Emerging from the corrected formula:

### Primary Selected Candidate: `CAND-MICRO-06598` (7 Contiguous Blocks)
- **`MICROAREA_B_ID`**: `CAND-MICRO-06598`
- **`PHYSICAL_BLOCK_COUNT`**: 7 contiguous physical road blocks
- **`PHYSICAL_BLOCK_IDS`**: `['PRB-0264', 'PRB-0326', 'PRB-0401', 'PRB-0419', 'PRB-0427', 'PRB-0428', 'PRB-0746']`
- **`NEIGHBORHOOD`**: Jardim das Nações / Independência, Taubaté
- **`TOTAL_AREA`**: 118,520 m²
- **`STREET_LIST`**: `['Rua França', 'Rua Argentina', 'Rua Síria', 'Rua Cuba', 'Rua Áustria', 'Rua Espanha', 'Rua Colômbia', 'Rua Equador', 'Rua Alemanha', 'Av. John Fitzgerald Kennedy', 'Av. Prof. Walter Thaumaturgo']`
- **`DATA_AVAILABILITY_SCORE`**: **291.61** (Rank 1 across all 23,248 eligible candidates in Taubaté outside Barranco)
- **`SELECTION_RULE_VERSION`**: `2.0_AUDITED_RECONCILED`
- **`SELECTION_RULE`**: Automatic argmax on Reconciled Data Availability Score (V2.0) with unverified avenue condos excluded.

*(Alternative 4-Block Option: If the human reviewer prefers strictly 4 blocks to mirror Microarea A's size, **`CAND-MICRO-04592`** [Score: 269.61] or **`CAND-MICRO-05186`** [Score: 264.61] is available and fully audited).*

---

## 5. Frozen Cryptographic Input Manifest

| Dataset / Entity | SHA-256 Hash |
| :--- | :--- |
| `road_network_taubate.json` | `a3ae551bd1bbff73a960eb5b15bc770dfa6ae01665974b5165c0b8043fb832ab` |
| `historical_real_bc_index.json` | `ddac10be609f5cb0009b069d1a4e10fbe915a987b5a91a4ba7916e8c02175365` |
| `dense_microarea_candidates.json` | `a374bceb2628d6dd6661045ff706bad4603d418ec9df6670ef93c2c7807f2431` |
| `SELECTION_RULE_VERSION` | `2.0_AUDITED_RECONCILED` |

---

## 6. Batch-Blinded Leave-One-Street-Face-Out (LOFO) Protocol

To prevent any human or algorithmic leakage across folds:

```
[1. FREEZE INFERENCE MODEL] -> Fixed directed-graph neighbor scoring
          │
[2. GENERATE ALL FOLDS] -> For face i in 1..N:
          │                  - Purge all face i parcels from training corpus
          │                  - Blind prediction of ranked QQQ candidates
          │
[3. WRITE & FREEZE PREDICTIONS] -> Save microarea_b_lofo_predictions.json
          │                        Compute LOFO_PREDICTIONS_SHA256
          │
[4. UNBLIND GROUND TRUTH] -> Record UNBLIND_TIMESTAMP
          │                  Load true QQQs for held-out faces
          │
[5. SINGLE-PASS EVALUATION] -> Calculate LOFO_N, Top-1, Top-3, Top-5, MRR, Median Rank
```

---

## 7. Execution Deliverables

1. `microarea_b_selection.json`
2. `microarea_b_existing_evidence_inventory.json`
3. `microarea_b_face_parcel_matrix.json` (denominated strictly by distinct DSQLLL)
4. `microarea_b_topology_metrics.json` ($H(\text{Block})$, $H(\text{Face})$, Purity, $\Delta$)
5. `microarea_b_lofo_results.json` (batch-blinded protocol)
6. `cross_microarea_comparison.json` (Microarea A vs Microarea B)
7. `microarea_b_cadastral_map.png`
8. `brain/address_finder/reports/PHASE_2.3X3_CROSS_MICROAREA_REPLICATION.md`
9. `brain/address_finder/LATEST_PHASE_REPORT.md`
10. `brain/address_finder/LATEST_PHASE_RESULTS.json`
11. `walkthrough.md`

---

## 8. Termination Condition

This phase strictly concludes with:
```
STOP_FOR_HUMAN_PLAN_REVIEW
```
No code execution will occur until explicit user review and approval of this revised plan.
