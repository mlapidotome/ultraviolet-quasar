# Implementation Plan: Phase Address Finder 2.3X1 — Dense Micro-Area Spatial Ground Truth

## Executive Summary

Phase 2.3X0 successfully audited the historical project data and discovered micro-area `CAND-MICRO-14585` (Bosque Flamboyant / Barranco) as the highest-density contiguous cluster in Taubaté, comprising 4 physical road blocks (`PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736`) with 29 real observed BCs (22 distinct DSQLLLs) across 5 cadastral quadras (`4.4.203`, `4.4.206`, `4.4.207`, `4.4.208`, `4.4.209`).

Phase 2.3X1 operationalizes this dense micro-area by resolving empirical spatial Ground Truth for each BC down to the `STREET_FACE` level, testing four fundamental hypotheses regarding urban cadastral topology:
1. **Physical Block Multi-Cadastrality**: Does a physical road block contain a single cadastral quadra ($QQQ$) or multiple $QQQs$?
2. **Cadastral Quadra Multi-Block Dispersal**: Does a $QQQ$ span across multiple physical blocks?
3. **Street Bipartition Cadastral Boundary**: Do opposite sides of a street share the same $QQQ$ or separate different $QQQs$?
4. **Intra-Face Cadastral Ordering**: Do lot identifiers ($LLL$) exhibit monotonic spatial ordering along the physical street face?

---

## User Review Required

> [!IMPORTANT]
> **Methodological Safeguards (Zero Interpolation & Offline Integrity):**
> 1. **No Spatial Interpolation**: In accordance with user guidance, door numbers will **never** be interpolated along street centerlines to invent parcel points.
> 2. **Street Face Ground Truth Threshold**: Only BCs with verified side-of-street evidence (from official municipal certidões specifying street names, corner descriptions, or odd/even parity matching opposite cadastral quadras) achieve `EXACT_STREET_FACE` confidence and enter the primary ground truth.
> 3. **Collapsing Sub-Units ($SSS$)**: Condominium units (e.g., Edifício Monet `4.4.206.001.002` through `009`) share a single physical parcel (`4.4.206.001`) and will be collapsed to 1 parcel in topological analysis, while preserving unit breakdowns in an auxiliary table.
> 4. **100% Offline Execution**: No municipal portals, CAPTCHAs, external scrapers, or network queries will be executed. All data originates from frozen files (`road_network_taubate.json`, SHA `a3ae551b...`, and official certidões).

---

## Open Questions

None. The user provided explicit parameters and guardrails:
- Micro-area: `CAND-MICRO-14585`
- 4 physical blocks: `PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736`
- 29 observed BCs across 22 DSQLLLs
- 4 mandatory matrix analyses

---

## Proposed Changes

### 1. Spatial Geometry & Street Face Extraction
Reconstruct the exact boundary geometries of the 4 physical road blocks from the frozen road network graph cycles:
- Extract directed edge segments forming the perimeter of `PRB-0733`, `PRB-0734`, `PRB-0735`, `PRB-0736`.
- Group collinear/continuous perimeter edges into distinct named `STREET_FACE` entities:
  - `FACE_ID`: e.g. `FACE-PRB0735-S` (Rua Claudino Velloso Borges, North side of street / South face of block).
  - Attributes: `physical_block_id`, `street_name`, `cardinal_direction`, `osm_way_ids`, `geometry_linestring`, `street_side` (`NORTH`, `SOUTH`, `EAST`, `WEST`, `ODD`, `EVEN`).

### 2. Cadastral Parcel Ground Truth Resolution
For each of the 29 BCs:
- Extract official certidão metadata (`achados_claudino.txt`, `resultado_quadra_206.txt`):
  - Inscription, street name, house number, lot identifier (e.g. `R1`, `R02`, `R3`, `RP/04`, `S01`, `S2`, `S6`, `T1`, `T2`, `T3`, `T8`, `UP/03`), corner mentions (`RUA ANTONIO DEL.DA VEIGA ESQUINA CLAUDINO V.BORGES`).
- Assign:
  - `PHYSICAL_ROAD_BLOCK_ID`
  - `STREET_FACE_ID`
  - `SIDE_OF_STREET`
  - `LOCATION_EVIDENCE_SOURCE` (`OFFICIAL_VALOR_VENAL_CERTIDAO`)
  - `SPATIAL_CONFIDENCE` (`EXACT_PARCEL_OR_BUILDING`, `EXACT_STREET_FACE`, `PROBABLE_STREET_FACE`, `STREET_ONLY`, `UNRESOLVED`)
  - Filter: separate `EXACT_STREET_FACE` (primary GT) from `STREET_ONLY` / unassigned.

### 3. Four Empirical Cadastral Analyses
1. **Physical Block $\longleftrightarrow$ $QQQ$ Multiplicity**:
   - For each of the 4 blocks, tabulate how many distinct cadastral quadras appear on its faces.
   - Calculate `% single-QQQ blocks` vs `% multi-QQQ blocks`.
2. **Cadastral Quadra ($QQQ$) $\longleftrightarrow$ Physical Block Multiplicity**:
   - For each $QQQ$ (`203`, `206`, `207`, `208`, `209`), count how many physical blocks it intersects.
3. **Street Bipartition (Opposing Faces) Analysis**:
   - For each street (`antonio delgado da veiga`, `claudino veloso borges`, `melchior felix correa`):
   - Compare the $QQQ$ of the odd/even or opposing faces.
   - Quantify whether streets act as cadastral boundaries or if $QQQs$ span across street centerlines.
4. **Intra-Face $LLL$ Spatial Monotonicity**:
   - For faces with multiple lots (e.g. `antonio delgado da veiga` along block `PRB-0735` / `PRB-0733` with lots `R02`, `R3`, `RP/04`, `R5`, `R6`, `RP/07`, `RP/08`, `RP/09`, `RP/10`):
   - Correlate cadastral lot order $LLL$ against physical sequence (door numbers / certidão lot sequencing) to evaluate spatial ordering monotonicity (Kendall's $\tau$ or Spearman's $\rho$).

### 4. File Deliverables

#### [NEW] [dense_microarea_spatial_gt.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_spatial_gt.json)
- Full spatial Ground Truth table for all 29 BCs and collapsed parcel entities.

#### [NEW] [dense_microarea_street_faces.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_street_faces.json)
- Definitions, coordinates, bounding streets, and associated physical blocks for all extracted street faces.

#### [NEW] [dense_microarea_block_qqq_matrix.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_block_qqq_matrix.json)
- Block $\longleftrightarrow$ QQQ and Street Side $\longleftrightarrow$ QQQ cross-tabulation matrices.

#### [NEW] [dense_microarea_lll_spatial_analysis.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_lll_spatial_analysis.json)
- Quantitative evaluation of LLL spatial monotonicity along street faces.

#### [NEW] [dense_microarea_spatial_map.png](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_spatial_map.png)
- High-resolution spatial map showing physical blocks, street faces color-coded by $QQQ$, lot sequence callouts, and street names.

#### [NEW] [PHASE_2.3X1_DENSE_SPATIAL_GT.md](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/PHASE_2.3X1_DENSE_SPATIAL_GT.md)
- Complete technical report detailing methodology, empirical results, and findings.

#### [MODIFY] [LATEST_PHASE_REPORT.md](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/brain/address_finder/LATEST_PHASE_REPORT.md)
- Pointer and executive briefing of Phase 2.3X1 for external agents (ChatGPT).

#### [MODIFY] [LATEST_PHASE_RESULTS.json](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/brain/address_finder/LATEST_PHASE_RESULTS.json)
- Structured JSON metrics of Phase 2.3X1.

#### [EXECUTE] Git Commit & Push
- Stage all new artifacts, commit with descriptive message, and push to GitHub `origin main`.

---

## Verification Plan

### Automated Tests
1. Verify SHA-256 of `road_network_taubate.json`.
2. Validate JSON structure, non-empty records, and exact counts (29 BCs, 22 DSQLLLs).
3. Validate that every entry with `EXACT_STREET_FACE` has a verified documentary source.
4. Verify matrix sums and consistency across files.
5. Verify GitHub push status via `git status` and `git log -1`.

### Manual Review
- Inspect the generated spatial map PNG to ensure street labels, block outlines, and QQQ annotations are clearly legible.
- Confirm `STOP_FOR_HUMAN_REVIEW` signal.
