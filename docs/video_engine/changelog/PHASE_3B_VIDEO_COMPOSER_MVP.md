# Changelog — Fase 3B: Video Composer MVP (Timeline Engine)
## Video Engine V2 — Bali Imóveis

**Data de Conclusão:** 05/09/2026  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status:** HOMOLOGADO E APROVADO PÓS-REVIEW (35/35 Cenários Automatizados no VPS com Sucesso)  
**Commit de Referência do Plano Aprovado:** `4feb22126fe1e8d142b6f3384f7ffcf7d37d23a8`

---

## 1. Objetivo da Fase 3B

Transição arquitetural da montagem procedural hardcoded (`Hook + Body -> FFmpeg concat`) para o primeiro **Video Composer determinístico orientado por Creative Blueprint**:

$$\text{Creative Blueprint} + \text{Asset Resolver} \longrightarrow \text{Video Composer} \longrightarrow \text{MP4 Final}$$

O Composer MVP implementa um executor puro de receitas com cálculo profundo de identidade de renderização (`render_key`), controle atômico persistente de concorrência via PostgreSQL, validações estritas pré-FFmpeg, aplicação física de trims de vídeo e áudio, pipeline único padronizado de re-encode e isolamento total em modo **Shadow Aditivo** sem qualquer impacto no pipeline da Fase 2C ou WhatsApp V1.

---

## 2. Ajustes e Fixes Pós-Review Implementados

### 2.1 FIX 1 — Aplicação Física de Trims Reais no FFmpeg
* **Implementação:** Desenvolvida a injeção determinística de filtros `trim=start=...:end=...,setpts=PTS-STARTPTS` para o stream de vídeo e `atrim=start=...:end=...,asetpts=PTS-STARTPTS` para o stream de áudio antes do nó de concatenação.
* **Comportamento sem Trims:** O clipe é consumido em 100% de sua duração física com normalização de timestamps (`setpts=PTS-STARTPTS` / `asetpts=PTS-STARTPTS`).
* **Comportamento com Trims:** Início e término são rigorosamente sincronizados entre áudio e vídeo nos limites especificados por `source_in_ms` e `source_out_ms`.
* **Validação Real Comprovada (Cenário 33):** Clipe físico de 5.0s com trim de 1000ms a 3000ms gerou output final com exatamente 2000ms ($\pm 0\text{ ms}$ de desvio), comprovando que o FFmpeg não renderizou os 5 segundos completos.

### 2.2 FIX 2 — Política Conservadora de Promoção Atômica contra Arquivos Órfãos
* **Regra Rigorosa:** A simples existência física prévia de um arquivo em `finalPath` nunca é aceita como substituto da promoção legítima.
* **Comportamento Seguro:** Se o claim de renderização foi adquirido (logo, não existe registro `ready` prévio no banco) e um arquivo órfão preexistente reside em `finalPath` (ex: fruto de crash prévio antes do write no DB ou arquivo espúrio), o Composer emite um alerta explícito (`[COMPOSER WARNING]`), remove o arquivo órfão do disco (`fs.unlinkSync`) e promove atomicamente a saída temporária recém-renderizada e validada (`.tmp.<uuid>.mp4 -> finalPath`).
* **Validação Real Comprovada (Cenário 34):** Injeção intencional de arquivo órfão com bytes corrompidos em `finalPath` foi detectada, o órfão foi removido e substituído com sucesso pelo MP4 íntegro recém-validado.

### 2.3 FIX 3 — Inspeção Rigorosa de Qualidade (QC) via `ffprobe`
* **Validação Real de Streams:** O `verifyAndPromoteOutput()` inspeciona diretamente do container temporário:
  * `videoStream.codec_name === 'h264'`
  * `audioStream.codec_name === 'aac'`
  * `videoStream.width === 1080` e `videoStream.height === 1920`
  * Cálculo dinâmico do **FPS físico real** a partir de `avg_frame_rate` / `r_frame_rate` (exigindo $29 \le \text{fps} \le 31$);
  * Duração real dentro da tolerância configurável (`COMPOSER_DURATION_TOLERANCE_MS = 250` ms);
  * Sincronismo entre áudio e vídeo com descompasso $\le 200\text{ ms}$.
* **Eliminação de Hardcode:** A propriedade `fps` não é mais retornada como constante fixa e sim extraída da medição física real do fluxo de quadros.

### 2.4 FIX 4 — Limpeza Automática de `.tmp` Pós-Falha e Teste de Saúde Real
* **Cleanup Autônomo:** O bloco `catch` de `composeCreative()` executa a deleção do arquivo temporário `.tmp` gerado na tentativa com falha.
* **Validação de Teste Sem Intervenção Manual (Cenário 20):** O teste provoca falha intencional de renderização sem realizar nenhuma limpeza manual e atesta que nenhum resíduo `.tmp` permaneceu no filesystem.
* **Saúde Real da Infraestrutura (Cenário 32):** O teste de saúde agora inspeciona o processo do PM2 via `pm2 jlist` (confirmando status `online` da aplicação `bali-gestor`) em conjunto com a query de liveness do PostgreSQL 16.

### 2.5 FIX 5 — Remoção de Credencial Fallback & Segurança
* **Remoção de Senha Literal:** Removido o fallback de senha `|| 'bali:secure:video:engine:2026!'` da suíte de testes `phase3b_composer_tests.js`. O teste passa a exigir estritamente a variável de ambiente `process.env.PANEL_PASSWORD`.
* **Recomendação de Rotação:** Registrada formalmente a recomendação de rotação periódica das credenciais administrativas sem exposição de valores em repositório público.

---

## 3. Matriz de Homologação Pós-Review (35/35 Cenários Aprovados no VPS)

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
| **20** | **Cleanup automático de `.tmp` em falha** | **PASS** | **Deleção autônoma pelo composer_service sem intervenção do teste** |
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
| **32** | **PM2 `bali-gestor` (online via `jlist`) e PostgreSQL 16 saudáveis** | **PASS** | **Processo verificado online via jlist (pid 81857) e DB ativo** |
| **33** | **Trims reais aplicados fisicamente no FFmpeg** | **PASS** | **Clipe de 5s trimado (1s→3s) gerou exatamente 2000ms (não 5s)** |
| **34** | **Proteção contra arquivo órfão prévio em `finalPath`** | **PASS** | **Órfão removido com segurança e nova saída promovida** |
| **35** | **QC estrito de Codecs físicos (H.264 / AAC) e FPS real** | **PASS** | **Streams validados: h264 (1080x1920@30fps) e aac** |

---

## 4. Garantias de Não-Regressão

* **Fase 2C Preservada:** Os fluxos de aprovação de piloto, geração de remainder e entrega oficial dos Vídeos 1, 2 e 3 continuam operando de forma 100% autônoma.
* **Isolamento de Estado:** O ciclo de vida do Composer (`processing`, `ready`, `failed`) é mantido exclusivamente em `video_assets`. A coluna `video_jobs.status` não sofre alterações.
* **WhatsApp V1 Intacto:** Nenhuma linha de `video_anuncios_engine.js` foi alterada.
* **Showcase Job Homologado:** O Job `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` segue respondendo com código 200 em todas as rotas de vídeo `/video/1`, `/video/2` e `/video/3`.
