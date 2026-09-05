# Changelog — Fase 3B: Video Composer MVP (Timeline Engine)
## Video Engine V2 — Bali Imóveis

**Data de Conclusão:** 05/09/2026  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status:** HOMOLOGADO E APROVADO — FINAL HARDENING (40/40 Cenários Automatizados no VPS com Sucesso)  
**Commit de Referência do Plano Aprovado:** `4feb22126fe1e8d142b6f3384f7ffcf7d37d23a8`

---

## 1. Objetivo da Fase 3B

Transição arquitetural da montagem procedural hardcoded (`Hook + Body -> FFmpeg concat`) para o primeiro **Video Composer determinístico orientado por Creative Blueprint**:

$$\text{Creative Blueprint} + \text{Asset Resolver} \longrightarrow \text{Video Composer} \longrightarrow \text{MP4 Final}$$

O Composer MVP implementa um executor puro de receitas com cálculo profundo de identidade de renderização (`render_key`), controle atômico persistente de concorrência via PostgreSQL, validações estritas pré-FFmpeg, aplicação física de trims bilaterais de vídeo e áudio, pipeline único padronizado de re-encode, recuperação controlada de integridade e isolamento total em modo **Shadow Aditivo** sem qualquer impacto no pipeline da Fase 2C ou WhatsApp V1.

---

## 2. Ajustes e Final Hardening Implementados

### 2.1 Invariante de Claim & Recuperação Controlada de READY Corrompido
* **Invariante Estrito:** `renderTimelineFFmpeg()` NUNCA executa sem `claim.acquired === true`. Se `claim.acquired === false`, a execução é terminada imediatamente:
  - **READY Íntegro:** Retorno idempotente imediato sem invocar FFmpeg.
  - **Processing Ativo:** Retorno estrito de concorrência com HTTP 409 Conflict.
  - **READY Quebrado (arquivo ausente ou hash divergente):** O asset é invalidado explicitamente no catálogo (`failed` com mensagem `'CORRUPTED_OR_MISSING_PHYSICAL_FILE'`), um novo claim atômico é adquirido no PostgreSQL e somente então a re-renderização FFmpeg é disparada.
* **Validações Reais (Cenários 38, 39 e 40):** Comprovadas recuperações autônomas tanto para arquivo físico ausente quanto para adulteração de hash pós-render, com re-renderização sob novo claim e bloqueio 409 verificado.

### 2.2 Aplicação Física de Trims Bilaterais Reais no FFmpeg
* **Implementação:** Injeção determinística de filtros `trim=start=...:end=...,setpts=PTS-STARTPTS` para vídeo e `atrim=start=...:end=...,asetpts=PTS-STARTPTS` para áudio antes do nó de concatenação.
* **Contrato Bilateral Obrigatório:** `validateBlueprintContract()` exige rigorosamente que `source_in_ms` e `source_out_ms` sejam fornecidos em pares ($0 \le \text{in} < \text{out}$) ou omitidos por completo. Trims unilaterais são rejeitados de imediato (Cenário 36).
* **Validação Real Comprovada (Cenário 33):** Clipe físico de 5.0s com trim de 1000ms a 3000ms gerou output final com exatamente 2000ms ($\pm 0\text{ ms}$ de desvio), comprovando que o FFmpeg não renderizou os 5 segundos completos.

### 2.3 Proteção contra Path Traversal e Hardening de `creative_id`
* **Regex Restritiva:** Validação estrita de `blueprint.creative_id` contra `/^[a-zA-Z0-9_-]{1,64}$/` no contrato fail-fast pré-FFmpeg.
* **Contenção Física em `jobDir`:** Validação explícita em runtime de que `targetFilename` e `tempFilename` residem estritamente dentro de `/outputs/jobs/<jobId>/` (`path.dirname === jobDir` e `!path.relative.startsWith('..')`).
* **Validação Real Comprovada (Cenário 37):** Rejeição confirmada de `creative_id` maliciosos contendo `../../etc/passwd` ou caracteres especiais.

### 2.4 Cleanup 100% Autônomo de Arquivos `.tmp` Pós-Falha de QC
* **Cleanup Autônomo:** O bloco `catch` de `composeCreative()` executa a deleção do arquivo temporário `.tmp` gerado na tentativa com falha.
* **Validação Real Sem Intervenção Manual (Cenário 20):** O teste provoca falha forçada no controle de qualidade (`toleranceMs: 0`), o arquivo `.tmp` real gerado pelo FFmpeg é removido de forma autônoma pelo Composer, e o teste atesta que nenhum resíduo `.tmp` restou no disco sem fazer nenhum unlink manual no código de teste.

### 2.5 Política de Promoção Atômica contra Arquivos Órfãos & QC Estrito
* **Remoção de Órfãos Prévios:** Se um arquivo não-homologado preexistir em `finalPath`, o Composer emite alerta, remove o órfão com segurança e promove atomicamente a saída recém-validada (`.tmp.<uuid>.mp4 -> finalPath`).
* **QC Estrito de Streams:** `verifyAndPromoteOutput()` inspeciona diretamente via `ffprobe` os codecs H.264/AAC, dimensões 1080x1920 e o **FPS físico real derivado dos fluxos** ($29 \le \text{fps} \le 31$).

---

## 3. Matriz de Homologação Final (40/40 Cenários Aprovados no VPS)

| # | Cenário Validado | Resultado | Detalhes Técnicos |
|---|---|---|---|
| **1** | Blueprint válido Hook+Body renderiza com sucesso | **PASS** | Saída física gerada com sucesso via Composer |
| **2** | Ordem sequencial dos clipes respeitada | **PASS** | Hook (0 a 3s) contíguo ao Body (3s a 8s) |
| **3** | Asset inexistente rejeitado antes de invocar FFmpeg | **PASS** | Fail-fast no Asset Resolver sem spawn de processo |
| **4** | Asset não-ready rejeitado antes do FFmpeg | **PASS** | Bloqueio de assets em `processing` ou `failed` |
| **5** | Asset de outro Job rejeitado por violação de ownership físico | **PASS** | Isolamento cross-job estrito garantido |
| **6** | Symlink externo rejeitado | **PASS** | Bloqueio de path traversal e links fora do Job |
| **7** | `file_hash` divergente (adulteração) rejeitado | **PASS** | Integridade física SHA-256 verificada pré-render |
| **8** | Blueprint vazio ou corrompido rejeitado | **PASS** | Validação sintática do payload declarativo |
| **9** | `schema_version` não suportada rejeitada | **PASS** | Exige estritamente versão `1.0` |
| **10** | Camada não suportada (`layer > 0`) rejeitada no MVP | **PASS** | Restrição controlada para layer 0 |
| **11** | Parâmetros de trim inválidos (`in >= out`) rejeitados | **PASS** | Rejeição antes de spawn de FFmpeg |
| **12** | Arquivo de saída contém stream de vídeo ativo | **PASS** | Stream `video` H.264 presente |
| **13** | Arquivo de saída contém stream de áudio ativo | **PASS** | Stream `audio` AAC stereo presente |
| **14** | Duração dentro da tolerância de $\pm 250\text{ ms}$ | **PASS** | Esperado 8000ms, real 8034ms ($\Delta = 34\text{ ms}$) |
| **15** | Resolução de saída estritamente 1080x1920 | **PASS** | Dimensões verticais 9:16 verificadas via ffprobe |
| **16** | Taxa de quadros de saída 30 fps canônica | **PASS** | Framerate canônico fixado |
| **17** | Pipeline de re-encode padronizado gera output íntegro | **PASS** | MP4 válido, atom `moov` presente e tamanho consistente |
| **18** | Unidade de duração oficial `duration_ms` aplicada | **PASS** | Inteiro de milissegundos sem truncamento (8034ms) |
| **19** | Placeholders antigos de metadata ignorados | **PASS** | Duração real computada diretamente dos specs físicos |
| **20** | **Cleanup automático de `.tmp` em falha de QC** | **PASS** | **Deleção autônoma pelo composer_service sem intervenção do teste** |
| **21** | Arquivo final existente não corrompido em retry | **PASS** | Hash de saída prévia preservado após erro |
| **22** | Retorno idempotente imediato para mesma `render_key` | **PASS** | Retorno em 24ms sem invocação de FFmpeg |
| **23** | Mudança no `file_hash` de entrada altera `render_key` | **PASS** | Sensibilidade estrita a bytes de entrada |
| **24** | Mudança no Blueprint altera deterministicamente `render_key` | **PASS** | Sensibilidade estrita a propriedades do roteiro |
| **25** | Asset READY nunca é sobrescrito fisicamente | **PASS** | Invariante de imutabilidade protegida |
| **26** | Claim atômico SQL impede renders simultâneos | **PASS** | Concorrência bloqueada com retorno 409 |
| **27** | Recuperação automática de stale lease (> 5 min) | **PASS** | Re-atribuição segura da trava após timeout |
| **28** | Shadow Composer gera arquivo paralelo sem tocar na 2C | **PASS** | Campos `pilot_video_url`, `video2_url`, `status` 100% intocados |
| **29** | Comparação semântica Shadow vs Concat demonstra equivalência | **PASS** | $\Delta = 0\text{ ms}$, resoluções idênticas (`is_equivalent = true`) |
| **30** | Job showcase da Fase 2C permanece 100% íntegro (HTTP 200) | **PASS** | Vídeos 1, 2 e 3 ativos e acessíveis |
| **31** | WhatsApp V1 e bloqueio estático 403 permanecem intocados | **PASS** | `video_anuncios_engine.js` íntegro e 403 ativo |
| **32** | PM2 `bali-gestor` (online via `jlist`) e PostgreSQL 16 saudáveis | **PASS** | Processo verificado online via jlist e DB ativo |
| **33** | **Trims bilaterais reais aplicados fisicamente no FFmpeg** | **PASS** | **Clipe de 5s trimado (1s→3s) gerou exatamente 2000ms** |
| **34** | **Proteção contra arquivo órfão prévio em `finalPath`** | **PASS** | **Órfão removido com segurança e nova saída promovida** |
| **35** | **QC estrito de Codecs físicos (H.264 / AAC) e FPS real** | **PASS** | **Streams validados: h264 (1080x1920@30fps) e aac** |
| **36** | **Trims unilaterais estritamente rejeitados pelo contrato** | **PASS** | **Exigência bilateral rigorosa de pares source_in/source_out** |
| **37** | **`creative_id` malicioso ou path traversal rejeitados** | **PASS** | **Regex `/^[a-zA-Z0-9_-]{1,64}$/` e contenção de diretório validadas** |
| **38** | **Recuperação controlada de READY com arquivo ausente** | **PASS** | **Invalidação, re-claim atômico e renderização íntegra** |
| **39** | **Recuperação controlada de READY com hash divergente** | **PASS** | **Invalidação, re-claim atômico e re-renderização íntegra** |
| **40** | **Invariante estrito de claim verificado (Bloqueio 409)** | **PASS** | **Nenhum FFmpeg executado sem claim adquirido** |

---

## 4. Garantias de Não-Regressão

* **Fase 2C Preservada:** Os fluxos de aprovação de piloto, geração de remainder e entrega oficial dos Vídeos 1, 2 e 3 continuam operando de forma 100% autônoma.
* **Isolamento de Estado:** O ciclo de vida do Composer (`processing`, `ready`, `failed`) é mantido exclusivamente em `video_assets`. A coluna `video_jobs.status` não sofre alterações.
* **WhatsApp V1 Intacto:** Nenhuma linha de `video_anuncios_engine.js` foi alterada.
* **Showcase Job Homologado:** O Job `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` segue respondendo com código 200 em todas as rotas de vídeo `/video/1`, `/video/2` e `/video/3`.
