# Bali Editorial Plan v0.1
## Semantic Timeline Contract Specification

> **Epistemic Status:** Qualitative Architectural Specification (`currently_binding: false`)  
> **Layer Purpose:** Translates Creative Director decisions into a semantic timeline contract without technical execution parameters.

---

## 1. Architectural Role

The **Editorial Plan** establishes a strict separation of concerns between Creative Intent and Technical Resolution:

```
                    CREATIVE DECISION MODEL v0.1
           ("What should a strong Bali editor do — and why?")
                                  ↓
                       EDITORIAL PLAN v0.1
           ("What editorial result should exist on the timeline?")
                                  ↓
                [FUTURE TECHNICAL RESOLUTION LAYER]
           ("How to resolve fonts, palettes, crops, audio ducking?")
                                  ↓
                    [FUTURE COMPOSER EXECUTION]
           ("FFmpeg / Remotion rendering commands")
```

---

## 2. Core Epistemic Safeguards

1. **Separation of Intent vs. Implementation:**
   - The Editorial Plan defines *what* visual, narrative, and informational goals must exist on the timeline.
   - It **strictly prohibits** render parameters: pixel coordinates (`x`, `y`), scales, crop percentages, exact millisecond durations, font sizes, hex color codes, or dB gains.

2. **No Re-deciding Creative Choices:**
   - The Editorial Plan faithfully implements the `state_decision` (`HOLD`, `EVOLVE`, `SWITCH`) from the Creative Decision Model.
   - If an asset is unavailable or conflicting, it marks `UNRESOLVED` or `PLAN_CONFLICT` rather than silently altering creative intent.

3. **Preserve Performance Contract (HOLD):**
   - A `HOLD` decision is a complete editorial action: `source_strategy = CURRENT_STATE`, `selected_technique_refs = []`, `graphic_intent = NONE`.

4. **Evidence Integrity Safeguard:**
   - Generic drone footage is never assumed to prove geographic proximity. Where proof is required, the plan marks `VERIFIED_EVIDENCE_REQUIRED` with `media_fitness = UNKNOWN` until formally verified.

5. **Hierarchy Neutrality:**
   - Competing visual emphases (e.g. total price vs. monthly installment in Beat 08) remain explicitly `UNRESOLVED` until downstream resolution.
