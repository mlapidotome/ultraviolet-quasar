# Bali Technical Resolution Architecture v0.1
## Editorial Plan → Existing Video Engine Contract

> **Epistemic Status:** System Architecture & Capability Audit (`currently_binding: false`)  
> **Core Objective:** Formalize how the existing Video Engine physically compiles the approved Editorial Plan without altering editorial intent.

---

## 1. Architectural Pipeline

```
                    CREATIVE DECISION MODEL v0.1
           ("What should a strong Bali editor do — and why?")
                                  ↓
                       EDITORIAL PLAN v0.1
           ("What editorial result should exist on the timeline?")
                                  ↓
                   TECHNICAL RESOLUTION LAYER (Step 5C)
           ("How to resolve real assets, design tokens, and Blueprint 1.2?")
                                  │
         ┌────────────────────────┴────────────────────────┐
         ↓                                                 ↓
  PHASE 4C MATCHING                                 BALI DESIGN TOKENS
  (Property Media Pool,                             (Safe areas, TTF metrics,
   Photos with Ken Burns,                            Overlay presets)
   Videos with 1:1 Trim)                                   │
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  ↓
                        CREATIVE BLUEPRINT 1.2
                                  ↓
                         COMPOSER V3 (FFmpeg)
```

---

## 2. Core Architectural Principles

1. **Reuse, Do Not Duplicate (Phase 4C):**
   - Technical Resolution delegates candidate scoring, room-type matching, and quality ranking directly to the existing **Phase 4C Multimodal Semantic Matching** (`media_ranker.js`, `intent_extractor.js`, `editorial_continuity_engine.js`).
   - No parallel media ranking system is created.

2. **Parameter Authority (Zero Fabricated Precision):**
   - Every parameter generated during compilation must derive from a declared authority:
     - `EXISTING_COMPOSER_CONTRACT` (e.g. 1080x1920@30fps, H.264/AAC, 1:1 trim duration invariant)
     - `EXISTING_BALI_DESIGN_TOKEN` (e.g. `safe_rectangles`, `FONT_REGISTRY`)
     - `EXISTING_ASSET_SPEC` (ffprobe duration, width, height, SHA-256 file_hash)
     - `MEASURED_MEDIA_PROPERTY` (TTF font metrics via `TrueTypeFontMetrics`)
     - `FUTURE_DESIGN_DECISION` / `UNRESOLVED` (deferred parameters)

3. **Strict External Media Boundary (Beat 04):**
   - Generic drone footage is never fabricated into verified geographic proof. Where location evidence is required, the system emits an `EXTERNAL_MEDIA_REQUIREMENT` with status `UNKNOWN` until verified.

4. **Strict Design Resolution Boundary (Beat 08):**
   - The competing visual hierarchy between monthly installment (~R$2.000) and total price (R$350.000) is preserved as `UNRESOLVED` pending commercial calibration.

---

## 3. Capability Matrix Summary

| Category | Features | Engine Support Status |
|---|---|:---:|
| **Human / Presenter** | Fullscreen presenter playback, lip-sync, caption drawtext | **SUPPORTED** |
| **Property Media** | Photo with Ken Burns, Video B-roll with 1:1 trim, voice-over | **SUPPORTED** |
| **Continuity** | Multi-beat visual hold, breathing room, clean frame dismissal | **SUPPORTED** |
| **Overlays** | Location tags, single price badges, caption text wrapping | **SUPPORTED** |
| **Complex Overlays** | Multi-field structured financial card (Beat 08) | **PARTIALLY_SUPPORTED** (Design system gap) |
| **Reframing** | Dynamic presenter punch-in | **PARTIALLY_SUPPORTED** (Small extension) |
| **Location Proof** | Verified external POI / route map sourcing (Beat 04) | **REQUIRES_EXTERNAL_MEDIA** |

---

## 4. First Implementation Recommendation

For the initial implementation of the Technical Resolution compiler:
1. Implement the **Editorial Plan to Blueprint 1.2 Compiler** bridging `EDITORIAL_PLAN_UNIT` to `visual_timeline`, `captions`, and `overlays`.
2. Connect directly to **Phase 4C Multimodal Pool** for B-roll selection.
3. Use existing single-string overlay capability for location tags and price badges, while documenting structured cards as a Phase 6 enhancement.
