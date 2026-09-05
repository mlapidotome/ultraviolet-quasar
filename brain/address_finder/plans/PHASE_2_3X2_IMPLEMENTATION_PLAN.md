# Implementation Plan: Phase Address Finder 2.3X2 — Dense Cadastral Micro-Area Completion / Street-Face Ground Truth

## Executive Summary

Phase 2.3X1 resolved an initial spatial Ground Truth for micro-area `CAND-MICRO-14585` (Bosque Flamboyant / Barranco), achieving `DENSE_SPATIAL_GT_PARTIAL_VALUE`. The critical bottleneck identified is that only **1 out of 22 distinct DSQLLLs** achieved `EXACT_STREET_FACE` confidence under the strict anti-circularity standard (no door parity assumptions).

**Phase 2.3X2** deepens and completes the empirical Ground Truth of `CAND-MICRO-14585` across its 4 physical road blocks (`PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736`) by:
1. Conducting an exhaustive **offline evidence inventory** across all historical files, logs, caches, and official certidões in the workspace without external scraping.
2. Searching permissible public and legitimate open records (Diário Oficial, municipal public edicts, approved subdivision blueprints/memorial descritivo of *Loteamento 302 - Bosque Flamboyant*, public notices) for independent spatial evidence (corner definitions, confrontation boundaries, parcel demarcations).
3. Standardizing deterministic street-face identifiers (`PRB-0735_FACE_N`, `PRB-0735_FACE_E`, `PRB-0735_FACE_S`, `PRB-0735_FACE_W`) with dual-frontage tracking for corner parcels.
4. Testing the central architectural hypothesis: **Does `STREET_FACE` significantly reduce cadastral ambiguity compared to `PHYSICAL_BLOCK`?** (Measured via conditional Shannon entropy $H(QQQ \mid \text{Face})$ vs $H(QQQ \mid \text{Block})$ and modal purity).
5. Conducting a blinded internal **holdout face experiment** to test out-of-sample transfer without circular reasoning.
6. Generating a cartographic empirical cadastral map (`dense_microarea_cadastral_map.png`) explicitly marking documented parcels without interpolating absent ones.
7. Publishing structured artifacts and syncing to GitHub `origin main`.

---

## User Review Required

> [!IMPORTANT]
> **Strict Operational Constraints Maintained in 2.3X2:**
> 1. **100% Offline & Anti-Scraping Compliance**: No CAPTCHA solving (Gemini/2Captcha), no portal automation, no rate limit bypass. If any source requires scraping protected portals, it will be cataloged as `SOURCE_NOT_AVAILABLE_FOR_THIS_PHASE`.
> 2. **Zero Hypothetical or Synthetic BC Generation**: No arithmetic sequence generation ($LLL \in 001..080$), no head-lot heuristics, no Gemini Facade Checker, no Street View candidate fishing.
> 3. **Non-Circular Spatial Assignment**: $QQQ$, $LLL$, or numerical sequences will **never** be used as evidence to locate a parcel on a street face.
> 4. **Physical Sequence Index Independence**: Rank correlation (Spearman $\rho$ / Kendall $\tau$) will only be calculated if independent subdivision blueprint geometry or documentary confrontation sequences exist. Door numbers will remain a separate exploratory metric.

---

## Open Questions

None. The user provided complete and comprehensive specifications:
- Fixed micro-area: `CAND-MICRO-14585` (`PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736`)
- Standardized street face naming: `PRB-XXXX_FACE_{N,S,E,W}`
- Quantitative metrics: Shannon entropy, modal purity, holdout experiment, coverage ratios.

---

## Proposed Changes

### Component 1: Frozen Baseline & Geometry Freezing
- Freeze geometry and boundaries of `PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736` using the existing frozen road network snapshot (`road_network_taubate.json`, SHA `a3ae551b...`).
- Formalize deterministic street face IDs:
  - `PRB-0733_FACE_N` (Rua Benedito Antônio Barbosa)
  - `PRB-0733_FACE_S` (Rua Treze)
  - `PRB-0733_FACE_W` (Rua Melchior Félix Corrêa)
  - `PRB-0733_FACE_E` (Rua Antônio Delgado da Veiga)
  - `PRB-0734_FACE_N` (Rua Benedito Antônio Barbosa)
  - `PRB-0734_FACE_S` (Rua Treze)
  - `PRB-0734_FACE_W` (Rua Antônio Delgado da Veiga)
  - `PRB-0734_FACE_E` (Rua Capitão Bernardo Sanches Pimenta)
  - `PRB-0735_FACE_N` (Rua Treze)
  - `PRB-0735_FACE_S` (Rua Claudino Veloso Borges)
  - `PRB-0735_FACE_W` (Rua Melchior Félix Corrêa)
  - `PRB-0735_FACE_E` (Rua Antônio Delgado da Veiga)
  - `PRB-0736_FACE_N` (Rua Treze)
  - `PRB-0736_FACE_S` (Rua Claudino Veloso Borges)
  - `PRB-0736_FACE_W` (Rua Antônio Delgado da Veiga)
  - `PRB-0736_FACE_E` (Rua Capitão Bernardo Sanches Pimenta)

### Component 2: Complete Offline Evidence Inventory
- Audit all workspace records relating to QQQs `203`, `206`, `207`, `208`, `209` and bordering streets (`achados_claudino.txt`, `resultado_quadra_206.txt`, `unidades_monet.json`, `street_dsq_lll_corpus.json`, historical tax records).
- Create `dense_microarea_existing_evidence_inventory.json`:
  - Fields: `bc`, `d`, `s`, `qqq`, `lll`, `sss`, `street`, `number`, `documented_address`, `source_file`, `source_type`, `source_date`, `evidence_strength`, `whether_independent_spatial_evidence_exists`.

### Component 3: Permissible Public Evidence Search
- Search legitimate public documents already cached or accessible without CAPTCHA/scraping:
  - Official Gazette (Diário Oficial de Taubaté) public decrees/edicts referencing subdivision *Bosque Flamboyant* (Loteamento 302, Quadras R, S, T, U).
  - Municipal tax roll street listings and lot confrontation descriptions.
  - If a source requires automated scraping of protected portals, record as `SOURCE_NOT_AVAILABLE_FOR_THIS_PHASE`.

### Component 4: Spatial Ground Truth Classification & Matrix Construction
- Evaluate each distinct DSQLLL for:
  - `EXACT_PARCEL`
  - `EXACT_STREET_FACE`
  - `PROBABLE_STREET_FACE`
  - `STREET_ONLY`
  - `UNRESOLVED`
- Record `PRIMARY_STREET_FACE` and `SECONDARY_STREET_FACE` (for corner lots).
- Build `dense_microarea_face_parcel_matrix.json`:
  - Cross-tabulation matrices:
    - $\text{STREET\_FACE} \longrightarrow \text{observed } QQQ$
    - $QQQ \longrightarrow \text{observed } \text{STREET\_FACE}$
    - $\text{STREET\_FACE} \longrightarrow \text{observed } LLL$
    - $QQQ \longrightarrow \text{observed } LLL$
    - $\text{PHYSICAL\_BLOCK} \longrightarrow \text{observed } QQQ$

### Component 5: Hypothesis Testing & Information Theoretic Analysis
- Calculate conditional Shannon entropy:
  $$H(QQQ \mid \text{Block}) = - \sum_{b} P(b) \sum_{q} P(q \mid b) \log_2 P(q \mid b)$$
  $$H(QQQ \mid \text{Face}) = - \sum_{f} P(f) \sum_{q} P(q \mid f) \log_2 P(q \mid f)$$
- Calculate modal purity:
  $$\text{Purity}(\text{Block}) = \sum_b P(b) \max_q P(q \mid b)$$
  $$\text{Purity}(\text{Face}) = \sum_f P(f) \max_q P(q \mid f)$$
- Quantify empirical reduction in ambiguity from Physical Block to Street Face.
- Compute $P(\text{Single } QQQ \mid \text{Street Face})$ across documented faces.
- Test street bipartition ($QQQ_{\text{side 1}} \text{ vs } QQQ_{\text{side 2}}$).
- Test corner parcel behavior (dual frontage and cadastral allocation).

### Component 6: Blinded Internal Holdout Experiment
- Designate a documented street face as holdout (e.g. `PRB-0736_FACE_W` along Rua Antônio Delgado da Veiga, East side).
- Fit structural inference rules on all remaining faces.
- Blindly predict Top-1, Top-3, Top-5 $QQQ$ candidates for the holdout face.
- Unblind holdout ground truth and report recall accuracy in `dense_microarea_holdout_results.json`.

### Component 7: Cartographic Map & Reporting
- Generate high-resolution map `dense_microarea_cadastral_map.png`:
  - Show physical blocks, street faces, parcel callouts with $QQQ$, $LLL$, and spatial confidence color coding.
  - Parcels without Ground Truth remain explicitly unmapped/unknown (no interpolation).
- Compile comprehensive markdown reports:
  - `brain/address_finder/LATEST_PHASE_REPORT.md`
  - `brain/address_finder/LATEST_PHASE_RESULTS.json`
  - `brain/address_finder/reports/PHASE_2.3X2_DENSE_SPATIAL_GT_COMPLETION.md`
- Git commit and push to GitHub `origin main`.

---

## Deliverables

#### [NEW] [dense_microarea_existing_evidence_inventory.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_existing_evidence_inventory.json)
#### [NEW] [dense_microarea_face_parcel_matrix.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_face_parcel_matrix.json)
#### [NEW] [dense_microarea_topology_metrics.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_topology_metrics.json)
#### [NEW] [dense_microarea_holdout_results.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_holdout_results.json)
#### [NEW] [dense_microarea_cadastral_map.png](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_cadastral_map.png)
#### [NEW] [PHASE_2.3X2_DENSE_SPATIAL_GT_COMPLETION.md](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/brain/address_finder/reports/PHASE_2.3X2_DENSE_SPATIAL_GT_COMPLETION.md)
#### [MODIFY] [LATEST_PHASE_REPORT.md](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/brain/address_finder/LATEST_PHASE_REPORT.md)
#### [MODIFY] [LATEST_PHASE_RESULTS.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/brain/address_finder/LATEST_PHASE_RESULTS.json)

---

## Verification Plan

### Automated Tests
1. Verify SHA-256 of `road_network_taubate.json` (`a3ae551b...`).
2. Verify that every inventory entry contains required schema fields.
3. Verify that mathematical properties hold: $H(QQQ \mid \text{Face}) \le H(QQQ \mid \text{Block})$, purity $\in [0, 1]$.
4. Validate that holdout experiment evaluation was conducted strictly prior to ground truth comparison.
5. Check JSON formatting, integrity, and cross-file counts.
6. Verify Git status and remote synchronization via `git log -1`.

### Manual Review
- Visually inspect `dense_microarea_cadastral_map.png` to confirm face labels, parcel pins, QQQ coloring, and absence of synthetic interpolations.
- Conclude strictly with `STOP_FOR_HUMAN_REVIEW`.
