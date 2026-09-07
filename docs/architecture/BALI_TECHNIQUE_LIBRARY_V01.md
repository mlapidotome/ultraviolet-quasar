# BALI TECHNIQUE LIBRARY v0.1
## CATÁLOGO SEMÂNTICO DE TÉCNICAS E CONTRATOS EDITORIAIS

**Versão:** 0.1  
**Data:** 2026-09-06T23:50:15.884Z  
**Autoridade Epistêmica:** BALI EDITORIAL DNA v1 (Epistemically Hardened)  
**Modo Operacional:** Fast / Dataset-First / Documentation-Only (Zero Executable Rules / Zero Hard Parameters)  

---

## 1. OBJETIVO E ESTRUTURA DO CONTRATO DE TÉCNICA

A **Technique Library v0.1** cataloga as formas possíveis que o sistema possui para responder às *Editorial Needs* identificadas pela Gramática.

Cada técnica possui um **Contrato Semântico** contendo:
- `technique_id`, `family`, `description`
- `serves_editorial_needs[]` e `supports_viewer_effects[]`
- `good_when[]` e `avoid_when[]`
- `compatible_emotional_modes[]` e `incompatible_or_risky_contexts[]`
- `attention_cost` (LOW, MEDIUM, HIGH) e `editorial_cost` (LOW, MEDIUM, HIGH)
- `intensity_capability` (subtle, moderate, strong)
- `currently_binding: false` (Zero parâmetros executáveis rígidos).

---

## 2. FAMÍLIAS DE TÉCNICAS CATALOGADAS (10 FAMÍLIAS)

1. **SHOT / CUT:** `hard_cut`, `j_cut`, `l_cut`, `cutaway`, `match_cut`, `visual_hold`.
2. **PRESENTER EVOLUTION:** `subtle_reframe`, `punch_in`, `punch_out`, `crop_shift`, `alternate_framing`, `presenter_plus_graphic`, `presenter_pip`, `tracked_callout`.
3. **PROPERTY MEDIA:** `property_broll`, `hero_property_shot`, `detail_shot`, `property_photo`, `drone`, `render`, `floorplan`.
4. **TYPOGRAPHY:** `captions`, `keyword_emphasis`, `hero_number`, `headline`, `lower_third`, `room_label`.
5. **INFORMATION GRAPHICS:** `callout`, `feature_badge`, `price_card`, `comparison`, `financing_breakdown`, `floorplan_highlight`.
6. **LOCATION:** `street_broll`, `location_drone`, `poi_visual`, `map`, `route_animation`, `distance_marker`, `neighborhood_lifestyle`, `establishing_shot`.
7. **MOTION:** `push_in`, `pan`, `parallax`, `ken_burns`, `speed_change`, `freeze`.
8. **COMPOSITION:** `pip`, `split_screen`, `masking`, `tracked_overlay`, `layered_composition`.
9. **TRANSITION:** `hard_cut`, `motivated_wipe`, `whip`, `zoom_transition`, `match_movement`.
10. **AUDIO:** `music_bed`, `impact`, `whoosh`, `riser`, `ambience`, `transition_sfx`, `ducking`, `silence_no_sfx`.

---

## 3. MODELO DE CUSTO EDITORIAL (EDITORIAL COST MODEL)

Baseado no princípio: **EDITORIAL IMPORTANCE GOVERNS EMPHASIS INTENSITY**.

- **LOW COST:** Recursos de baixa fricção cognitiva para comunicação contínua (ex: legendas, cortes secos, respiro sutil).
- **MEDIUM COST:** Recursos que exigem foco atencional moderado (ex: punch-in, badge de amenidade, take aéreo).
- **HIGH COST:** Recursos de alta demanda visual reservados estritamente para momentos MAJOR e HERO (ex: cartelas comerciais completas, números heróicos, composição em split).

---

## 4. BUNDLES DE TÉCNICAS CANDIDATAS (RECEITAS NÃO-VINCULANTES)

Bundles representam composições sinérgicas recomendadas (`candidate_bundle: true`, `currently_binding: false`):

### 4.IS Human Emphasis Bundle (`BUNDLE_HUMAN_EMPHASIS`)
- **Descrição:** Combines digital scale punch-in, caption keyword color emphasis, and subtle transition audio accent for major presenter statements.
- **Técnicas Integradas:** `TECH_PUNCH_IN`, `TECH_KEYWORD_EMPHASIS`, `TECH_TRANSITION_SFX`
- **Necessidades Atendidas:** `HUMAN_CONNECTION`, `EMPHASIS`, `NOVELTY`

### 4.RO Property Hero Showcase Bundle (`BUNDLE_PROPERTY_HERO`)
- **Descrição:** Combines hero wide property footage/photo, aesthetic breathing room, room identification lower-third, and slow Ken Burns push.
- **Técnicas Integradas:** `TECH_HERO_PROPERTY_SHOT`, `TECH_VISUAL_HOLD`, `TECH_ROOM_LABEL`, `TECH_KEN_BURNS`
- **Necessidades Atendidas:** `VISUAL_PAYOFF`, `VISUAL_PROOF`, `AESTHETIC_BREATHING`, `SPATIAL_CLARITY`

### 4.OF Location & Proximity Proof Bundle (`BUNDLE_LOCATION_PROOF`)
- **Descrição:** Combines drone aerial context or POI visual with landmark identification badge and geographic caption emphasis.
- **Técnicas Integradas:** `TECH_LOCATION_DRONE`, `TECH_POI_VISUAL`, `TECH_FEATURE_BADGE`, `TECH_KEYWORD_EMPHASIS`
- **Necessidades Atendidas:** `CONTEXT`, `VISUAL_PROOF`, `INFORMATION_CLARITY`

### 4.RO Financial Clarity & Hero Number Bundle (`BUNDLE_FINANCIAL_HERO`)
- **Descrição:** Combines hero price typography, commercial condition card, presenter-plus-graphic layout, and acoustic impact accent.
- **Técnicas Integradas:** `TECH_HERO_NUMBER`, `TECH_PRICE_CARD`, `TECH_PRESENTER_PLUS_GRAPHIC`, `TECH_TRANSITION_SFX`
- **Necessidades Atendidas:** `INFORMATION_CLARITY`, `EMPHASIS`, `HUMAN_CONNECTION`

### 4.FF Reveal & Curiosity Payoff Bundle (`BUNDLE_REVEAL_PAYOFF`)
- **Descrição:** Transitions cleanly from presenter setup into hero property visual payoff, holding the frame to satisfy anticipation.
- **Técnicas Integradas:** `TECH_HARD_CUT`, `TECH_HERO_PROPERTY_SHOT`, `TECH_VISUAL_HOLD`, `TECH_ROOM_LABEL`
- **Necessidades Atendidas:** `VISUAL_PAYOFF`, `SPATIAL_CLARITY`, `NOVELTY`


---

## 5. COMPATIBILIDADE FUTURA COM MÍDIAS EXTERNAS & LOCALIZAÇÃO

A biblioteca já prevê suporte semântico para:
- Takes de rua, fachada e bairro.
- Mapas estilizados e animações de trajeto até pontos de interesse (shoppings, rodovias, praias).
- Marcadores de tempo de deslocamento para validação de conveniência.

---