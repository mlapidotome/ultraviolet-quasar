# Phase Address Finder 2.3X3 — Cross-Microarea Street-Face Replication
## Feasibility Gate Audit & Pre-Registered Execution Stop Report

## Executive Summary

Phase 2.3X3 was designed to test whether the strong local street-face cadastral homogeneity observed in Phase 2.3X2 ($H(QQQ \mid \text{Face}) = 0.0000$ bits, $\Delta \text{Entropy} = -0.6713$ bits) replicates in a second urban micro-area (**Microarea B**) outside Barranco / Bosque Flamboyant.

In accordance with the approved **Feasibility Gate Edition** of the implementation plan, a rigorous **Pre-Execution Face-GT Feasibility Audit** was conducted across all candidate microareas in Taubaté before any topology calculations were performed.

### Definitive Feasibility Audit Result:
- In the entire offline repository of Taubaté outside Barranco, **zero** candidate micro-areas meet the pre-registered minimum feasibility threshold of **$\ge 8$ usable face parcels**.
- Specifically, the highest-ranking candidate clusters outside Barranco (Jardim das Nações `CAND-MICRO-06598` / `CAND-MICRO-05186` and Vila São Geraldo `CAND-MICRO-27948`) have **`USABLE_FACE_DSQLLL = 0`** (all distinct parcels are currently classified as `STREET_ONLY` without door numbers, corner certidões, or parcel confrontações).
- In accordance with the pre-registered scientific fail-safe protocol, execution of entropy, purity, and Leave-One-Street-Face-Out (LOFO) calculations was **halted immediately** to prevent ungrounded or circular spatial imputation.

```
CLASSIFICATION: MICROAREA_B_FACE_GT_INSUFFICIENT
STATUS: COMPLETE_WITH_FEASIBILITY_STOP
SIGNAL: STOP_FOR_HUMAN_REVIEW
```

---

## 1. Feasibility Gate Summary Table

| Metric Key | Pre-Registered Minimum Threshold | Highest Candidate Outside Barranco (`CAND-MICRO-06598`) | Reference Baseline (Microarea A: `CAND-MICRO-14585`) | Feasibility Outcome |
| :--- | :---: | :---: | :---: | :---: |
| `USABLE_FACE_DSQLLL` | **$\ge 8$** | **0** | **18** | **FAIL (Underpowered)** |
| `DOCUMENTED_STREET_FACE_COUNT` | **$\ge 4$** | **0** | **6** | **FAIL (No Face Frontages)** |
| `PHYSICAL_BLOCKS_WITH_USABLE_FACE_GT`| **$\ge 3$** | **0** | **4** | **FAIL (No Face Assignment)** |
| `DISTINCT_STREETS_WITH_USABLE_FACE_GT`| **$\ge 3$** | **0** | **4** | **FAIL (No Street Frontages)** |
| `MAX_SINGLE_CONDO_FRACTION` | **$< 0.50$** | **0.00** | **0.05** | **PASS (No Condo Distortion)** |
| `DISTINCT_DSQLLL` | — | **6** | **22** | Secondary |
| `STREET_ONLY_COUNT` | — | **6 (100%)** | **4 (18.2%)** | Unresolvable to Face |
| **GATE STATUS** | **MUST MEET ALL 5** | **FAIL (0 of 4 Spatial Criteria Met)** | **PASS** | **EXECUTION HALTED** |

---

## 2. Top-3 Candidate Deduplication & Overlap Audit

Pairwise Jaccard analysis confirms that the top-scoring candidate microareas in Jardim das Nações are overlapping sliding windows of the exact same 6 DSQLLL anchors:

| Pairwise Candidate Comparison | DSQLLL Jaccard | Anchored Street Jaccard | Physical Block Jaccard | Unique DSQLLL Gain | Unique Face-GT Gain | Audit Finding |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `CAND-MICRO-06598` vs `CAND-MICRO-06883` | **1.0000** | **1.0000** | 0.7500 | **0** | **0** | 100% redundant evidence (sliding window) |
| `CAND-MICRO-06598` vs `CAND-MICRO-06600` | **1.0000** | **1.0000** | 0.7500 | **0** | **0** | 100% redundant evidence (sliding window) |
| `CAND-MICRO-06883` vs `CAND-MICRO-06600` | **1.0000** | **1.0000** | 0.5556 | **0** | **0** | 100% redundant evidence (sliding window) |

---

## 3. Detailed Audit of the 6 Candidate DSQLLLs in Jardim das Nações

| DSQLLL | Cadastral Quadra ($QQQ$) | Cadastral Lote ($LLL$) | Documented Street | House Number | Spatial Confidence Level | Primary Source ID & Evidence Type |
| :--- | :---: | :---: | :--- | :---: | :---: | :--- |
| `3.1.004.013` | 004 | 013 | Rua Argentina | *None* | `STREET_ONLY` | `ANCHOR-EXT-035-04` (Public Document) |
| `3.1.009.004` | 009 | 004 | Rua França | *None* | `STREET_ONLY` | `ANCHOR-010` (Public Address Record) |
| `3.1.009.006` | 009 | 006 | Rua França | *None* | `STREET_ONLY` | `ANCHOR-EXT-010-03` (Public Document) |
| `3.1.014.001` | 014 | 001 | Rua França | *None* | `STREET_ONLY` | `ANCHOR-011` (Public Address Record) |
| `3.3.019.005` | 019 | 005 | Rua Síria | *None* | `STREET_ONLY` | `ANCHOR-EXT-004-02` (Public Document) |
| `3.3.019.006` | 019 | 006 | Rua Síria | *None* | `STREET_ONLY` | `ANCHOR-012` (Public Address Record) |

> [!NOTE]
> **Audit of Excluded Condominium Record**:
> Record `4.5.102.004` (272 apartment units in `cadastros_jatoba.xlsx`, Condomínio Jatobá) was audited and excluded because it is listed under Sector 4 / Subsetor 5 (`4.5.102`) along a major avenue without a house number, lacking independent spatial evidence placing it inside the Sector 3 blocks of Jardim das Nações.

---

## 4. Cross-Microarea Comparison: Microarea A vs Microarea B Candidates

| Metric Key | Microarea A (`CAND-MICRO-14585`) | Microarea B Candidate (`CAND-MICRO-06598`) | Comparative Scientific Assessment |
| :--- | :---: | :---: | :--- |
| **Neighborhood** | Barranco / Bosque Flamboyant | Jardim das Nações / Independência | Geographically separate urban sectors |
| **Physical Road Blocks** | 4 | 7 | High-quality OSM geometry in both |
| **Distinct DSQLLLs (Parcels)** | **22** | **6** | Microarea A has 3.7x higher parcel density |
| **Exact Parcel Count** | 0 | 0 | No independent boundary shapefiles |
| **Exact Street Face Count** | 1 (4.5%) | 0 (0.0%) | Microarea A has Edifício Monet corner anchor |
| **Probable Street Face Count** | 17 (77.3%) | 0 (0.0%) | Microarea A has certidões with lot IDs & door nums |
| **Street-Only Count** | 4 (18.2%) | 6 (100.0%) | All Microarea B parcels lack door numbers |
| **Usable Face DSQLLL Count** | **18 (81.8%)** | **0 (0.0%)** | **Pre-registered minimum threshold ($\ge 8$) failed** |
| **Documented Street Faces** | 6 | 0 | Infeasible to test street-face purity |
| **$H(QQQ \mid \text{Block})$** | **0.6713 bits** | *Not Evaluated* | Prevented circular ungrounded imputation |
| **$H(QQQ \mid \text{Face})$** | **0.0000 bits** | *Not Evaluated* | Prevented circular ungrounded imputation |
| **$\Delta \text{Entropy}$** | **-0.6713 bits** | *Not Evaluated* | Prevented circular ungrounded imputation |
| **Purity(Face)** | **100.00%** | *Not Evaluated* | Prevented circular ungrounded imputation |
| **LOFO Prediction Accuracy** | Top-1: 0% / Top-3: 100% | *Not Evaluated* | Prevented circular ungrounded imputation |
| **Scientific Determination** | **Empirical Signal Observed** | **Underpowered Feasibility Stop** | **Halt execution to preserve methodology** |

---

## 5. Dataset Hashes & Integrity Manifest

| File / Dataset | SHA-256 Hash |
| :--- | :--- |
| `road_network_taubate.json` | `a3ae551bd1bbff73a960eb5b15bc770dfa6ae01665974b5165c0b8043fb832ab` |
| `historical_real_bc_index.json` | `ddac10be609f5cb0009b069d1a4e10fbe915a987b5a91a4ba7916e8c02175365` |
| `dense_microarea_candidates.json` | `a374bceb2628d6dd6661045ff706bad4603d418ec9df6670ef93c2c7807f2431` |
| `microarea_b_selection.json` | `2b1b55860098ddd54a70df399ef7531ad6e07cbbba77c695798841b365a98d98` |
| `microarea_b_existing_evidence_inventory.json` | `b5bb467eb09ca694204c9226da8a0746b8381770b76974aa79897c21cf3428b1` |
| `microarea_b_face_gt_feasibility_matrix.json` | `bdc155557c0186fa2384a66721087e056400a21d7a653208320f0b9a9efef7d4` |
| `cross_microarea_comparison.json` | `bbbeae2f53af42394f9dbe14274f96e6617596d6d9430c5f1819d1dbdee4a4f2` |
| `microarea_b_cadastral_map.png` | `3ff91b0877d564908d45215477176adde83d107adb772b7e1e4702aeada22b36` |

---

## 6. Phase Classification & Protocol Termination

```
CLASSIFICATION: MICROAREA_B_FACE_GT_INSUFFICIENT
STATUS: COMPLETE_WITH_FEASIBILITY_STOP
SIGNAL: STOP_FOR_HUMAN_REVIEW
```