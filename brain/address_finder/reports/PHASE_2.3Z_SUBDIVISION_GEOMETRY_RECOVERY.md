# Phase Address Finder 2.3Z — Subdivision Blueprint & Parcel Geometry Recovery
## Final Scientific Discovery & Geometry Recovery Report

## Executive Summary

**Phase Address Finder 2.3Z** was executed to resolve the foundational spatial bottleneck identified in Phase 2.3Y:
$$\text{SUBDIVISION BLOCK + LOT} \longrightarrow \text{PHYSICAL PARCEL POSITION} \longrightarrow \text{STREET FACE}$$

The objective was to determine whether legitimate public/open sources can recover historical subdivision blueprints, approval plants, lot diagrams, or vector parcel boundaries for **Jardim das Nações**, enabling independent derivation of Street-Face Ground Truth for the primary pilot targets (`3.1.004.013` Quadra Q/13, `3.1.009.004` Quadra O/14, `3.1.014.001` Quadra A/01, and `3.3.019.006` Quadra X/03).

In strict adherence to the approved implementation plan and methodological safeguards:
1. **Pre-Phase Geometry Baseline Frozen**: `phase_2_3z_prephase_geometry_baseline.json` was established and hashed (`49794de70c39c483a9ea914ad13d3cc7b16d0219aba2402fbd74884dda723682`) before initiating geometry discovery.
2. **Comprehensive Geometry Repository Audit**: 28 public sources across municipal planning archives, judicial appraisal dossiers, open SEPLAN GIS layers, and cadastral decrees were reviewed.
3. **Subdivision Blueprint Finding**: **Zero** complete registered subdivision blueprints (*plantas de loteamento com desenho de lotes*) covering Jardim das Nações are accessible in open digital repositories. Open sources repeat textual lot and block numbers (Level 2), but omit parcel boundary geometry or full-block lot ordering diagrams.
4. **Geometry Hierarchy Evaluation (`GEOM_0` to `GEOM_5`)**: All 6 pilot targets achieved only **`GEOM_1`** (subdivision/block name confirmed textually). Zero targets reached `GEOM_3` (lot diagram), `GEOM_4` (block face position), or `GEOM_5` (parcel polygon).
5. **Strict Street-Face Derivation**: Under the non-negotiable rule that parity, door numbers, and cadastral sequences cannot place parcels, **`NEW_FACE_GT_FROM_GEOMETRY = 0`**. All pilot targets strictly remain **`STREET_ONLY`**.

```
CLASSIFICATION: SUBDIVISION_GEOMETRY_LOW_VALUE
STATUS: COMPLETE
SIGNAL: STOP_FOR_HUMAN_REVIEW
```

---

## 1. Geometry Evidence Hierarchy & Target Assessment

| Target DSQLLL | Target Tier | Subdivision Block & Lot | Pre-Phase Geom Level | Post-Phase Geom Level | Physical Geometry Recovered | Incremental Recovery? |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `3.1.004.013` | **PRIMARY** | Quadra Q, Lote 13 | `GEOM_1` | `GEOM_1` | None | **No (0)** |
| `3.1.009.004` | **PRIMARY** | Quadra O, Lote 14 | `GEOM_1` | `GEOM_1` | None | **No (0)** |
| `3.1.014.001` | **PRIMARY** | Quadra A, Lote 01 | `GEOM_1` | `GEOM_1` | None | **No (0)** |
| `3.3.019.006` | **PRIMARY** | Quadra X, Lote 03 | `GEOM_1` | `GEOM_1` | None | **No (0)** |
| `3.1.009.006` | SECONDARY | Quadra O, Lote 14 | `GEOM_1` | `GEOM_1` | None | **No (0)** |
| `3.3.019.005` | SECONDARY | Outer Continental II | `GEOM_1` | `GEOM_1` | None | **No (0)** |

### Hierarchy Definitions & Findings:
- **`GEOM_0` (No Geometry)**: Textual identifier only.
- **`GEOM_1` (Subdivision / Block Location Only)**: **All 6 targets are established here.** Public gazettes and judicial notices confirm the subdivision name and block letter (`Quadra O`, `Quadra A`, `Quadra Q`, `Quadra X`).
- **`GEOM_2` (Physical Road Block Identified)**: **0 targets independently confirmed.** Rua França, Rua Argentina, and Rua Síria border multiple physical road blocks in OSM (`PRB-0326`, `PRB-0401`, `PRB-0419`, `PRB-0746`, `PRB-0748`). Disambiguating which PRB corresponds to Quadra O without an official subdivision layout plan requires assuming cadastral QQQ correspondence, which is strictly prohibited.
- **`GEOM_3` (Lot Ordering / Diagram Available)**: **0 targets.** No internal lot progression diagrams exist on the open web.
- **`GEOM_4` (Specific Lot Identifiable on Physical Block)**: **0 targets.**
- **`GEOM_5` (Parcel Polygon / Metes-and-Bounds Geometry)**: **0 targets.**

---

## 2. Geometry Source Catalog & Repository Analysis

| Source Repository | Category | Geometry Output Potential | Achieved Open Web Geometry | Archival Access Mechanism |
| :--- | :--- | :---: | :---: | :--- |
| **1º Cartório de Registro de Imóveis (CRI)** | Official Property Registry | `GEOM_5` | `GEOM_1` (Textual excerpts) | Restricted on-demand (Formal paid certidão de matrícula; not open web indexed) |
| **Prefeitura de Taubaté - SEPLAN** | Municipal Planning Archive | `GEOM_4` | `GEOM_0` (Macrozoning only) | Administrative on-demand (Processos de Aprovação via 1Doc; open maps lack parcel vectors) |
| **TJSP / Leilões Judiciais** | Judicial Appraisal Reports | `GEOM_3` | `GEOM_2` (Partial deed metes) | Event-driven public auction dossiers (Franklin, Mega, Valero) |
| **OpenStreetMap (OSM)** | Open Geospatial Vector Graph | `GEOM_2` | `GEOM_2` (Road blocks only) | Fully open vector planar graph (zero native subdivision block or lot boundaries) |

---

## 3. Digital Georeferencing & Face-GT Derivation Audit

### A. Digital Georeferencing Audit (Section 8)
- **Blueprints Discovered**: 0
- **Control Points Acquired**: 0
- **Transformation Status**: `NO_BLUEPRINT_AVAILABLE_FOR_GEOREFERENCING`
- **Integrity**: Source data preserved unchanged.

### B. Face-GT Derivation Audit (Section 7)
Per protocol rules, street-face assignment may **only** be derived if independent physical geometry reaches `GEOM_4` or `GEOM_5`.
- **`GEOMETRY_RECOVERED`**: 0 / 6
- **`FACE_DERIVED_FROM_GEOMETRY`**: 0 / 6
- **Result**: All 6 pilot targets remain strictly classified as **`STREET_ONLY`** at face resolution.

---

## 4. Phase 2.3Z Quantitative Success Metrics

| Metric Key | Value | Scientific Context |
| :--- | :---: | :--- |
| `SUBDIVISION_DOCUMENTS_REVIEWED` | **28** | Exhaustive search across gazettes, auctions, decrees, and planning portals |
| `BLUEPRINTS_FOUND` | **0** | No registered subdivision layout plants available on the open public web |
| `BLUEPRINTS_WITH_LOT_NUMBERS` | **0** | No lot arrangement drawings found |
| `PHYSICAL_BLOCKS_MAPPED` | **0** | No physical road block independently bound to subdivision block |
| `TARGET_LOTS_GEOM_3_PLUS` | **0** | 0 lots have internal block ordering diagrams |
| `TARGET_LOTS_GEOM_4_PLUS` | **0** | 0 lots positioned on a physical block face |
| `TARGET_LOTS_GEOM_5` | **0** | 0 lots have vector parcel polygons |
| `NEW_FACE_GT_FROM_GEOMETRY` | **0** | Non-circular derivation rule strictly preserved |
| `INCREMENTAL_TARGET_LOT_GEOMETRY_RECOVERY` | **0 (0.0%)** | Primary success metric |
| `PILOT_TARGETS_EVALUATED` | **6** | 4 Primary + 2 Secondary |
| `PILOT_TARGETS_REMAINING_STREET_ONLY` | **6 (100.0%)** | Zero ungrounded face upgrades |

---

## 5. Methodological Synthesis & Strategic Path Forward

1. **Why Open Web Discovery Reached Its Limit**:
   - The open digital web (Diários Oficiais, open auction portals, legislative texts, and SEPLAN interactive maps) is exceptionally effective for **Level 1 and Level 2** cadastral data (binding `BC` $\leftrightarrow$ address, door number, lot number, and subdivision block).
   - However, **physical subdivision geometry (Level 4/5)** for historical loteamentos created prior to digital municipal GIS (such as Jardim das Nações, approved in the mid-20th century) resides exclusively in **physical paper archives**:
     - The physical rolls of the 1º Cartório de Registro de Imóveis de Taubaté;
     - The physical approval dossiers of the Prefeitura Municipal de Taubaté (Divisão de Obras Particulares / SEPLAN).
2. **Replication Feasibility Confirmation**:
   - Because open web sources repeat textual identifiers without providing parcel geometry or blueprints, `INCREMENTAL_TARGET_LOT_GEOMETRY_RECOVERY` is 0, and candidate microareas in Jardim das Nações remain at `USABLE_FACE_DSQLLL = 0`.
   - In accordance with the foundational scientific directive, Phase 2.3X3 was **not** re-run.

---

## 6. Dataset Integrity Manifest

| File / Dataset | SHA-256 Hash |
| :--- | :--- |
| `phase_2_3z_prephase_geometry_baseline.json` | `49794de70c39c483a9ea914ad13d3cc7b16d0219aba2402fbd74884dda723682` |
| `subdivision_geometry_source_catalog.json` | `6f1e36eb506bdbbfda7eac32e94d8bce39ef1c6bc754b30249352f736c8a2d74` |
| `jardim_nacoes_blueprint_discovery.json` | `efb9eba2594ba02e0fb03f0eb009f2288f8d3b004cd59f1246fdc69c7c0f9eb7` |
| `jardim_nacoes_geometry_recovery.json` | `ae39401873f41d64158aa3f79e58b3eaeef93494569a1d603eb79a14f1901beb` |
| `geometry_derived_face_gt.json` | `f2031319af556a79cad0a96d41bab45755daef285f2911a51bbe1e26a5cd9440` |
| `phase_2_3z_metrics.json` | `25156c3a2d49b2be5b86f639caf8f396ec920cec6ba13c46e902f6cc3a0031e8` |

---

## 7. Protocol Classification & Termination

```
CLASSIFICATION: SUBDIVISION_GEOMETRY_LOW_VALUE
STATUS: COMPLETE
SIGNAL: STOP_FOR_HUMAN_REVIEW
```