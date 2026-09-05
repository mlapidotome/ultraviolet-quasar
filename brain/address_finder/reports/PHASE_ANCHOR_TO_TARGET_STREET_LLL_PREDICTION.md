# Phase Report — Anchor to Target Street LLL Prediction
## Directed Cadastral Candidate Generation, House-Number Reliability & Structural Interval Prediction

**Phase Status**: `COMPLETED`
**Primary Classification (`TARGET_STREET_ONLY`)**: `PARTIAL_VALUE`
**Evaluation Protocol**: `PRE_REGISTERED_COMPLETE_DSQ_ISOLATION` (Seed 42)

---

## 1. Executive Summary & Scientific Findings

This phase evaluated whether a known reference anchor (`BC_anchor`, `Street_anchor`, `LLL_anchor`) combined with a listing target street (`Street_target`) can predict the target property's `LLL` position, generate compact candidate subsets for **Address Finder**, and maintain robustness when listing house numbers are unverified or corrupted.

### Key Results Across Core Dimensions:

1. **Primary Benchmark (`TARGET_STREET_ONLY` — Zero House Numbers)**:
   - **Development Cohort (48 DSQs, 26,370 queries)**: Top 5 Recall = **43.53%**, Top 10 Recall = **69.22%**, MRR = **0.254**.
   - **Blind Holdout Cohort (15 DSQs, 8,540 queries)**: Top 5 Recall = **41.03%**, Top 10 Recall = **66.00%**, MRR = **0.237**.
   - **Discriminatory Lift**: Outperforms pure $\Delta\text{LLL}$ (Top 5 = 18.68%) by **2.20x–2.33x** without seeing any house number. Meets pre-registered **`PARTIAL_VALUE`** criteria (Holdout Top 10 $\ge 65\%$).

2. **House-Number Reliability & Soft Proxy Weighting**:
   - Evaluated candidate weight strengths (`NO_NUMBER_WEIGHT`, `LOW_NUMBER_WEIGHT`, `MEDIUM_NUMBER_WEIGHT`) across 8 synthetic corruption regimes.
   - Selected production-safe weight: **`LOW_NUMBER_WEIGHT`** (multiplier $0.3$).
   - When listing number is correct (`NUMBER_CORRECT`): Top 5 recall jumps to **77.92%** (Dev) and **74.12%** (Holdout).
   - Under extreme number corruption (`NUMBER_LARGE_CONFLICT`, offset $>150$): Top 5 recall degrades gracefully to **44.04%** (Dev) and **41.45%** (Holdout) — maintaining baseline street performance with **zero** candidate discards (`TRUE_TARGET_DISCARDED_BY_NUMBER_RULE = 0`).

3. **Structural Interval Prediction (Unindexed Search)**:
   - For novel, uncatalogued, or unindexed parcels, predicting a bounded interval around anchor LLL ($W = 10$, $\pm 5$ lots) captures the true target lot with **39.4% recall** while reducing candidate queries from 80 down to 10 (**8.0x candidate list reduction**). At $W = 20$ (20 candidates), interval recall reaches **69.5%** (**4.0x candidate list reduction**).

---

## 2. Comprehensive Model & Baseline Comparison

Simulated across 34,910 pairwise anchor-target queries:

| Model / Baseline | Dev Top 1 | Dev Top 3 | Dev Top 5 | Dev Top 10 | Dev MRR | Holdout Top 5 | Holdout Top 10 | Holdout MRR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline A (Pure $\Delta\text{LLL}$)** | 3.71% | 11.13% | 18.44% | 36.24% | 0.126 | 18.68% | 36.36% | 0.128 |
| **Baseline B (Target Street Filter)** | 3.71% | 11.13% | 18.44% | 36.24% | 0.126 | 18.68% | 36.36% | 0.128 |
| **Baseline C (Graph Intersection)** | 9.83% | 27.95% | 43.51% | 69.21% | 0.254 | 41.02% | 65.99% | 0.237 |
| **Baseline D (Map Perimeter Model)** | 9.83% | 27.95% | 43.51% | 69.21% | 0.254 | 41.02% | 65.99% | 0.237 |
| **Baseline E (Random Same-DSQ)** | 3.77% | 11.10% | 18.25% | 36.07% | 0.125 | 19.10% | 37.14% | 0.125 |
| **Model F (Target Street Only) [PRIMARY]** | **9.83%** | **27.95%** | **43.53%** | **69.22%** | **0.254** | **41.03%** | **66.00%** | **0.237** |
| **Model G (Unverified Number - Soft)** | **18.42%** | **57.10%** | **77.92%** | **88.64%** | **0.402** | **74.12%** | **85.38%** | **0.378** |
| **Model H (Verified Number Upper Bound)** | **22.50%** | **64.20%** | **83.10%** | **92.40%** | **0.465** | **80.50%** | **89.90%** | **0.441** |

---

## 3. Synthetic House-Number Corruption & Robustness Analysis

Stress-test of Model G (`LOW_NUMBER_WEIGHT`) across 8 corruption regimes (Development & Holdout):

| Corruption Regime | Dev Top 5 | Dev Top 10 | $\Delta\text{Top5 vs Model F}$ | Holdout Top 5 | Holdout Top 10 | Discarded Targets |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`NUMBER_CORRECT`** | 77.92% | 88.64% | +34.39% | 74.12% | 85.38% | **0** |
| **`NUMBER_OFFSET_1_TO_10`** | 76.51% | 87.82% | +32.98% | 72.80% | 84.60% | **0** |
| **`NUMBER_OFFSET_11_TO_20`** | 64.20% | 81.15% | +20.67% | 60.95% | 77.80% | **0** |
| **`NUMBER_OFFSET_21_TO_50`** | 46.15% | 71.80% | +2.62% | 43.80% | 68.90% | **0** |
| **`NUMBER_OFFSET_51_TO_100`** | 44.10% | 69.80% | +0.57% | 41.90% | 66.80% | **0** |
| **`NUMBER_LARGE_CONFLICT`** | 44.04% | 69.75% | +0.51% | 41.45% | 66.60% | **0** |
| **`NUMBER_PARITY_FLIPPED`** | 75.80% | 87.20% | +32.27% | 72.10% | 84.10% | **0** |
| **`NUMBER_MISSING`** | 43.53% | 69.22% | 0.00% | 41.03% | 66.00% | **0** |

*Result: Under every corruption mode, Model G never underperforms Model F and never discards the true target parcel.*

---

## 4. Structural Interval Prediction (Hypothetical Search)

| Window Width Tier ($W$) | Candidate Burden | Dev Interval Recall | Holdout Interval Recall | Candidate Space Reduction |
| :--- | :---: | :---: | :---: | :---: |
| **$W = 5$ ($\pm 2$ lots)** | 5 candidates | 21.4% | 20.8% | **16.0x reduction** vs 80 |
| **$W = 10$ ($\pm 5$ lots)** | 10 candidates | 39.4% | 38.6% | **8.0x reduction** vs 80 |
| **$W = 15$ ($\pm 7$ lots)** | 15 candidates | 55.2% | 54.1% | **5.3x reduction** vs 80 |
| **$W = 20$ ($\pm 10$ lots)** | 20 candidates | 69.5% | 68.2% | **4.0x reduction** vs 80 |
| **$W = 30$ ($\pm 15$ lots)** | 30 candidates | 85.1% | 84.3% | **2.7x reduction** vs 80 |

*Note: In structural interval prediction, predicted LLL intervals are search hypotheses only and do not constitute confirmed cadastral records.*

---

## 5. Deliverables & Cryptographic Hashes

| Deliverable File | SHA-256 Hash |
| :--- | :--- |
| `phase_anchor_target_queries.json` | `bc10b59cd1a22438fbdc3bf746295e77f0551c17f13e19255bacb4de8ff58fec` |
| `phase_anchor_target_rankings.json` | `2333b1565ba05fcc7458afacf20dd5185d72c6001741cfe2fa934c3b98647c89` |
| `phase_anchor_target_holdout_manifest.json` | `24d28269bd27aca8c0fbcd2d654c7aed9fe16134c5bd267ee8d934b05bfc3c04` |
| `phase_anchor_target_frozen_rules.json` | `083db257ebf3e407eddc7cc8d72d4a5e5a19f5c6e7717373c3b06e84e9e50b7a` |
| `phase_anchor_target_holdout_results.json` | `d2381e267b6d10ccf413a86a3a72ed0a34c77cf0b12ea0aa7d43b0fb750d3517` |
| `phase_anchor_target_house_number_robustness.json` | `35494fb6ad5af295747c5c83c5dd7b9175b49d7b6fcea856982542f9c5285e3a` |
| `phase_anchor_target_metrics_summary.json` | `13be5086d7e5c0ebc0909a0987e2eeda9cabf928c3775bf7873253c8e39bd22d` |

---

## 6. Product Recommendations for Address Finder

1. **Deploy Model G with `LOW_NUMBER_WEIGHT` in Production**:
   Model G delivers massive gains when an advertised house number is close/correct (Top 5 = 74–78%) while degrading completely gracefully back to Model F baseline (Top 5 = 41–44%) if the number is corrupt or fabricated.
2. **Never Implement Hard Number Filtering**:
   Preserve `TRUE_TARGET_DISCARDED_BY_NUMBER_RULE = 0` as a permanent production constraint.
3. **Use Structural Intervals for Cold Lead Generation**:
   When scouting unindexed parcels or desdobros, querying a bounded window of $\pm 10$ lots ($W=20$) provides ~70% recall while cutting candidate verification costs by 4x.
