# Implementation Plan: Phase Address Finder 2.3X3 — Cross-Microarea Street-Face Replication (Feasibility Gate Edition)

## Executive Summary & Plan Status

**Status**: `PLAN_CORRECTED_WITH_FEASIBILITY_GATE`  
This revised plan establishes a formal **Pre-Execution Face-GT Feasibility Gate** as mandated by the user review:

> [!CAUTION]
> **Critical Feasibility Finding**:
> In the existing offline dataset, candidate micro-areas outside Barranco (including `CAND-MICRO-06598` and `CAND-MICRO-05186` in Jardim das Nações) have **`USABLE_FACE_DSQLLL = 0`** (all 6 distinct parcels are currently `STREET_ONLY` without door numbers, corner descriptions, or parcel confrontações).
>
> Street-only evidence **CANNOT** be assigned to a specific directed street face (`PRB-XXXX_FACE_{N,S,E,W}`) without circular reasoning or ungrounded parity assumptions. Proceeding to calculate $H(QQQ \mid \text{Face})$, $\text{Purity}(\text{Face})$, and Leave-One-Street-Face-Out (LOFO) without verifiable face-level Ground Truth would be scientifically invalid.
>
> Therefore, this plan introduces a strict, pre-registered **Pre-Execution Face-GT Feasibility Gate** before any topology analysis may take place.

---

## 1. Candidate Deduplication & Overlap Audit

The top-scoring candidates from the previous sliding-window scan are overlapping subsets of the exact same 6 DSQLLL anchors:

| Pairwise Comparison | DSQLLL Jaccard | Anchored Street Jaccard | Physical Block Jaccard | Unique DSQLLL Gain | Unique Face-GT Gain | Interpretation |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `CAND-MICRO-06598` vs `CAND-MICRO-06883` | **1.0000** | **1.0000** | 0.7500 | **0** | **0** | 100% identical parcels & streets (sliding window) |
| `CAND-MICRO-06598` vs `CAND-MICRO-06600` | **1.0000** | **1.0000** | 0.7500 | **0** | **0** | 100% identical parcels & streets (sliding window) |
| `CAND-MICRO-06883` vs `CAND-MICRO-06600` | **1.0000** | **1.0000** | 0.5556 | **0** | **0** | 100% identical parcels & streets (sliding window) |

### Deduplication Decision
These overlapping candidates are collapsed into single geographic cluster archetypes. Larger blocks are no longer rewarded unless they contribute additional independent spatial evidence.

---

## 2. Removal of Block-Bloat Reward & Revised Density Scoring

Per Review Point 5, adding physical road blocks without additional Ground Truth is penalized. The linear term $+ 5.0 \times \text{PHYSICAL\_BLOCK\_COUNT}$ has been removed.

### Pre-Analysis Face-GT Feasibility Score (V3.0)
$$\begin{aligned}
\text{Score} &= 30.0 \times \text{USABLE\_FACE\_DSQLLL} \\
&\quad + 15.0 \times \text{DISTINCT\_STREETS\_WITH\_USABLE\_FACE\_GT} \\
&\quad + 15.0 \times \text{PHYSICAL\_BLOCKS\_WITH\_USABLE\_FACE\_GT} \\
&\quad + 10.0 \times \left( \frac{\text{USABLE\_FACE\_DSQLLL}}{\text{PHYSICAL\_BLOCK\_COUNT}} \right) \\
&\quad + 5.0 \times \text{DISTINCT\_DSQLLL} \\
&\quad + 1.0 \times \text{TOTAL\_STREETS}
\end{aligned}$$

Where:
$$\text{USABLE\_FACE\_DSQLLL} = \text{EXACT\_PARCEL} + \text{EXACT\_STREET\_FACE} + \text{PROBABLE\_STREET\_FACE}$$

> [!IMPORTANT]
> **Strict Non-Circularity Constraint**:
> Parcels are classified as `EXACT_STREET_FACE` or `PROBABLE_STREET_FACE` **ONLY** via independent spatial evidence (explicit corner description, confrontation/boundary description, subdivision blueprint, or official georeferenced frontage).
> **NEVER** use $QQQ$, $LLL$ ordering, numerical adjacency, or assumed odd/even parity alone.

---

## 3. Pre-Registered Minimum Feasibility Threshold

For Microarea B to proceed to Phase 2.3X3 execution, the candidate MUST meet or exceed:

1. **`USABLE_FACE_DSQLLL >= 8`**
2. **`DOCUMENTED_STREET_FACE_COUNT >= 4`**
3. **`PHYSICAL_BLOCKS_WITH_USABLE_FACE_GT >= 3`**
4. **`DISTINCT_STREETS_WITH_USABLE_FACE_GT >= 3`**
5. **No single condominium/building may account for $\ge 50\%$ of the parcel evidence.**

*Preferred Benchmark: $\ge 12$ usable face DSQLLLs, $\ge 6$ documented faces.*

### Fail-Safe Protocol:
If no candidate microarea outside Barranco reaches this minimum threshold using existing legitimate public/offline sources:
```
CLASSIFICATION: MICROAREA_B_FACE_GT_INSUFFICIENT
STATUS: COMPLETE_WITH_FEASIBILITY_STOP
SIGNAL: STOP_FOR_HUMAN_REVIEW
```
The pipeline will **NOT** run underpowered, circular, or street-only entropy/purity/LOFO calculations.

---

## 4. Current Offline Face-GT Feasibility Table

Evaluating all candidate clusters across Taubaté outside Barranco:

| Candidate ID | Neighborhood | Blocks | Distinct DSQLLL | Exact Parcel | Exact Face | Probable Face | Street Only | Usable Face DSQLLL | Documented Faces | Usable Blocks | Usable Streets | Feasibility Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `CAND-MICRO-06598` | Jardim das Nações | 7 | 6 | 0 | 0 | 0 | 6 | **0** | 0 | 0 | 0 | **FAIL_UNDERPOWERED** |
| `CAND-MICRO-05186` | Jardim das Nações | 4 | 6 | 0 | 0 | 0 | 6 | **0** | 0 | 0 | 0 | **FAIL_UNDERPOWERED** |
| `CAND-MICRO-27948` | Vila São Geraldo | 4 | 5 | 0 | 0 | 0 | 5 | **0** | 0 | 0 | 0 | **FAIL_UNDERPOWERED** |
| `CAND-MICRO-16484` | Itaim / N. S. Graças | 4 | 1 | 0 | 0 | 1 | 0 | **1** | 1 | 1 | 1 | **FAIL_UNDERPOWERED** |
| `CAND-MICRO-02808` | Centro / Bom Conselho | 7 | 3 | 0 | 0 | 0 | 3 | **0** | 0 | 0 | 0 | **FAIL_UNDERPOWERED** |
| *CAND-MICRO-14585* *(Ref: Microarea A)* | *Barranco / Flamboyant* | *4* | *22* | *0* | *1* | *17* | *4* | ***18*** | *6* | *4* | *4* | *PASS (Baseline)* |

---

## 5. Permitted Feasibility Evidence Search (Offline Only)

Before declaring `MICROAREA_B_FACE_GT_INSUFFICIENT`, the pipeline will execute an offline scan across:
- Cached municipal certidões and Diário Oficial notices in the workspace;
- Subdivision blueprints and loteamento memorials already indexed;
- Legitimate judicial notices and public notices in the repository;
- Open OSM frontage data.

**Zero CAPTCHA, zero automated scraping of protected portals, zero rate-limit bypass.**

If this search discovers sufficient independent spatial frontages to bring a candidate microarea to $\ge 8$ usable face DSQLLLs:
- Freeze `microarea_b_selection.json`
- Proceed to Batch-Blinded LOFO and replication metrics.

If not:
- Conclude immediately with `MICROAREA_B_FACE_GT_INSUFFICIENT`.

---

## 6. Batch-Blinded Leave-One-Street-Face-Out (LOFO) Protocol

If and only if a candidate passes the feasibility gate:
1. **Freeze Inference Model**: Fixed graph-neighbor heuristic;
2. **Batch Blind Predictions**: Generate predictions for all eligible faces $1 \dots N$ simultaneously;
3. **Cryptographic Freeze**: Write `microarea_b_lofo_predictions.json` and compute `LOFO_PREDICTIONS_SHA256`;
4. **Single-Pass Unblinding**: Record `UNBLIND_TIMESTAMP` and evaluate all folds without parameter tuning;
5. **Separate Reporting**: Report `TOPOLOGY_PURITY` (intrinsic mono-cadastrality) and `OUT_OF_SAMPLE_PREDICTABILITY` (LOFO accuracy) as separate orthogonal metrics.

---

## 7. Frozen Cryptographic Manifest

| Dataset / Entity | SHA-256 Hash |
| :--- | :--- |
| `road_network_taubate.json` | `a3ae551bd1bbff73a960eb5b15bc770dfa6ae01665974b5165c0b8043fb832ab` |
| `historical_real_bc_index.json` | `ddac10be609f5cb0009b069d1a4e10fbe915a987b5a91a4ba7916e8c02175365` |
| `dense_microarea_candidates.json` | `a374bceb2628d6dd6661045ff706bad4603d418ec9df6670ef93c2c7807f2431` |
| `FEASIBILITY_GATE_RULE_VERSION` | `3.0_FEASIBILITY_GATE_STRICT` |

---

## 8. Termination Condition

This updated plan strictly concludes with:
```
STOP_FOR_HUMAN_PLAN_REVIEW
```
No code execution will take place until the human reviewer reviews and authorizes the Feasibility Gate procedure.
