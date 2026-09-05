# Arquitetura e Plano de Implementação — Fase 3B (Revisão Final)
## Video Composer MVP (Timeline Engine Orientada a Creative Blueprint)

**Status:** Planejamento Arquitetural Revisado (PLAN ONLY)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 3A):** `8e2bf0306f557c595e8070628ee3e646a599d759`  
**Escopo:** Especificação técnica rigorosa e definitiva do primeiro Video Composer determinístico orientado por Creative Blueprint, em modo Shadow Aditivo, sem implementação de código produtivo ou migrations nesta etapa.

---

## 1. Visão Geral e Princípio Central

A Fase 3B constrói a primeira ponte funcional entre a fundação de dados da Fase 3A e o futuro Editing Engine:
$$\text{Creative Blueprint} + \text{Asset Resolver} \xrightarrow{\text{Video Composer}} \text{MP4 Final Renderizado}$$

### O Princípio Central: Execução Pura e Determinística
O Video Composer **NÃO toma decisões criativas**. Ele é um executor puro de uma receita declarativa:
$$\text{AI / Creative Engine} \longrightarrow \text{Creative Blueprint} \longrightarrow \text{Video Composer} \longrightarrow \text{FFmpeg}$$

- O **Blueprint** dita os componentes, formatos, cortes e diretrizes.
- O **Asset Resolver** valida a integridade física, hashes e ownership físico do Job.
- O **Composer** compila a receita em um plano de execução linear e invoca o FFmpeg através de um pipeline canônico padronizado de re-encode.

---

## 2. Decisões Arquiteturais Fundamentais

### 2.1 Identidade Canônica de Renderização: A `render_key`

Para garantir determinismo absoluto, reprodutibilidade e invalidação segura de cache, o Composer **NÃO depende apenas da trinca superficial `job_id + creative_id + blueprint_version`**.

A identidade do render é governada pela **`render_key`**: um hash SHA-256 (64 caracteres hex) calculado sobre a serialização canônica recursiva de **todos os fatores que afetam o resultado visual ou auditivo**:

```javascript
const renderSpec = {
  schema_version: '1.0',
  composer_contract_version: 'composer_v1', // Versão do pipeline de render
  creative_id: String(blueprint.creative_id),
  blueprint_version: Number(blueprint.blueprint_version || 1),
  format: {
    aspect_ratio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30
  },
  timeline: canonicalTimelineSegments, // Array ordenado: role, layer, source_in_ms, source_out_ms
  composition_directives: canonicalDirectives, // Transições, ganhos de áudio, normalização
  input_assets: [
    // Array ordenado por timeline com asset_id E file_hash físico dos bytes de entrada!
    { role: 'hook', asset_id: 'ast_hk_bbddf3ba_01', file_hash: 'sha256_hook_bytes...' },
    { role: 'body', asset_id: 'ast_bd_bbddf3ba_01', file_hash: 'sha256_body_bytes...' }
  ]
};

const render_key = crypto.createHash('sha256')
  .update(canonicalStringify(renderSpec), 'utf8')
  .digest('hex');
```

#### Invariantes da `render_key`:
1. Se qualquer clipe de entrada for re-renderizado na HeyGen (gerando novo `file_hash`), a `render_key` **muda automaticamente**, forçando nova renderização do criativo.
2. Se um corte ou trim for alterado no Blueprint, a `render_key` **muda**.
3. Se a versão do contrato do Composer for atualizada (ex: novo filtro ou novo codec), a `render_key` **muda**.
4. Mesma receita com os mesmos bytes de entrada = rigorosamente a **mesma `render_key`**.

---

### 2.2 Concorrência: Claim Atômico Persistente via PostgreSQL & Stale Recovery

Removemos expressamente qualquer dependência de mutex frágil em memória (`Map<string, Promise>`), adotando **governança transacional atômica no banco de dados (`video_assets`)**:

#### 2.2.1 Mecanismo SQL de Claim Atômico
Cada renderização tenta adquirir o lock transacionando o asset em `video_assets`:

```sql
INSERT INTO video_assets (
    id, job_id, property_ref, asset_type, storage_type,
    storage_path, file_hash, generation_key, status,
    specs, metadata, created_at, updated_at
) VALUES (
    $1, -- Asset ID derivado da render_key (ex: ast_out_<creative_id>_<render_key_curta>)
    $2, -- job_id
    $3, -- property_ref
    $4, -- asset_type ('rendered_creative' ou 'shadow_creative')
    'local_file',
    NULL, -- storage_path é NULL enquanto processing
    NULL, -- file_hash é NULL enquanto processing
    $5, -- generation_key = render_key
    'processing',
    '{}'::jsonb,
    $6, -- metadata com pid, host, started_at, temp_filename
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    status = 'processing',
    updated_at = NOW(),
    metadata = video_assets.metadata || $6::jsonb
WHERE video_assets.status IN ('pending', 'failed')
   OR (video_assets.status = 'processing' AND video_assets.updated_at < NOW() - INTERVAL '5 minutes')
RETURNING *;
```

#### 2.2.2 Interpretação da Resposta do Claim:
1. **Linha retornada (`RETURNING *`):** A requisição atual **adquiriu com sucesso o direito exclusivo de renderização**. Procede para a invocação do FFmpeg.
2. **Nenhuma linha retornada (Conflito de Concorrência):**
   - O Composer consulta o registro existente:
     - Se `status = 'ready'`: O criativo já foi renderizado e validado -> **Retorno imediato idempotente**.
     - Se `status = 'processing'` (ativo, dentro da janela de lease): Outro processo ou worker está renderizando -> **Retorna `HTTP 409 Conflict` ou aguarda em polling não-bloqueante**.

#### 2.2.3 Recuperação de Execuções Mortas (Stale Processing Recovery):
- **Janela de Lease:** `STALE_RENDER_TIMEOUT = 300 segundos` (5 minutos).
- Se o servidor, container ou processo PM2 sofrer crash ou `kill -9` durante a renderização, o registro permanecerá como `processing`.
- Quando uma nova chamada ocorrer após 5 minutos (`updated_at < NOW() - INTERVAL '5 minutes'`), a cláusula `WHERE` do claim permite a re-reivindicação atômica do lock, limpando o arquivo temporário órfão gravado no `metadata.temp_filename` e reiniciando a montagem de forma limpa.

---

### 2.3 Saída Física Imutável e Atomicidade

Um asset `ready` **NUNCA é sobrescrito**. O Composer adota versionamento físico imutável por `render_key`:

1. **Naming Canônico Imutável:**
   $$Filename = \texttt{composer\_} + \langle \text{creative\_id} \rangle + \texttt{\_} + \langle \text{render\_key}[0..9] \rangle + \texttt{.mp4}$$
   *Exemplo:* `composer_crv_bbddf3ba_v1_b1_a8c2f1e4b9.mp4`.
2. **Atomicidade Estrita (`.tmp`):**
   - O FFmpeg renderiza exclusivamente em um arquivo temporário único contendo UUID:
     `outputs/jobs/<job_id>/composer_crv_bbddf3ba_v1_b1_a8c2f1e4b9.tmp.<uuid>.mp4`.
   - Enquanto o arquivo está em renderização, nenhum leitor externo tem acesso a bytes parciais.
3. **Inspecção Pré-Promoção:**
   - Antes de mover o arquivo, `validateMediaStreamsAndDuration()` executa `ffprobe` no arquivo `.tmp`.
   - Se a validação passar:
     $$\text{fs.renameSync(tempPath, finalPath)}$$
   - **Garantia de Imutabilidade:** O `finalPath` deriva da `render_key`. Se o arquivo final já existir no disco com status `ready`, o `rename` é desnecessário e o arquivo existente é preservado.
4. **Cleanup Garantido:**
   - O arquivo `.tmp` é destruído em bloco `finally` caso ocorra qualquer erro de timeout, falha de codec ou crash de validação.

---

### 2.4 FFmpeg: Pipeline Canônico Único de Re-encode (Sem Dual-Path)

Avaliamos a abordagem anterior de `-c copy` com fallback para re-encode. **Decisão:** No Composer MVP, **eliminamos o dual-path em favor de um pipeline único, padronizado e previsível de re-encode**.

#### Justificativa Técnica:
O `-c copy` (concat demuxer) falha silenciosamente ou introduz artefatos sutis (dessincronia de áudio de ~20ms por priming samples do encoder AAC da HeyGen, timebases incompatíveis ou keyframes desalinhados).
Um pipeline único de re-encode garante que todo vídeo gerado pelo Composer atenda rigorosamente ao contrato de mídia:

```bash
ffmpeg -y \
  -i /var/www/bali-gestor/outputs/jobs/<jobId>/hook_1.mp4 \
  -i /var/www/bali-gestor/outputs/jobs/<jobId>/body.mp4 \
  -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" \
  -map "[outv]" \
  -map "[outa]" \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -r 30 -s 1080x1920 \
  -c:a aac -b:a 192k -ar 44100 -ac 2 \
  -movflags +faststart \
  /var/www/bali-gestor/outputs/jobs/<jobId>/composer_<target>.tmp.<uuid>.mp4
```

- **Execução Segura:** Invocado exclusivamente via `child_process.execFile('ffmpeg', argsArray)` (sem `shell: true`, imune a shell injection).
- **Controle de Timeout:** Timeout padrão de 120 segundos; captura de `stderr` limitada a 100KB para evitar estouro de memória.

---

### 2.5 Duração: Unidade Oficial e Descarte de Placeholders

1. **Unidade Oficial Única:** O Composer opera internamente **estritamente em milissegundos inteiros (`duration_ms`)**.
2. **Conversão Única:** A propriedade `asset.specs.duration` (em segundos float) é convertida uma única vez no momento da resolução:
   $$\text{duration\_ms} = \text{Math.round}(\text{Number}(\text{asset.specs.duration}) \times 1000)$$
3. **Descarte de Placeholders Fictícios:**
   - Os valores de `timeline_start_ms` (~9500) e `timeline_end_ms` (~38200) herdados da Fase 3A são tratados **exclusivamente como metadados textuais conceituais e NÃO comandam cortes**.
   - Na ausência de trims explícitos (`source_in_ms: null`, `source_out_ms: null`), o Composer aloca **100% da duração física real** de cada asset.
4. **Cálculo Determinístico da Timeline:**
   $$\text{Timeline}(0) = [0 \to D_{\text{hook\_ms}}]$$
   $$\text{Timeline}(1) = [D_{\text{hook\_ms}} \to D_{\text{hook\_ms}} + D_{\text{body\_ms}}]$$
   $$\text{Duração Total Esperada} = D_{\text{hook\_ms}} + D_{\text{body\_ms}}$$

---

### 2.6 Equivalência Semântica com Tolerância Configurável

Para homologação do Composer frente ao concat legado da Fase 2C:
- **Tolerância Configurável:** `COMPOSER_DURATION_TOLERANCE_MS` (valor inicial padrão de homologação: **`250 ms`**).
- **Critérios de Equivalência no Pós-Render:**
  1. $|\text{Duração Real do Arquivo} - \text{Duração Total Esperada}| \le 250\text{ ms}$;
  2. $|\text{Duração do Stream de Vídeo} - \text{Duração do Stream de Áudio}| \le 100\text{ ms}$ (ausência de descompasso);
  3. Resolução estritamente $1080 \times 1920$, 30 fps;
  4. Streams ativos: exatamente 1 vídeo H.264 + 1 áudio AAC;
  5. Ausência de truncamento (áudio do final da fala preservado).

---

### 2.7 Estratégia de Shadow Composer (Rollout Não-Bloqueante)

A Fase 3B não altera em hipótese alguma o vídeo servido ao usuário final:

| Atributo | Pipeline Oficial (Fase 2C) | Shadow Composer (Fase 3B) |
| :--- | :--- | :--- |
| **Geração** | FFmpeg concat legado procedural | `video_engine/composer_service.js` |
| **Arquivo Gerado** | `pilot.mp4`, `video_2.mp4`, `video_3.mp4` | `shadow_crv_<id>_<render_key>.mp4` |
| **Asset Type em `video_assets`** | `rendered_creative` | `shadow_creative` |
| **Colunas em `video_jobs`** | `pilot_video_url`, `video2_url`, `video3_url` | **NÃO MODIFICADAS** (permanecem intactas) |
| **Status do Job** | Governa `CREATIVE_SET_READY` | **NÃO MODIFICADO** |
| **Acesso do Usuário** | Rotas oficiais `/pilot`, `/video/:index` | Endpoints internos de homologação `/shadow-video/:index` |

O Shadow Composer opera silenciosamente em segundo plano, permitindo que a suíte automatizada compare lado a lado o output legado e o output do Composer para comprovação formal de equivalência.

---

### 2.8 Matriz de Recuperação de Falhas e Integridade (Recovery Matrix)

| Cenário de Falha | Comportamento do Composer | Garantia de Integridade |
| :--- | :--- | :--- |
| **Timeout de FFmpeg (> 120s)** | Mata o processo filho (SIGKILL), destrói o `.tmp` e marca o asset como `failed` com `error_message = 'FFMPEG_TIMEOUT'`. | Nenhum arquivo corrompido é promovido. O próximo retry tem lock limpo. |
| **Crash do PM2 durante o render** | O registro em `video_assets` permanece `processing`. | Após 5 minutos (`stale lease`), nova requisição detecta lease expirada, assume o claim e re-renderiza. |
| **Arquivo `.tmp` órfão no disco** | O path do temporário é registrado em `metadata.temp_filename`. | O processo de claim ou rotina de boot identifica o `.tmp` órfão e executa `fs.unlinkSync()`. |
| **Arquivo físico presente sem registro READY** | O Composer **NUNCA** faz scan de diretório para inferir arquivos órfãos. | Arquivos desconhecidos são ignorados; a renderização ocorre deterministicamente para o destino canônico. |
| **DB com READY mas arquivo ausente no disco** | O `resolveAndValidateAsset()` detecta `!fs.existsSync()` e lança erro explícito. | Impede que o sistema sirva links quebrados; marca o status como `failed` e permite novo render. |
| **Divergência de `file_hash` de entrada** | O Asset Resolver recalcula o hash físico e detecta divergência antes do FFmpeg. | Bloqueia a execução imediatamente com `TAMPERING ERROR`. |

---

## 3. Respostas Objetivas às 10 Questões Arquiteturais Mandatórias

1. **Definição exata da `render_key`:**  
   Hash SHA-256 (64 hex) resultante da canonicalização recursiva estrita do payload `renderSpec`, contendo versão do contrato, `creative_id`, `blueprint_version`, formato, timeline sequencial, diretrizes de áudio e a lista ordenada de cada `asset_id` acompanhada de seu `file_hash` físico real.
2. **Algoritmo de cálculo:**  
   Função pura `computeRenderKey(blueprint, resolvedAssetsMap)` que constrói a árvore de especificação canônica, ordena recursivamente todas as chaves em todos os níveis de objetos (preservando a ordem ordinal de arrays) via `canonicalStringify()` e aplica `crypto.createHash('sha256')`.
3. **Mecanismo SQL do claim atômico:**  
   `INSERT INTO video_assets (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() WHERE video_assets.status IN ('pending', 'failed') OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes') RETURNING *;`.
4. **Regra de stale/recovery:**  
   Janela de lease de 5 minutos. Se `status = 'processing'` e `updated_at < NOW() - 5 min`, o lock é considerado órfão/stale e qualquer nova requisição pode reivindicá-lo atomicamente, deletando o arquivo temporário anterior registrado em `metadata.temp_filename`.
5. **Path/filename imutável:**  
   Armazenado estritamente em `outputs/jobs/<job_id>/` com nome determinístico:  
   `composer_${creative_id}_${render_key.slice(0, 10)}.mp4` (para oficial) ou `shadow_${creative_id}_${render_key.slice(0, 10)}.mp4` (para shadow). Assets `ready` nunca sofrem sobrescrita.
6. **Decisão final sobre re-encode:**  
   Adotado um **pipeline único e padronizado de re-encode** via `filter_complex` (`concat=n=2:v=1:a=1`), codificado em H.264 (yuv420p, 1080x1920@30fps) e áudio AAC (192k, 44100Hz, stereo) com `-movflags +faststart`. Eliminado o dual-path `-c copy` para evitar instabilidades de timebase e priming samples.
7. **Distinção shadow/oficial:**  
   O Shadow Composer utiliza `asset_type = 'shadow_creative'`, prefixo de arquivo `shadow_` e não altera `video_jobs.pilot_video_url`, `video2_url`, `video3_url` nem `video_jobs.status`. O oficial da 2C permanece 100% isolado.
8. **Uso de `video_assets` para estado do Composer:**  
   O ciclo de vida do render (`processing`, `ready`, `failed`) é registrado na linha correspondente em `video_assets`. A coluna `video_jobs.status` permanece limpa e restrita à máquina de estados do negócio (Pilot First).
9. **Preservação de versões antigas:**  
   Qualquer alteração que gere nova `render_key` gera um **novo registro e novo arquivo físico**. A versão física e o registro anteriores permanecem intactos no catálogo e no filesystem.
10. **Tolerância inicial de duração:**  
    Configurada em `COMPOSER_DURATION_TOLERANCE_MS = 250` (milissegundos). Valida que a duração do arquivo final esteja dentro de $\pm 250\text{ ms}$ da soma física real dos componentes e que a diferença entre os streams de vídeo e áudio seja $\le 100\text{ ms}$.

---

## 4. Suíte de Homologação Planejada para a Fase 3B (32 Cenários)

1. Blueprint válido Hook+Body renderiza com sucesso -> PASS
2. Ordem sequencial dos clipes respeitada -> PASS
3. Asset inexistente rejeitado antes de invocar FFmpeg -> PASS
4. Asset não-ready rejeitado antes do FFmpeg -> PASS
5. Asset de outro Job rejeitado por violação de ownership físico -> PASS
6. Symlink externo rejeitado -> PASS
7. `file_hash` divergente (adulteração de bytes) rejeitado -> PASS
8. Blueprint vazio ou corrompido rejeitado -> PASS
9. `schema_version` não suportada rejeitada -> PASS
10. Camada não suportada (`layer > 0`) rejeitada no MVP -> PASS
11. Parâmetros de trim inválidos (`source_in >= source_out`) rejeitados -> PASS
12. Arquivo de saída contém stream de vídeo ativo -> PASS
13. Arquivo de saída contém stream de áudio ativo -> PASS
14. Duração de saída dentro da tolerância configurável de $\pm 250\text{ ms}$ -> PASS
15. Resolução de saída estritamente 1080x1920 -> PASS
16. Taxa de quadros de saída 30 fps e formato H.264 canônico -> PASS
17. Pipeline de re-encode padronizado único gera output íntegro -> PASS
18. Unidade de duração oficial (`duration_ms`) aplicada sem truncamento -> PASS
19. Placeholders antigos de metadata ignorados (fala completa preservada) -> PASS
20. Arquivo temporário `.tmp` deletado em caso de falha de renderização -> PASS
21. Arquivo final existente não corrompido em caso de erro no retry -> PASS
22. **Mesma `render_key` gera retorno idempotente imediato sem invocar FFmpeg** -> PASS
23. **Mudança no `file_hash` de um asset de entrada altera a `render_key`** -> PASS
24. **Mudança no Blueprint (trims, ordem, formato) altera a `render_key`** -> PASS
25. **Asset READY nunca é sobrescrito fisicamente** -> PASS
26. **Claim atômico SQL impede duas renderizações simultâneas do mesmo criativo** -> PASS
27. **Recuperação automática de stale processing após lease de 5 minutos** -> PASS
28. **Shadow Composer gera arquivo paralelo sem tocar nos campos oficiais da 2C** -> PASS
29. **Comparação semântica entre Shadow Composer e concat legado demonstra equivalência** -> PASS
30. **Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200)** -> PASS
31. **WhatsApp V1 e bloqueio estático 403 em `/outputs/jobs/` permanecem intocados** -> PASS
32. **PM2 `bali-gestor` e PostgreSQL 16 saudáveis** -> PASS

---

## 5. Roadmap Estratégico Pós-Fase 3B

```
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3A (Homologada): Asset Model & Creative Blueprint Foundation      │
│ - Tabela video_assets, creative_blueprints, generation_key, file_hash  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3B (Atual Planejamento): Video Composer MVP (Timeline Engine)     │
│ - composer_service.js com render_key determinística profunda           │
│ - Claim atômico SQL, re-encode canônico único, modo Shadow aditivo     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3C: Editing Styles & Overlays Dinâmicos                           │
│ - Camadas adicionais (layer > 0): B-roll de fotos sobre o áudio do body│
│ - Legendas automáticas com destaque de palavras e ducking de áudio     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3D: Reutilização Controlada de Assets & Reference Library         │
│ - Ativação controlada de reuso de assets por generation_key            │
│ - Decomposição de anúncios campeões em blueprints de Video DNA         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3E: Creative Variations & Multi-Armed Combinatorics               │
│ - Geração combinatória de N variantes com custo de renderização mínimo │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3F: Creative IDs & Meta Ads Feedback Loop                         │
│ - Correlação analítica de Creative IDs com CPA/CTR no Facebook Ads API │
└────────────────────────────────────────────────────────────────────────┘
```

---

> [!IMPORTANT]
> **Status da Entrega:** Este plano consolida integralmente todas as correções arquiteturais exigidas na revisão externa. O código de produção, banco de dados, migrations e serviços no VPS permanecem 100% inalterados (**PLAN ONLY**).
