# Changelog — Fase 3B: Video Composer MVP (Timeline Engine)
## Video Engine V2 — Bali Imóveis

**Data de Conclusão:** 05/09/2026  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status:** HOMOLOGADO E APROVADO (32/32 Cenários Automatizados no VPS com Sucesso)  
**Commit de Referência do Plano Aprovado:** `4feb22126fe1e8d142b6f3384f7ffcf7d37d23a8`

---

## 1. Objetivo da Fase 3B

Transição arquitetural da montagem procedural hardcoded (`Hook + Body -> FFmpeg concat`) para o primeiro **Video Composer determinístico orientado por Creative Blueprint**:

$$\text{Creative Blueprint} + \text{Asset Resolver} \longrightarrow \text{Video Composer} \longrightarrow \text{MP4 Final}$$

O Composer MVP implementa um executor puro de receitas com cálculo profundo de identidade de renderização (`render_key`), controle atômico persistente de concorrência via PostgreSQL, validações estritas pré-FFmpeg, pipeline único padronizado de re-encode e isolamento total em modo **Shadow Aditivo** sem qualquer impacto no pipeline da Fase 2C ou WhatsApp V1.

---

## 2. Componentes Entregues

### 2.1 Módulo Central `video_engine/composer_service.js`

1. **Validação Estrita de Contrato (Fail-Fast Pré-FFmpeg):**
   - Valida `schema_version = '1.0'`;
   - Exige formato canônico `1080x1920@30fps` na proporção vertical `9:16`;
   - Restrição de camada: exclusivamente `layer = 0` no MVP;
   - Validação de trims (`source_in_ms < source_out_ms` e dentro da duração do clipe);
   - Rejeição imediata antes de qualquer chamada a disco ou subprocesso FFmpeg.

2. **Asset Resolution & Ownership Físico Canônico:**
   - Resolução via `assetService.resolveAndValidateAsset()`;
   - Verificação de status `ready` e integridade física via `file_hash`;
   - Validação de contenção estrita no diretório do Job (`outputs/jobs/<jobId>/`);
   - Bloqueio de traversal e symlinks externos (`SECURITY VIOLATION`);
   - Conversão e adoção da **unidade oficial de duração** em milissegundos inteiros (`duration_ms = Math.round(specs.duration * 1000)`), ignorando placeholders antigos conceituais.

3. **Cálculo Determinístico e Profundo da `render_key`:**
   - Algoritmo SHA-256 sobre a estrutura normalizada e ordenada canonicamente:
     * `schema_version` e `composer_contract_version` (`composer_v1`);
     * `creative_id` e `blueprint_version`;
     * `format` (aspect_ratio, width, height, fps);
     * `timeline` canônica (ordem sequencial, papéis, camadas, trims);
     * `composition_directives`;
     * `input_assets` contendo `asset_id` e o **`file_hash` físico de cada clipe de entrada**;
   - Qualquer mutação em bytes de entrada ou blueprint altera deterministicamente a `render_key`.

4. **Claim Atômico SQL com Lease e Stale Recovery:**
   - Trava persistente no PostgreSQL via `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE status IN ('pending', 'failed') OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')`;
   - Impede execução duplicada ou concorrente do mesmo criativo;
   - Recuperação automática de jobs abortados/órfãos após 5 minutos de inatividade (`stale processing`).

5. **Pipeline Canônico Único de Re-encode FFmpeg:**
   - Filtro padronizado `-filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]"`;
   - Codificação de vídeo: H.264 `libx264`, preset `fast`/`ultrafast`, CRF 20, pixel format `yuv420p`, 1080x1920, 30 fps;
   - Codificação de áudio: AAC `aac`, 192 kbps, 44100 Hz, stereo;
   - Otimização para streaming web: `-movflags +faststart`;
   - Eliminação de dual-path (`-c copy`) para garantir timebase uniforme e ausência de priming samples discrepantes.

6. **Escrita Atômica, Inspeção `ffprobe` e Imutabilidade:**
   - Renderização inicial em arquivo temporário único (`.tmp.<uuid>.mp4`);
   - Validação pós-render via `ffprobe` (streams de áudio e vídeo ativos, dimensões 1080x1920, sincronismo de trilha $\le 200\text{ ms}$, duração esperada dentro da tolerância de $\pm 250\text{ ms}$);
   - Promoção atômica via `fs.renameSync()`;
   - Remoção automática de temporários órfãos em caso de erro;
   - Imutabilidade física: arquivos promovidos e assets `ready` nunca sofrem sobrescrita.

7. **Idempotência Imediata:**
   - Se um asset com a mesma `render_key` já estiver com status `ready` e o arquivo físico intacto no disco, o Composer retorna o resultado existente em milissegundos sem invocar FFmpeg.

8. **Comparador Semântico de Equivalência:**
   - Função `compareLegacyVsComposer(legacyPath, composerPath)` que avalia lado a lado resoluções, presença de streams e diferença de duração com retorno booleano estrito.

---

### 2.2 Endpoints Homologados em `video_engine/api_v2.js`

* `POST /api/v2/panel/video-jobs/:id/compose-shadow/:index`: Dispara a renderização do Composer MVP em modo Shadow para a variante (1, 2 ou 3) a partir de seu Creative Blueprint.
* `GET /api/v2/panel/video-jobs/:id/compare-shadow/:index`: Retorna o relatório de comparação semântica entre o vídeo legado e o vídeo do Shadow Composer.
* `GET /api/v2/panel/video-jobs/:id/shadow-video/:index`: Streaming HTTP autenticado do MP4 gerado pelo Shadow Composer com suporte a `Range: bytes`.

---

## 3. Matriz de Homologação (32/32 Cenários Aprovados no VPS)

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
| **20** | Arquivo temporário `.tmp` deletado em caso de falha | **PASS** | Cleanup automático garantido em falhas |
| **21** | Arquivo final existente não corrompido em retry | **PASS** | Hash de saída prévia preservado após erro |
| **22** | Retorno idempotente imediato para mesma `render_key` | **PASS** | Retorno em 78ms sem invocação de FFmpeg |
| **23** | Mudança no `file_hash` de entrada altera `render_key` | **PASS** | Sensibilidade estrita a bytes de entrada |
| **24** | Mudança no Blueprint altera deterministicamente `render_key` | **PASS** | Sensibilidade estrita a propriedades do roteiro |
| **25** | Asset READY nunca é sobrescrito fisicamente | **PASS** | Invariante de imutabilidade protegida |
| **26** | Claim atômico SQL impede renders simultâneos | **PASS** | Concorrência bloqueada com retorno 409 |
| **27** | Recuperação automática de stale lease (> 5 min) | **PASS** | Re-atribuição segura da trava após timeout |
| **28** | Shadow Composer gera arquivo paralelo sem tocar na 2C | **PASS** | Campos `pilot_video_url`, `video2_url`, `status` 100% intocados |
| **29** | Comparação semântica Shadow vs Concat demonstra equivalência | **PASS** | $\Delta = 0\text{ ms}$, resoluções idênticas (`is_equivalent = true`) |
| **30** | Job showcase da Fase 2C permanece 100% íntegro (HTTP 200) | **PASS** | Vídeos 1, 2 e 3 ativos e acessíveis |
| **31** | WhatsApp V1 e bloqueio estático 403 permanecem intocados | **PASS** | `video_anuncios_engine.js` íntegro e 403 ativo |
| **32** | PM2 `bali-gestor` e PostgreSQL 16 saudáveis | **PASS** | Processo online (pid 81056), CPU 0%, RAM 87MB |

---

## 4. Garantias de Não-Regressão

* **Fase 2C Preservada:** Os fluxos de aprovação de piloto, geração de remainder e entrega oficial dos Vídeos 1, 2 e 3 continuam operando de forma 100% autônoma.
* **Isolamento de Estado:** O ciclo de vida do Composer (`processing`, `ready`, `failed`) é mantido exclusivamente em `video_assets`. A coluna `video_jobs.status` não sofre alterações.
* **WhatsApp V1 Intacto:** Nenhuma linha de `video_anuncios_engine.js` foi alterada.
* **Showcase Job Homologado:** O Job `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` segue respondendo com código 200 em todas as rotas de vídeo `/video/1`, `/video/2` e `/video/3`.
