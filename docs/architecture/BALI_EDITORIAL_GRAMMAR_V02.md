# BALI EDITORIAL GRAMMAR v0.2
## CAMADA SEMÂNTICA DE INTERPRETAÇÃO NARRATIVA DA BALI IMÓVEIS

**Versão:** 0.2  
**Data:** 2026-09-06T23:50:15.883Z  
**Autoridade Epistêmica:** BALI EDITORIAL DNA v1 (Epistemically Hardened)  
**Modo Operacional:** Fast / Dataset-First / Documentation-Only (Zero Executable Rules / Zero Media Reprocessing)  

---

## 1. OBJETIVO E POSICIONAMENTO ARQUITETURAL

A **Editorial Grammar v0.2** formaliza a camada semântica que interpreta a intenção editorial do roteiro antes da seleção de qualquer técnica visual.

$$\text{SCRIPT / SPEECH} \longrightarrow \textbf{EDITORIAL GRAMMAR} \longrightarrow \textbf{EDITORIAL NEEDS} \longrightarrow \text{TECHNIQUE CANDIDATES} \longrightarrow [\text{CREATIVE DIRECTOR}] \longrightarrow [\text{COMPOSER}]$$

> [!IMPORTANT]
> **Princípio Central:** *Grammar decides WHAT the edit needs to accomplish. Technique Library describes POSSIBLE ways to accomplish it.*  
> Nunca converter diretamente `keyword -> effect` ou `narrative_function -> mandatory technique`.

---

## 2. TAXONOMIA DE NARRATIVE FUNCTIONS (13 FUNÇÕES COMPOSICIONAIS)

Diferente de sistemas rígidos, um mesmo beat pode conter múltiplas funções narrativas simultâneas (ex: `HOOK + PAIN + PROMISE`):

| ID | Função Narrativa | Intenção Central | Efeitos no Espectador | Necessidades Editoriais Principais |
| :--- | :--- | :--- | :--- | :--- |
| `NF_HOOK` | **HOOK** | Attention capture and bounce prevention | curiosity, identification, surprise | HUMAN_CONNECTION, NOVELTY, VISUAL_PROOF |
| `NF_PAIN` | **PAIN** | Empathy and problem identification | identification, relief, trust | HUMAN_CONNECTION, EMPHASIS, ATMOSPHERE |
| `NF_PROMISE` | **PROMISE** | Hope, curiosity, and thematic proposition | curiosity, anticipation_payoff, understanding | HUMAN_CONNECTION, INFORMATION_CLARITY, NOVELTY |
| `NF_REVEAL` | **REVEAL** | Payoff of curiosity and physical grounding of the offer | anticipation_payoff, orientation, curiosity_resolution, surprise | VISUAL_PAYOFF, VISUAL_PROOF, SPATIAL_CLARITY |
| `NF_EXPLANATION` | **EXPLANATION** | Cognitive comprehension and elimination of confusion | understanding, trust, spatial_understanding | INFORMATION_CLARITY, CONTINUITY, SPATIAL_CLARITY |
| `NF_PROOF` | **PROOF** | Validation of truth and risk reduction | belief, trust, value_perception | VISUAL_PROOF, SPATIAL_CLARITY, CONTEXT |
| `NF_DEMONSTRATION` | **DEMONSTRATION** | Spatial clarity and practical visualization | spatial_understanding, desire, understanding | SPATIAL_CLARITY, VISUAL_PROOF, ATMOSPHERE |
| `NF_DESIRE` | **DESIRE** | Aspirational projection and emotional attraction | desire, anticipation_payoff, value_perception | ATMOSPHERE, AESTHETIC_BREATHING, VISUAL_PAYOFF |
| `NF_VALUE` | **VALUE** | Perceived value elevation | value_perception, belief, memorability | EMPHASIS, INFORMATION_CLARITY, CONTEXT |
| `NF_AUTHORITY` | **AUTHORITY** | Security, trust building, and credibility | trust, belief | HUMAN_CONNECTION, INFORMATION_CLARITY |
| `NF_OBJECTION` | **OBJECTION** | Friction removal and reassurance | relief, belief, trust | HUMAN_CONNECTION, INFORMATION_CLARITY, EMPHASIS |
| `NF_OFFER` | **OFFER** | Commercial proposition and accessibility framing | value_perception, urgency, action_readiness | INFORMATION_CLARITY, EMPHASIS, HUMAN_CONNECTION |
| `NF_CTA` | **CTA** | Conversion guidance and friction-free closing | action_readiness, urgency, trust | ACTION_CLARITY, HUMAN_CONNECTION |

### 2.1. Definição Formal de REVEAL
- **Conceito:** Materialização visual/narrativa da pessoa, produto, solução, cômodo ou informação que vinha sendo preparada anteriormente.
- **Efeitos Típicos:** `anticipation_payoff`, `orientation`, `curiosity_resolution`.
- **Necessidade Editorial Primária:** `VISUAL_PAYOFF`.
- **Relação Narrativa Típica:** $\text{SETUP} \longrightarrow \text{REVEAL} \longrightarrow \text{DEVELOPMENT}$.

---

## 3. TAXONOMIA DE VIEWER EFFECTS (16 EFEITOS COGNITIVOS)

Responde à pergunta: *"O que deve mudar na mente do espectador após este beat?"*

- **`curiosity`:** Desire to keep watching to discover what happens or how a promise is fulfilled.
- **`identification`:** Feeling of "this person understands my reality and speaks to me".
- **`understanding`:** Clear mental comprehension of how an offer, space, or process operates.
- **`belief`:** Cognitive acceptance that a claim is authentic, factual, and attainable.
- **`trust`:** Emotional security and confidence in the presenter, developer, or agency.
- **`desire`:** Aspirational longing to inhabit the space or own the lifestyle portrayed.
- **`surprise`:** Unexpected revelation or pleasant counter-intuitive insight.
- **`relief`:** Alleviation of financial anxiety, spatial frustration, or bureaucratic fear.
- **`urgency`:** Recognition of limited opportunity or timing advantage requiring action.
- **`value_perception`:** Recognition that the property delivers immense value relative to its cost.
- **`spatial_understanding`:** Mental 3D map of floorplan flow, room dimensions, and integration.
- **`memorability`:** Key figures, unique amenities, or emotional phrases retained in memory.
- **`action_readiness`:** Preparedness to tap the screen, send a lead, or book a site visit.
- **`anticipation_payoff`:** Pleasurable fulfillment of a setup or curiosity gap previously built.
- **`orientation`:** Clear grounding in where we are geographically, physically, and narratively.
- **`curiosity_resolution`:** Resolution of an open question posed earlier in the video.

---

## 4. TAXONOMIA DE EDITORIAL NEEDS (13 NECESSIDADES EDITORIAIS)

A camada independente entre a Gramática e a Biblioteca de Técnicas:

- **`HUMAN_CONNECTION`:** Establishing, sustaining, or re-anchoring direct personal empathy, trust, and eye contact with the viewer.
- **`VISUAL_PROOF`:** Providing authentic visual materialization of a spoken claim, physical space, or tangible spec.
- **`SPATIAL_CLARITY`:** Conveying physical layout, room proportions, flow, and three-dimensional architectural relationships.
- **`INFORMATION_CLARITY`:** Ensuring complex numbers, financing terms, locations, or rules are effortlessly understood.
- **`EMPHASIS`:** Visually and acoustically accentuating a pivotal moment, price anchor, or game-changing benefit.
- **`ATMOSPHERE`:** Building sensory mood, cozy lighting, aspirational elegance, and emotional warmth.
- **`NOVELTY`:** Introducing sensory refresh, scale shift, or visual disruption to prevent feed drop-off.
- **`CONTINUITY`:** Maintaining unbroken flow, narrative focus, and logical sequence across thoughts.
- **`CONTEXT`:** Grounding the property in its wider geographical, urban, neighborhood, or market setting.
- **`ACTION_CLARITY`:** Making the immediate next conversion step unmistakable, friction-free, and inviting.
- **`VISUAL_PAYOFF`:** Delivering the visual satisfaction of seeing what was teased or promised in earlier moments.
- **`PERFORMANCE_PRESERVATION`:** Protecting an exceptionally strong, emotive, or comedic presenter delivery without cutting prematurely.
- **`AESTHETIC_BREATHING`:** Allowing visually stunning property frames to be contemplated without rushed cutting.

---

## 5. MODELO DE ESTADO VISUAL: HOLD / EVOLVE / SWITCH

> [!TIP]
> **Regra Fundamental:** Antes de perguntar *"Para onde devemos cortar?"*, o sistema deve perguntar:  
> ***"Existe uma razão editorial suficiente para alterar o que está atualmente na tela?"***

- **`HOLD`:** A composição, mídia ou performance atual continua sendo a melhor resposta editorial. A continuidade do apresentador é um ativo narrativo, não ausência de edição.
- **`EVOLVE`:** A base visual permanece válida, mas deve evoluir de forma motivada (ex: sutil reframe, escala ou entrada de badge).
- **`SWITCH`:** Existe razão editorial forte para substituir a fonte visual principal (ex: revelação do imóvel, prova de localização ou b-roll de cômodo).

---

## 6. DIMENSÕES DE VALORAÇÃO DO BEAT

1. **`evidence_need` (LOW, MEDIUM, HIGH, CRITICAL):** Quanto a afirmação necessita de comprovação visual concreta (separada da importância editorial).
2. **`editorial_importance` (SUPPORTING, MEANINGFUL, MAJOR, HERO):** O peso memorável do momento. *HERO* não significa efeito gigante automático, mas relevância que o espectador deve reter.
3. **`emotional_mode` (curious, empathetic, conversational, confident, aspirational, urgent, reassuring, premium, playful):** Contexto emocional que atua como restrição de compatibilidade.
4. **`narrative_arc_state` (setup, tension, development, proof, reveal, payoff, transition, conversion):** Estado da história para evitar interpretações isoladas frase por frase.

---

## 7. VALIDAÇÃO REAL: CASE_01 (RESIDENCIAL JÚLIA — APRESENTADOR: MARCEL)

- **Empreendimento:** Residencial Júlia (Taubaté / SP)
- **Apresentador:** Marcel
- **Duração:** 52.68s | 10 Beats Semânticos Decupados

### Decomposição do Fluxo Editorial do CASE_01:
$$\boxed{\text{HUMAN PROMISE} \rightarrow \text{PROPERTY REVEAL} \rightarrow \text{LOCATION PROOF} \rightarrow \text{PROPERTY DEMO} \rightarrow \text{LIFESTYLE DESIRE} \rightarrow \text{CONDOMINIUM VALUE} \rightarrow \text{FINANCIAL REANCHOR} \rightarrow \text{HUMAN CTA}}$$

| Beat | Tempo | Funções Narrativas | Necessidades Editoriais | Estado | Racional Editorial |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BEAT_01** | 00:00.000 - | `HOOK+PAIN+PROMISE+OFFER` | `HUMAN_CONNECTION, INFORMATION_CLARITY, NOVELTY` | **HOLD** | Opening hook directly challenges rental inertia and presents the core proposition. Pr... |
| **BEAT_02** | 00:06.440 - | `REVEAL+PROMISE+OFFER` | `VISUAL_PAYOFF, VISUAL_PROOF, SPATIAL_CLARITY` | **SWITCH** | The verbal prompt ("Dá uma olhada") demands an immediate visual payoff of the physica... |
| **BEAT_03** | 00:09.760 - | `VALUE+PROMISE` | `CONTEXT, ATMOSPHERE` | **HOLD** | Transition beat setting up specific location landmarks. Can hold or smoothly pan.... |
| **BEAT_04** | 00:12.240 - | `PROOF+EXPLANATION+VALUE` | `CONTEXT, VISUAL_PROOF, INFORMATION_CLARITY` | **SWITCH** | Specific geographic landmark claims require tangible visual evidence (POI badges, dro... |
| **BEAT_05** | 00:19.200 - | `DEMONSTRATION+PROOF+EXPLANATION` | `SPATIAL_CLARITY, VISUAL_PROOF, INFORMATION_CLARITY` | **SWITCH** | Property-led sequence demonstrating interior layout and room dimensions. Sequential B... |
| **BEAT_06** | 00:27.440 - | `DESIRE+VALUE+PROOF` | `ATMOSPHERE, AESTHETIC_BREATHING, VISUAL_PROOF` | **SWITCH** | Key lifestyle feature (balcony with barbecue). High aesthetic and aspirational value;... |
| **BEAT_07** | 00:31.800 - | `PROOF+VALUE+AUTHORITY` | `INFORMATION_CLARITY, VISUAL_PROOF` | **EVOLVE** | Condominium amenity checklist. Sequential cutaways or badge overlays highlighting ame... |
| **BEAT_08** | 00:37.040 - | `OFFER+EXPLANATION+OBJECTION` | `INFORMATION_CLARITY, EMPHASIS, HUMAN_CONNECTION` | **SWITCH** | Pivotal commercial accessibility breakdown. Presenter reclaims screen for financial a... |
| **BEAT_09** | 00:44.680 - | `HOOK+AUTHORITY` | `HUMAN_CONNECTION, NOVELTY` | **HOLD** | Conversational human pulse check bridging the financial offer to the closing CTA.... |
| **BEAT_10** | 00:47.040 - | `CTA+OFFER` | `ACTION_CLARITY, HUMAN_CONNECTION` | **HOLD** | Direct closing call to action. Presenter maintains eye contact and gives clear instru... |

---

## 8. ANTI-PATTERNS PROIBIDOS

Fica expressamente proibida qualquer associação determinística mecânica:
- `kitchen` $\rightarrow$ corte obrigatório para cozinha.
- `price` $\rightarrow$ tipografia gigante obrigatória.
- `presenter > N segundos` $\rightarrow$ punch-in obrigatório.
- `DESIRE` $\rightarrow$ câmera lenta obrigatória.
- `CTA` $\rightarrow$ gesto de apontar para baixo obrigatório.

---