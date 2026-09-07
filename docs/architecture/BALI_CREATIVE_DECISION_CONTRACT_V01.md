# Creative Decision Contract v0.1
## Semantic Interface Contract: Creative Director → Editorial Plan

> **Epistemic Status:** Qualitative Interface Contract (`currently_binding: false`)

---

## 1. Interface Guarantees

| Creative Director Input | Editorial Plan Contract Output | Permitted Evolutions | Prohibited Anti-Patterns |
|---|---|---|---|
| **HOLD** | `source_strategy: CURRENT_STATE` / `PRESENTER`<br>`selected_techniques: []`<br>`graphic_intent: NONE` | Natural eye-contact & speech delivery | Adding unmotivated zooms, cuts, or stickers |
| **EVOLVE** | `source_strategy: [BASE_SOURCE]`<br>Preserves active base source | Subtle framing shift, card dismiss, minimal CTA badge | Changing base visual source (which requires SWITCH) |
| **SWITCH** | `source_strategy: [NEW_SOURCE]`<br>Defines target `media_intent` | Cutting to interior, location, or amenities B-roll | Mandating specific file names or arbitrary wipes |

---

## 2. Metadata Integrity

- **Ground Truth Lock:** `HUMAN_HOMOLOGATED_CASE_GROUND_TRUTH` remains inviolable.
- **Traceability:** Every `EDITORIAL_PLAN_UNIT` contains deterministic references to `decision_id`, `beat_id`, and canonical `narrative_functions`.
