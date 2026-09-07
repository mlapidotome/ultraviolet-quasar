# Bali Creative Decision Model v0.1 (CDM)
## Semantic Decision Architecture & Epistemic Specification

> **Epistemic Status:** Qualitative Architectural Model (`currently_binding: false`)  
> **Purpose:** Formalize the semantic reasoning between Editorial Needs and Technique Selection.

---

## 1. Core Architecture Overview

The Creative Decision Model (CDM) sits between **Editorial Needs** (derived from script/speech) and the **Technique Library**. It formalizes the qualitative decision-making process of an experienced real estate video editor.

```
                      SCRIPT / SPEECH (Raw Spoken Text & Timestamps)
                                      ↓
                      EDITORIAL GRAMMAR v0.2 (Beat Taxonomy)
                                      ↓
                     EDITORIAL NEEDS (Clarity, Proof, Breathing, etc.)
                                      ↓
            ┌────────────────────────────────────────────────────────┐
            │             CREATIVE DECISION MODEL v0.1               │
            │                                                        │
            │  1. Beat Interpretation        8. State Decision       │
            │  2. Narrative Arc Context         (HOLD/EVOLVE/SWITCH) │
            │  3. Editorial Memory           9. Candidate Generation │
            │  4. Need Prioritization       10. Attention/Cost Check │
            │  5. Visual Debt / Payoff      11. Selection & Altern.  │
            │  6. Current Visual State      12. Rejection Rationale  │
            │  7. Media Fitness Analysis    13. Confidence & Uncert. │
            └────────────────────────────────────────────────────────┘
                                      ↓
                    TECHNIQUE LIBRARY v0.1 (Selected Combinations)
                                      ↓
                     [FUTURE EXECUTION / COMPOSER ENGINE]
```

---

## 2. Key Epistemic Principles

1. **Contextual Need Prioritization:**
   - Need prioritization is dynamic and situational.
   - **Zero Universal Precedence:** No category (e.g. comprehension) automatically trumps another without evaluating the specific narrative moment.

2. **Visual Debt as Narrative Expectation:**
   - Visual debt represents open viewer curiosity from verbal descriptions.
   - It heightens the relevance of visual payoff, but **does not mandate** an immediate cut, specific technique, or rigid timestamp. Payoff can occur across states or within presenter delivery.

3. **Qualitative Editorial Memory:**
   - Tracks recent cut density, visual activity, technique history, and stimulus intensity.
   - **Zero Fixed Time Windows:** Avoids arbitrary quotas or predetermined duration limits.

4. **Opportunity Gain vs. Disruption Cost:**
   - Asset availability does not justify a cut. Every state switch carries cognitive disorientation cost and must be justified by clear semantic gain.

5. **Preserve Performance as First-Class Action:**
   - A `HOLD` decision with zero technique intervention (`selected_techniques: []`) is a deliberate, positive editorial choice to preserve human rapport and breathing room.

6. **Ground Truth Provenance Safeguard:**
   - Case ground truth is locked to human-homologated transcripts (`HUMAN_HOMOLOGATED_CASE_GROUND_TRUTH`).
   - Case content must never be silently replaced by similarly named media or reference datasets.
