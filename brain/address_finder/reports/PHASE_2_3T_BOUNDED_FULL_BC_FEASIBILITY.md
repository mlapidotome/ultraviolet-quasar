# RELATÓRIO DE VIABILIDADE CADASTRAL — FASE ADDRESS FINDER 2.3T
## BOUNDED FULL-BC GENERATOR FEASIBILITY / OFFLINE

> **Status Metodológico:** CONCLUÍDO / CONGELADO  
> **Classificação Formal:** `BOUNDED_FULL_BC_GENERATOR_PARTIAL_POTENTIAL`  
> **Próxima Ação Mandatória:** `STOP_FOR_HUMAN_REVIEW`  
> **Data:** 2026-09-04  
> **Ambiente:** Execução 100% Offline e Estática (Sem CAPTCHA, sem chamadas ao portal municipal, sem emissão de certidões, sem Street View, sem Gemini visual)

---

## 1. SUMÁRIO EXECUTIVO & RESULTADOS CENTRAIS

A **Phase 2.3T** testou a viabilidade offline do gerador estrutural completo de Inscrições Imobiliárias (BCs completos) para casas unifamiliares de rua aberta:
$$\text{candidate } D.S.QQQ \longrightarrow \text{candidate } LLL \longrightarrow \text{candidate } SSS \longrightarrow \text{FULL BC}$$

O experimento foi executado utilizando exclusivamente os alvos documentais congelados da coorte Ground Truth ($N=36$) e as predições de quadras candidatas congeladas da Phase 2.2D Integrada (`integrated_ds_dsq_predictions.json`). Nenhuma requisição externa foi emitida.

```
========================================================================================
MÉTRICA DE COBERTURA E ESPAÇO DE BUSCA           ESTRATÉGIA A (060)   ESTRATÉGIA B (080)
========================================================================================
Total de Alvos Ground Truth Testados                             36                   36
True DSQ Presente no Conjunto de Entrada (2.2D)        31/36 (86,1%)        31/36 (86,1%)
True SSS Coberto (Sublote 001)                        36/36 (100,0%)       36/36 (100,0%)
TRUE FULL BC no Conjunto Gerado (E2E Recall)           28/36 (77,8%)        30/36 (83,3%)
Recall de Full BC Condicional a True DSQ Presente      28/31 (90,3%)        30/31 (96,8%)
Recall de LLL Condicional a True DSQ Presente          28/31 (90,3%)        30/31 (96,8%)
Taxa de Falha de SSS (SSS Failure Rate)                 0/36 (0,0%)          0/36 (0,0%)
ORACLE Recall de Full BC (se DSQ fosse 100%)           33/36 (91,7%)        35/36 (97,2%)
Espaço de Busca por Imóvel (Mediana de BCs)                  240 BCs              320 BCs
Espaço de Busca por Imóvel (Percentil 75)                    360 BCs              480 BCs
Espaço de Busca por Imóvel (Percentil 90)                    360 BCs              480 BCs
Espaço de Busca por Imóvel (Máximo)                          420 BCs              560 BCs
========================================================================================
```

---

## 2. CORREÇÕES INTERPRETATIVAS DA PHASE 2.3S

Em atendimento ao item 1 do protocolo regulatório da Phase 2.3T, ficam estabelecidos os seguintes preceitos metodológicos:
1. **$001..060$ e $001..080$ representam faixas de alto recall numérico para LLL**, e **NÃO** um gerador já validado operacionalmente para produção de BCs.
2. **A expressão "80 candidatos" significa 80 candidatos por quadra ($DSQ$)**, e **NÃO** 80 candidatos por imóvel. Como um imóvel recebe entre 1 e 7 quadras candidatas do pipeline topológico, o espaço de busca real por imóvel varia de 60 a 560 BCs hipotéticos.
3. **A redução observada contra $001..999$ é estritamente uma `THEORETICAL_NUMERIC_SPACE_REDUCTION`** (redução matemática no domínio de números inteiros de três dígitos), não demonstrando que todos os 1.000 lotes existem no cadastro da prefeitura.
4. **A contiguidade numérica observada em condomínios horizontais (97,8% sem gaps)** é um fenômeno de loteamentos planejados e **não deve ser generalizada cegamente para todas as quadras abertas consolidadas**.
5. **`HEAD_LOT 001..003` permanece classificado como `STREET_PROBE_UNVALIDATED`**, pois a mera existência do lote 001 na quadra não prova que ele dê testada para o logradouro procurado.

---

## 3. VALIDAÇÃO EMPÍRICA DO SUBLOTE ($SSS$) NOS 36 GROUND TRUTHS

Para todos os 36 imóveis da coorte documental de casas/lotes unifamiliares em vias públicas, extraiu-se a distribuição real do campo $SSS$:

```
+--------------------------+-------------------+----------------+--------------------------------+
| Métrica de Sublote (SSS) | Contagem Observada| Proporção Real | Wilson 95% Intervalo Confiança |
+--------------------------+-------------------+----------------+--------------------------------+
| TRUE_SSS_EQ_001          | 36 / 36           | 100,0%         | [90,4% – 100,0%]               |
| TRUE_SSS_NE_001          | 0 / 36            | 0,0%           | [0,0% – 9,6%]                  |
+--------------------------+-------------------+----------------+--------------------------------+
```

* **Distribuição Completa de $SSS$:** $\{ '001': 36 \}$. Nenhuma casa da amostra possui sublote diferente de $001$.
* **Conclusão Metodológica para Geração:** Em residências unifamiliares de rua aberta (`OPEN_STREET_HOUSE/LOT`), fixar o sublote em $SSS = 001$ possui suporte empírico documental de 100%. Não há necessidade de expandir para $SSS = 002, 003, \dots$, o que evita a multiplicação desnecessária do espaço de busca.
* Os registros estruturais gerados são estritamente rotulados como:
  $$\text{record\_class} = \text{STRUCTURAL\_HYPOTHETICAL\_BC}$$
  não sendo classificados como `OBSERVED_REAL_BC` nem presumindo existência cadastral prévia.

---

## 4. COMPARAÇÃO DAS DUAS JANELAS ESTRUTURAIS (060 vs. 080)

Testaram-se duas estratégias estruturais completas aplicadas sobre o conjunto de quadras candidatas de cada alvo:

* **Estratégia A (Janela 060):** $\text{candidate } D.S.QQQ \times LLL \in 001..060 \times SSS \in \{'001'\}$
* **Estratégia B (Janela 080):** $\text{candidate } D.S.QQQ \times LLL \in 001..080 \times SSS \in \{'001'\}$

```
+------------------------------------------------+--------------------+--------------------+
| Dimensão de Avaliação                          | Estratégia A (060) | Estratégia B (080) |
+------------------------------------------------+--------------------+--------------------+
| TRUE_DSQ_IN_INPUT_SET (Entrada Topológica)     | 31 / 36 (86,1%)    | 31 / 36 (86,1%)    |
| TRUE_LLL_IN_GENERATED_SET                      | 28 / 36 (77,8%)    | 30 / 36 (83,3%)    |
| TRUE_FULL_BC_IN_GENERATED_SET (E2E Recall)     | 28 / 36 (77,8%)    | 30 / 36 (83,3%)    |
| FULL_BC_RECALL_GIVEN_TRUE_DSQ_PRESENT          | 28 / 31 (90,3%)    | 30 / 31 (96,8%)    |
| LLL_RECALL_GIVEN_TRUE_DSQ_PRESENT              | 28 / 31 (90,3%)    | 30 / 31 (96,8%)    |
| SSS_FAILURE_RATE                               | 0 / 36 (0,0%)      | 0 / 36 (0,0%)      |
| ORACLE_TRUE_DSQ (Avaliação Pós-GT)             | 33 / 36 (91,7%)    | 35 / 36 (97,2%)    |
+------------------------------------------------+--------------------+--------------------+
```

### Diagnóstico das Falhas (Root Cause Analysis):
* **Na Janela 060 (8 alvos não alcançados):**
  * **5 falhas upstream de DSQ:** `EXT-004`, `EXT-009`, `EXT-023`, `EXT-025`, `EXT-033` (a quadra verdadeira não estava entre as candidatas da Phase 2.2D).
  * **3 falhas de janela de LLL ($LLL > 060$):**
    - `EXT-011` ($LLL = 071$, True DSQ presente)
    - `EXT-018` ($LLL = 072$, True DSQ presente)
    - `EXT-027` ($LLL = 369$, True DSQ presente)
* **Na Janela 080 (6 alvos não alcançados):**
  * **5 falhas upstream de DSQ:** `EXT-004`, `EXT-009`, `EXT-023`, `EXT-025`, `EXT-033`.
  * **1 única falha de janela de LLL ($LLL > 080$):**
    - `EXT-027` ($LLL = 369$).
  * A ampliação de 060 para 080 recuperou com sucesso os alvos `EXT-011` e `EXT-018`, elevando o recall condicional de 90,3% para **96,8%**.

---

## 5. TAMANHO REAL DO ESPAÇO DE BUSCA POR IMÓVEL

Para cada imóvel alvo, computou-se o número de quadras candidatas, de lotes hipotéticos gerados e de inscrições completas hipotéticas:

```
+-------------------+--------------------+--------------------+
| Estatística       | Janela 060 (BCs)   | Janela 080 (BCs)   |
+-------------------+--------------------+--------------------+
| Mínimo            | 60                 | 80                 |
| Mediana           | 240                | 320                |
| Percentil 75      | 360                | 480                |
| Percentil 90      | 360                | 480                |
| Máximo            | 420                | 560                |
| Média             | 243,3              | 324,4              |
+-------------------+--------------------+--------------------+
```

### Distribuição por Faixas (Buckets Operacionais):

```
+---------------+--------------------+--------------------+
| Faixa de BCs  | Janela 060         | Janela 080         |
+---------------+--------------------+--------------------+
| <= 80         | 10 alvos (27,8%)   | 10 alvos (27,8%)   |
| 81 – 160      | 3 alvos (8,3%)     | 3 alvos (8,3%)     |
| 161 – 240     | 6 alvos (16,7%)    | 3 alvos (8,3%)     |
| 241 – 320     | 2 alvos (5,6%)     | 3 alvos (8,3%)     |
| 321 – 480     | 15 alvos (41,7%)   | 15 alvos (41,7%)   |
| > 480         | 0 alvos (0,0%)     | 2 alvos (5,6%)     |
+---------------+--------------------+--------------------+
```

> [!WARNING]
> **Implicação Operacional Crítica:**  
> Embora a Janela 080 eleve o recall end-to-end de 77,8% para 83,3%, ela gera uma mediana de **320 BCs por imóvel** (com 47,3% dos imóveis ultrapassando 320 candidatos, e casos chegando a 560 candidatos).  
> Submeter 320 a 560 requisições com CAPTCHA por imóvel ao portal da prefeitura seria operacionalmente proibitivo sem uma camada intermediária de filtragem.

---

## 6. FUNIL ESTRUTURAL COMPLETO END-TO-END

O pipeline completo opera em cascata em 5 etapas sequenciais:

```
+-------------------------------------------------------------+-----------------------+-----------------------+
| Etapa do Funil                                              | Janela 060            | Janela 080            |
+-------------------------------------------------------------+-----------------------+-----------------------+
| Alvos Totais da Coorte                                      | 36 (100,0%)           | 36 (100,0%)           |
| Step 1: True DS Recuperado (Phase 2.2D Recovery)            | 35 / 36 (97,2%)       | 35 / 36 (97,2%)       |
| Step 2: True DSQ no Conjunto Candidato (Top-K Integrado)    | 31 / 36 (86,1%)       | 31 / 36 (86,1%)       |
| Step 3: True LLL dentro da Janela Bounded                   | 28 / 36 (77,8%)       | 30 / 36 (83,3%)       |
| Step 4: True SSS Coberto (Sublote 001)                      | 28 / 36 (77,8%)       | 30 / 36 (83,3%)       |
| Step 5: True FULL BC no Conjunto Estrutural Gerado          | 28 / 36 (77,8%)       | 30 / 36 (83,3%)       |
+-------------------------------------------------------------+-----------------------+-----------------------+
| ORACLE (True DSQ Fornecido a Posteriori — Análise Pós-GT)   | 33 / 36 (91,7%)       | 35 / 36 (97,2%)       |
+-------------------------------------------------------------+-----------------------+-----------------------+
```

* **Diferença entre E2E e Oracle:** A diferença entre 77,8% (E2E) e 91,7% (Oracle) na janela 060 deve-se exclusivamente aos 5 alvos perdidos na etapa de Topologia de Quadras (Phase 2.2D), demonstrando que o gargalo residual principal é topológico, e não a janela de lotes.

---

## 7. DISTINÇÃO ENTRE STRUCTURAL RECALL E OBSERVED REAL BC RECALL

Fica estritamente demarcada a diferença entre as duas métricas:
* **`STRUCTURAL_RECALL` (Medido nesta fase: 77,8% a 83,3%):** Mede a probabilidade de que a combinação numérica matemática $(D.S.QQQ.LLL.001)$ contendo o imóvel verdadeiro faça parte do conjunto gerado. **Não comprova nem exige que todos os BCs gerados existam no cadastro tributário.**
* **`OBSERVED_REAL_BC_RECALL` (Medido na Phase 2.3: 0,0%):** Mede a capacidade de recuperar o lote através de correspondência exata em uma base cadastral previamente existente.

O gerador estrutural resolveu a limitação da Phase 2.3 (saltando de 0,0% para 77,8% / 83,3% de recall estrutural), mas ao custo de introduzir um conjunto de busca hipotético com centenas de candidatos por imóvel.

---

## 8. INVENTÁRIO DE ENTREGÁVEIS GERADOS & HASHES CRIPTOGRÁFICOS

Todos os 6 arquivos de dados foram criados no diretório oficial [`facade-checker/data/address_finder_bc_anchors_v1/`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/):

| Arquivo Deliverable | Tamanho (Bytes) | SHA-256 Checksum |
| :--- | :--- | :--- |
| [`gt_36_sss_distribution.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/gt_36_sss_distribution.json) | 10.446 | `1a13ed150475dde5882d5dc126863d6b25292791dddf5d2d9570f688174766e6` |
| [`bounded_full_bc_predictions_060.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/bounded_full_bc_predictions_060.json) | 2.420.725 | `9c79ebf35ac1b2e2c7522a22f6427bb1ffc7eb91fbda2fa47fb1a53c70b056f0` |
| [`bounded_full_bc_predictions_080.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/bounded_full_bc_predictions_080.json) | 3.224.265 | `65f734ea28c15c41ea4302f60266f61a8dd32c6e56e5cfd29c73800f3fa9b615` |
| [`bounded_full_bc_evaluation.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/bounded_full_bc_evaluation.json) | 30.661 | `4bd08c1b799be333ff921b07cb8d0670191428dd9bfa051bdcb0f4b8e4a99c48` |
| [`bounded_full_bc_search_space.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/bounded_full_bc_search_space.json) | 13.476 | `b3b5eb4bee4f26ea44ef6291cda32ce7b59d03ce2244c0451f8573647db6d4fe` |
| [`address_finder_structural_funnel.json`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/facade-checker/data/address_finder_bc_anchors_v1/address_finder_structural_funnel.json) | 16.127 | `9b04df2fa1fd537085a598b2946e22495d79f0db6d022995c0a32ae435fa3756` |

---

## 9. DECISÃO METODOLÓGICA E CLASSIFICAÇÃO FORMAL

### Classificação Formal
```
BOUNDED_FULL_BC_GENERATOR_PARTIAL_POTENTIAL
```

### Justificativa Metodológica Conforme Protocolo:
1. **Recall Estrutural Alto:** O gerador estrutural atinge **77,8% (Janela 060)** e **83,3% (Janela 080)** de recall end-to-end, subindo para **90,3% e 96,8%** quando a quadra verdadeira está presente no conjunto de entrada.
2. **Espaço de Busca Operacionalmente Elevado:** Em contrapartida, o gerador produz uma mediana de **240 a 320 candidatos por imóvel**, com 41,7% dos imóveis gerando de 321 a 480 candidatos (e máximo de 560).
3. **Critério Normativo do Prompt:** Conforme estabelecido no item 8 das diretrizes:
   > *"Classificar PARTIAL_POTENTIAL se o recall for alto, mas gerar centenas de candidatos por imóvel."*
4. **Alerta de Controle:** A classificação `PARTIAL_POTENTIAL` **NÃO AUTORIZA** consultas operacionais à prefeitura. O próximo passo metodológico deverá ser desenhado para reduzir o espaço de centenas de candidatos antes de qualquer emissão de requisições.

```
==================================================
              STOP_FOR_HUMAN_REVIEW
==================================================
```
