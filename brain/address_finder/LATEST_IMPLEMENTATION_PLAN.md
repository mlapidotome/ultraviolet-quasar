# Implementation Plan — Phase Address Finder 2.3X0: Dense Cadastral Micro-Area Discovery / Offline Audit

## Goal Description
Perform an exhaustive offline discovery and audit of all existing historical cadastral data across the workspace and desktop archives to determine if one or more contiguous micro-areas of Taubaté (4–8 physical road blocks) already have sufficient density of real BC anchors (especially open-street house lots across multiple streets and faces) to serve as an empirical laboratory for studying the physical-to-cadastral topology:
$$\text{D.S} \longrightarrow \text{QQQ} \longrightarrow \text{LLL} \longrightarrow \text{SSS} \longrightarrow \text{Endereço Físico}$$

**Strict Execution Constraints:**
- 100% Offline execution — zero external municipal queries, zero CAPTCHAs, zero robot execution against external systems.
- Zero hypothetical structural BC generation.
- Zero Facade Checker / Google Street View usage.
- Strict preservation of prior phase outputs and frozen datasets.
- Use the frozen road network snapshot: `road_network_taubate.json` (SHA-256: `a3ae551bd1bbff73a960eb5b15bc770dfa6ae01665974b5165c0b8043fb832ab`).

---

## User Review Required

> [!IMPORTANT]
> **Separation of Open Street vs Condominium Units:** Condominiums provide valid cadastral evidence for $D.S.QQQ.LLL$, but their hundreds of apartment sub-lots ($SSS$) can artificially distort spatial density metrics. The discovery engine strictly computes both raw BC counts and collapsed `UNIQUE_DSQLLL_COUNT`, explicitly prioritizing micro-areas where multiple distinct open-street houses/lots and multiple streets have known BCs.

> [!NOTE]
> **Physical Road Blocks vs Cadastral Quadras:** In this phase, road-enclosed polygons extracted from OpenStreetMap are strictly termed `PHYSICAL_ROAD_BLOCK` and are not assumed to be equal to municipal cadastral quadras ($QQQ$). The relationship between physical blocks and cadastral quadras is an empirical research question to be answered using the discovered data.

---

## Proposed Pipeline & Methodology

### 1. Complete Historical Inventory & Provenance Extraction
Scan and audit all historical sources across the workspace and Desktop:
- `historical_real_bc_index.json` (634 BCs across 29 streets)
- `ext_anchors_dataset.json` (109 anchors with full street, neighborhood, district, sector, quadra)
- `street_dsq_lll_corpus.json` (102 units with street and DSQLLL linkages)
- `condominium_bc_cluster_index.json` & `condominium_bc_address_anchors.json` (12,159 clusters from 359 condominiums)
- Real municipal certidão dumps: `achados_claudino.txt` and `resultado_quadra_206.txt` (containing official municipal certidões with full BC, street, house number, contributor, and cadastral lot)
- Building unit caches: `unidades_monet.json`, `unidades_tangara_venal.json`, `tangara_final_consolidado.json`
- Desktop archives: `C:\Users\Marcel\OneDrive\Desktop\Imobiliaria\Processados` (688 spreadsheets with ~75,541 raw BCs)

Each record will be standardized with:
- `SOURCE_FILE`, `SOURCE_TYPE`
- `BC`, `DS`, `QQQ`, `LLL`, `SSS`, `DSQ`, `DSQLLL`
- `STREET`, `HOUSE_NUMBER`, `NEIGHBORHOOD`, `CONDOMINIUM`
- `ADDRESS_CONFIDENCE` (`EXACT_PROPERTY_LOCATION`, `STREET_LEVEL_LOCATION`, `NEIGHBORHOOD_LEVEL_LOCATION`, `UNLOCATED`)
- `DOCUMENTARY_CONFIDENCE` (`OFFICIAL_CERTIDAO`, `MUNICIPAL_TAX_RECORD`, `CONDO_REGISTRY`, `CRM_INFERRED`)

### 2. Provenance Classification (Real vs Hypothetical)
Classify each unique BC into:
- `OBSERVED_DOCUMENTARY_BC`: Sourced from official municipal certidões or tax records.
- `OBSERVED_HISTORICAL_ROBOT_BC`: Sourced from verified historical municipal robot queries.
- `OBSERVED_CONDO_BC`: Sourced from condominium IPTU registries / unit spreadsheets.
- `STRUCTURAL_HYPOTHETICAL_BC`: Artificially generated combinatorial tuples (strictly excluded).
- `UNKNOWN_PROVENANCE`: BCs with untraceable lineage (excluded from anchor analysis).

### 3. Street Geolocation & Physical Road Block Construction
- Normalize street names using the established street normalizer against the frozen `road_network_taubate.json` (SHA-256 verified).
- Extract planar road-bounded polygons (`PHYSICAL_ROAD_BLOCK`) from the 7,411 OSM ways in `osm_taubate_roads_raw.json` via planar polygonization (`shapely.ops.polygonize`).
- For each `PHYSICAL_ROAD_BLOCK`, determine its bounding box, centroid, perimeter road segments, and build an adjacency graph.

### 4. Dense Micro-Area Clustering (4–8 Contiguous Physical Blocks)
- Search the block adjacency graph for connected subgraphs of size $K \in [4, 8]$.
- Map geolocated BC anchors to physical blocks via their associated perimeter streets and exact numbers.
- Calculate key audit metrics for every candidate region:
  - `UNIQUE_REAL_BC_COUNT`
  - `UNIQUE_STREET_COUNT`
  - `UNIQUE_DSQ_COUNT`
  - `UNIQUE_DSQLLL_COUNT` (collapsing apartment SSS)
  - `BC_WITH_FULL_ADDRESS_COUNT`
  - `BC_WITH_STREET_ONLY_COUNT`
  - `BC_PER_PHYSICAL_BLOCK`
  - `STREETS_WITH_BC_ANCHOR`
  - `PERCENT_STREETS_WITH_ANCHOR`
  - `CONDO_BC_COUNT` vs `OPEN_STREET_BC_COUNT`
  - `ADDRESSABLE_RECORD_COUNT`

### 5. Multi-Criteria Ranking & Selection
Rank micro-areas to produce the **TOP 10** candidates based on:
- High number of open-street houses/lots (`OPEN_STREET_BC_COUNT`)
- High diversity of distinct `DSQLLL` and `DSQ`
- High fraction of perimeter/internal streets with known anchors
- Multiple streets with multiple BCs (cross-street / opposite-face coverage)
- Heavy penalty for single-condominium SSS saturation without street diversity

### 6. Offline Cartographic Visualizations (TOP 5)
Generate high-resolution PNG maps for the top 5 regions:
- `dense_microarea_map_01.png` ... `dense_microarea_map_05.png`
- Displaying physical road blocks, road centerlines, street names, BC anchor locations (differentiating exact points vs street-level evidence), and color-coded cadastral quadras ($QQQ$) and sectors ($DS$).

### 7. Laboratory Feasibility Evaluation & Classification
Answer the core research question:
- Does any candidate region possess sufficient density, street variety, and open-street lot anchors to serve as a ground-truth laboratory for testing:
  1. $\text{PHYSICAL\_ROAD\_BLOCK} \leftrightarrow \text{QQQ}$ mapping?
  2. $\text{STREET\_FACE} \leftrightarrow \text{LLL}$ ordering?
- Assign final status: `DENSE_MICROAREA_ALREADY_AVAILABLE` | `DENSE_MICROAREA_PARTIAL` | `DENSE_MICROAREA_NOT_AVAILABLE`.

---

## Proposed Deliverables

| Deliverable File | Description |
| :--- | :--- |
| `dense_microarea_source_inventory.json` | Detailed inventory of all auditable historical files and records |
| `dense_microarea_bc_index.json` | Deduplicated real BC index with provenance, addresses, and confidence |
| `physical_road_blocks.json` | Geometry and metadata for all extracted physical road blocks |
| `dense_microarea_candidates.json` | All evaluated contiguous 4–8 block candidate clusters with metrics |
| `dense_microarea_top10.json` | Ranked top 10 candidate micro-areas |
| `dense_microarea_map_01.png` to `05.png` | Offline cartographic maps for the Top 5 micro-areas |
| `PHASE_2.3X0_DENSE_MICROAREA_DISCOVERY.md` | Comprehensive phase audit report |
| `brain/address_finder/LATEST_PHASE_REPORT.md` | Updated latest phase report for GitHub repository |
| `brain/address_finder/LATEST_PHASE_RESULTS.json` | Updated machine-readable results JSON |

---

## Verification Plan

### Automated Verification
- Run SHA-256 verification on `road_network_taubate.json` and all source datasets.
- Ensure 0 `STRUCTURAL_HYPOTHETICAL_BC` instances contaminate the spatial candidate evaluation.
- Validate topological connectivity of all candidate 4–8 physical road block clusters.
- Run complete JSON schema and sanity checks on all output deliverables.

### Manual Review
- Inspect the generated PNG maps to verify clear visual readability of physical blocks, street labels, and cadastral cluster markers.
- Review the laboratory feasibility criteria to ensure objective classification without post-hoc bias.
