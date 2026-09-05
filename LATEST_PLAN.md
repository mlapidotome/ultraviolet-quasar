# Proposta Arquitetural & Plano de Implementação — Fase 2C (Revisado)
## Aprovação do Piloto e Geração dos Vídeos Restantes (Ganchos 2 e 3)

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2C (Aprovação / Reprovação do Piloto e Conclusão do Creative Set)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO FINAL  
**Objetivo Estratégico:** Após o Job atingir o estado `PILOT_READY` na Fase 2B, permitir que Marcel avalie o vídeo piloto no painel e decida entre **APROVAR** ou **REPROVAR**.  
Se aprovado, o sistema reaproveita o `body.mp4` **já existente e validado de forma forte e inequívoca no Job**, gera exclusivamente os Ganchos 2 e 3 na HeyGen, monta os Vídeos 2 e 3 via FFmpeg e entrega a coleção criativa completa (3 vídeos), **sem regenerar o corpo, sem gastar créditos duplicados na HeyGen, com concorrência atômica, Smart Resume granular no boot e em retry, e entrega 100% autenticada**.

---

## 1. Diagnóstico do Fluxo Legado (`OK / GERAR RESTANTE` no WhatsApp)

A inspeção em `/var/www/bali-gestor/video_anuncios_engine.js` (linhas 580 a 635) evidenciou os seguintes acoplamentos e fragilidades no fluxo legado:

1. **Dependência Volátil e Fallback Arbitrário:**
   - O gatilho de aprovação (`OK`, `GERAR RESTANTE`) pesquisa a sessão em `activeVideoSessions[sessionKey]`.
   - Se a memória RAM foi reiniciada pelo PM2, invoca `getOrInitSession("1639")`, recorrendo ao imóvel fixo `#1639`.

2. **Reutilização Insegura de Body via Varredura de Disco:**
   - Se `session.bodyPath` estiver vazio na RAM, o sistema executa:
     `fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith("body_" + session.imovelRef) && f.endsWith(".mp4")).sort().reverse()[0]`
   - O código vasculha a pasta compartilhada `outputs/` e escolhe o último arquivo pelo nome.
   - **Grave Risco:** Se os roteiros foram alterados, se houve erro parcial ou se outro job do mesmo imóvel foi gerado, o sistema reutiliza um corpo de outro contexto ou versão desatualizada.

3. **Sobrescrita de Arquivos Físicos:**
   - Os vídeos finais são nomeados como `Anuncio_Completo_2_Imovel_<ref>.mp4` e `Anuncio_Completo_3_Imovel_<ref>.mp4`, sobrescrevendo arquivos de execuções anteriores na pasta pública.

4. **Ausência de Rastreamento de Estado:**
   - Não há persistência em banco dos `video_id` da HeyGen dos Ganchos 2 e 3. Se o processo cair durante a geração dos restantes, o WhatsApp perde a referência e exige reiniciar todo o fluxo.

---

## 2. Regras Arquiteturais Absolutas da Fase 2C

### 2.1. Validação Forte do `body.mp4` Reutilizado (Anti-Symlink & Mídia Completa)
O arquivo de corpo utilizado na concatenação dos Vídeos 2 e 3 **não é considerado válido apenas porque o arquivo existe ou possui duração positiva**. Ele deve cumprir obrigatoriamente e cumulativamente todas as seguintes condições:

1. **Rastreabilidade no Banco:**  
   `metadata.pilot.body.local_path` existe e está preenchido no banco de dados.

2. **Isolamento de Diretório Físico Real & Proteção Anti-Symlink:**
   - O diretório esperado do job é obtido e canonicamente resolvido via `fs.realpathSync(jobDir)`:
     `const realJobDir = fs.realpathSync(path.resolve('/var/www/bali-gestor/outputs/jobs', jobId));`
   - O caminho do arquivo é inspecionado com `fs.lstatSync(localPath)`:
     - Se `fs.lstatSync(localPath).isSymbolicLink()`, sua resolução canônica real deve ser obrigatoriamente inspecionada;
   - O caminho físico real do arquivo é resolvido via `fs.realpathSync(localPath)`:
     `const realBodyPath = fs.realpathSync(localPath);`
   - **Verificação de Pertença Estrita:**  
     `realBodyPath.startsWith(realJobDir + path.sep)` deve ser `true`. É expressamente proibido qualquer link simbólico ou caminho que aponte para fora do diretório físico daquele Job;
   - **Verificação de Basename:**  
     `path.basename(realBodyPath) === 'body.mp4'` e `path.basename(localPath) === 'body.mp4'`.

3. **Existência Física & Integridade de Bytes:**
   - `fs.existsSync(localPath) === true`;
   - `fs.statSync(localPath).size > 0` (tamanho estritamente maior que zero bytes).

4. **Validação Estrutural Completa de Streams de Mídia via `ffprobe`:**
   - Execução de análise de streams e formato:
     ```bash
     ffprobe -v error -show_entries stream=codec_type -show_entries format=duration -of json "<localPath>"
     ```
   - **Critérios Obrigatórios e Cumulativos:**
     1. `parseFloat(probe.format?.duration) > 0` (duração estritamente positiva);
     2. Pelo menos 1 stream com `codec_type === 'video'` (vídeo válido presente);
     3. Pelo menos 1 stream com `codec_type === 'audio'` (áudio de voz/narração presente).

> [!CAUTION]
> **Ação em Caso de Falha de Qualquer Validação do Body:**
> Se o arquivo for symlink para fora da pasta do Job, se tiver 0 bytes, ou se o `ffprobe` acusar falta de vídeo, falta de áudio ou duração <= 0:
> - **NÃO** regenerar Body automaticamente;
> - **NÃO** procurar outro Body por nome em `outputs/`;
> - **NÃO** usar Body de outro Job ou de sessões legadas;
> - Transitar o Job imediatamente para `REMAINDER_FAILED` com mensagem de erro explícita no banco (`metadata.remainder.error_message = 'INVALID_OR_CORRUPT_PILOT_BODY'`).

---

### 2.2. Smart Retry Granular (Nunca Refazer o que já Foi Concluído)
Quando o Job estiver em `REMAINDER_FAILED` e Marcel clicar em **"Tentar Novamente"**, ou quando o servidor reiniciar (Smart Resume), o sistema inspeciona o estado exato dos assets e **apenas executa o delta pendente**:

| Asset / Etapa | Condição Encontrada | Ação do Sistema |
|---|---|---|
| **Body Original** | Validado pelo item 2.1 (Anti-symlink + Streams V/A + Duração) | Reutiliza diretamente o `body.mp4` sem nenhuma chamada à HeyGen. |
| **Hook 2 (HeyGen)** | `metadata.remainder.hook2.heygen_video_id` existe e é válido | **NÃO** submete à HeyGen. Apenas consulta status na API da HeyGen. |
| **Hook 2 (HeyGen)** | ID ausente ou inválido | Submete apenas Hook 2 à HeyGen e persiste imediatamente o novo `heygen_video_id`. |
| **Hook 3 (HeyGen)** | `metadata.remainder.hook3.heygen_video_id` existe e é válido | **NÃO** submete à HeyGen. Apenas consulta status na API da HeyGen. |
| **Hook 3 (HeyGen)** | ID ausente ou inválido | Submete apenas Hook 3 à HeyGen e persiste imediatamente o novo `heygen_video_id`. |
| **Download Hook 2** | `hook_2.mp4` existe fisicamente com `size > 0` | **NÃO** faz download novamente. Usa o arquivo local. |
| **Download Hook 3** | `hook_3.mp4` existe fisicamente com `size > 0` | **NÃO** faz download novamente. Usa o arquivo local. |
| **Vídeo 2 (FFmpeg)** | `video_2.mp4` existe com `size > 0`, `duration > 0`, stream de vídeo E stream de áudio | **NÃO** concatena novamente. Preserva o Vídeo 2 intacto. |
| **Vídeo 3 (FFmpeg)** | `video_3.mp4` existe com `size > 0`, `duration > 0`, stream de vídeo E stream de áudio | **NÃO** concatena novamente. Preserva o Vídeo 3 intacto. |

> [!IMPORTANT]
> **Validação Forte Aplicada aos Vídeos Finais no Retry:**
> `video_2.mp4` ou `video_3.mp4` só são considerados "já concluídos" se passarem pela mesma validação de streams via `ffprobe` (tamanho > 0, duração > 0, stream de vídeo e stream de áudio). Se um vídeo existente no disco estiver corrompido ou sem áudio/vídeo, o retry descarta o arquivo inválido e refaz estritamente a concatenação daquele vídeo.

---

### 2.3. Transição Atômica de Concorrência no PostgreSQL
A transição de estado para início da produção restante é 100% atômica no banco:
```sql
UPDATE video_jobs
SET status = 'REMAINDER_SUBMITTED', updated_at = NOW()
WHERE id = $1
  AND status IN ('PILOT_READY', 'REMAINDER_FAILED')
RETURNING *;
```
- **Somente a requisição que obtiver linha no `RETURNING`** dispara a rotina assíncrona.
- Requisições concorrentes recebem:
  - `HTTP 409 Conflict` se `status IN ('REMAINDER_SUBMITTED', 'REMAINDER_RENDERING')`;
  - `HTTP 200 OK` se `status = 'CREATIVE_SET_READY'`;
  - `HTTP 400 Bad Request` em qualquer outro estado.

---

### 2.4. Entrega de Vídeos 100% Autenticada
- O diretório `/outputs/jobs/` permanece **estritamente bloqueado contra acesso estático público (`HTTP 403 Forbidden`)**.
- A entrega dos vídeos finais ocorre exclusivamente por endpoints autenticados:
  - Vídeo 1 (Piloto): `GET /api/v2/panel/video-jobs/:id/pilot` ou `/video/1`
  - Vídeo 2 (Gancho 2 + Body): `GET /api/v2/panel/video-jobs/:id/video/2`
  - Vídeo 3 (Gancho 3 + Body): `GET /api/v2/panel/video-jobs/:id/video/3`
- Validação anti-path-traversal e streaming nativo via `res.sendFile()`.

---

## 3. Máquina de Estados da Fase 2C

```
                  ┌───────────────────────────────┐
                  │          PILOT_READY          │
                  └───────┬───────────────┬───────┘
                          │               │
      Marcel Reprova      │               │ Marcel Aprova
     (reject-pilot)       │               │ (approve-and-generate)
                          ▼               ▼
         ┌──────────────────┐   ┌───────────────────────┐
         │  PILOT_REJECTED  │   │  REMAINDER_SUBMITTED  │
         └──────────────────┘   └───────────┬───────────┘
                                            │ Submete / Retoma Hooks 2 & 3
                                            ▼
                                ┌───────────────────────┐
                                │  REMAINDER_RENDERING  │
                                └─────┬───────────┬─────┘
                     Sucesso Total    │           │ Falha (Validação/HeyGen/FFmpeg)
                                      ▼           ▼
                         ┌────────────────────┐ ┌────────────────────┐
                         │ CREATIVE_SET_READY │ │  REMAINDER_FAILED  │
                         └────────────────────┘ └─────────┬──────────┘
                                                          │ Retry (Granular / Smart)
                                                          └───────────► REMAINDER_SUBMITTED
```

| Estado | Significado | Ações Permitidas |
|---|---|---|
| `PILOT_READY` | Vídeo Piloto gerado e disponível para avaliação. | Marcel pode clicar em **"Aprovar Piloto"** ou **"Reprovar Piloto"**. |
| `PILOT_REJECTED` | Piloto reprovado por Marcel. Pipeline paralisado. | Exibe aviso no painel; não gera assets adicionais. Permite arquivamento. |
| `REMAINDER_SUBMITTED` | Aprovação registrada via lock atômico; clips 2 e 3 sendo despachados ou retomados. | Painel desabilita botões e exibe spinner de processamento. |
| `REMAINDER_RENDERING` | HeyGen processando Ganchos 2 e/ou 3; polling ativo. | Painel realiza polling read-only (`GET /api/v2/panel/video-jobs/:id`). |
| `CREATIVE_SET_READY` | Ganchos 2 e 3 baixados e concatenados com o mesmo `body.mp4`. Os 3 vídeos estão prontos. | Painel exibe os 3 players de vídeo e botões de download. |
| `REMAINDER_FAILED` | Erro na validação do body, HeyGen, download ou FFmpeg. | Painel exibe mensagem descritiva de erro e botão **"Tentar Novamente"**. |

---

## 4. Persistência e Estrutura de Metadados

### 4.1. Migração Estrutural: `migrations/003_add_creative_set_fields.sql`
```sql
-- Colunas para acesso direto aos vídeos da coleção
ALTER TABLE video_jobs 
  ADD COLUMN IF NOT EXISTS video2_url TEXT,
  ADD COLUMN IF NOT EXISTS video3_url TEXT;

-- Atualizar índice de status para abranger os novos estados da Fase 2C
CREATE INDEX IF NOT EXISTS idx_video_jobs_creative_status ON video_jobs (status, updated_at DESC);
```

### 4.2. Estrutura em `metadata` (JSONB)
```json
{
  "pilot": {
    "hook1": {
      "heygen_video_id": "v78a1bc90d",
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/hook_1.mp4",
      "completed_at": "2026-09-05T03:01:00.000Z"
    },
    "body": {
      "heygen_video_id": "v89b2cd01e",
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/body.mp4",
      "completed_at": "2026-09-05T03:01:10.000Z"
    },
    "final": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/pilot.mp4",
      "authenticated_url": "/api/v2/panel/video-jobs/<job_id>/pilot",
      "completed_at": "2026-09-05T03:01:30.000Z"
    }
  },
  "remainder": {
    "approved_at": "2026-09-05T03:10:00.000Z",
    "hook2": {
      "heygen_video_id": "v11c3de45f",
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/hook_2.mp4",
      "submitted_at": "2026-09-05T03:10:05.000Z",
      "completed_at": "2026-09-05T03:11:15.000Z"
    },
    "hook3": {
      "heygen_video_id": "v22d4ef56a",
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/hook_3.mp4",
      "submitted_at": "2026-09-05T03:10:10.000Z",
      "completed_at": "2026-09-05T03:11:20.000Z"
    },
    "video2": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/video_2.mp4",
      "authenticated_url": "/api/v2/panel/video-jobs/<job_id>/video/2",
      "size_bytes": 4829102,
      "duration": 58.4,
      "concatenated_at": "2026-09-05T03:11:35.000Z"
    },
    "video3": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/video_3.mp4",
      "authenticated_url": "/api/v2/panel/video-jobs/<job_id>/video/3",
      "size_bytes": 4792180,
      "duration": 57.8,
      "concatenated_at": "2026-09-05T03:11:45.000Z"
    },
    "attempts": 1,
    "completed_at": "2026-09-05T03:11:45.000Z"
  }
}
```

---

## 5. Algoritmo de Execução do Remainder com Retry Granular

```javascript
async function executeRemainderPipeline(jobId) {
  // 1. Carrega o Job do PostgreSQL
  const job = await getJobById(jobId);
  const jobDir = path.resolve('/var/www/bali-gestor/outputs/jobs', jobId);

  // 2. Validação Forte do Body Existente (Anti-Symlink + Streams V/A + Duração)
  const bodyLocalPath = job.metadata?.pilot?.body?.local_path;
  validateStrongBody(bodyLocalPath, jobDir); // Lança erro explícito se inválido/symlink/sem áudio/sem vídeo

  // 3. Gerenciamento do Hook 2
  let hook2VideoId = job.metadata?.remainder?.hook2?.heygen_video_id;
  if (!hook2VideoId) {
    hook2VideoId = await submitHeyGenHook2(job);
    await persistHook2VideoId(jobId, hook2VideoId);
  }

  // 4. Gerenciamento do Hook 3
  let hook3VideoId = job.metadata?.remainder?.hook3?.heygen_video_id;
  if (!hook3VideoId) {
    hook3VideoId = await submitHeyGenHook3(job);
    await persistHook3VideoId(jobId, hook3VideoId);
  }

  await updateStatus(jobId, 'REMAINDER_RENDERING');

  // 5. Polling e Download Granular
  const hook2Local = path.join(jobDir, 'hook_2.mp4');
  if (!isValidMediaFile(hook2Local)) {
    const url2 = await pollHeyGenUntilReady(hook2VideoId);
    await downloadVideo(url2, hook2Local);
    await persistHook2Downloaded(jobId, hook2Local);
  }

  const hook3Local = path.join(jobDir, 'hook_3.mp4');
  if (!isValidMediaFile(hook3Local)) {
    const url3 = await pollHeyGenUntilReady(hook3VideoId);
    await downloadVideo(url3, hook3Local);
    await persistHook3Downloaded(jobId, hook3Local);
  }

  // 6. Concatenação FFmpeg Granular (Vídeo 2 com Validação Forte de Streams)
  const video2Local = path.join(jobDir, 'video_2.mp4');
  if (!isValidMediaWithStreams(video2Local)) {
    await concatVideosFFmpeg(hook2Local, bodyLocalPath, video2Local);
    validateStrongMedia(video2Local); // Confirma vídeo + áudio + duração
    await persistVideo2Ready(jobId, video2Local);
  }

  // 7. Concatenação FFmpeg Granular (Vídeo 3 com Validação Forte de Streams)
  const video3Local = path.join(jobDir, 'video_3.mp4');
  if (!isValidMediaWithStreams(video3Local)) {
    await concatVideosFFmpeg(hook3Local, bodyLocalPath, video3Local);
    validateStrongMedia(video3Local); // Confirma vídeo + áudio + duração
    await persistVideo3Ready(jobId, video3Local);
  }

  // 8. Finalização Total
  await completeCreativeSet(jobId);
}
```

---

## 6. Endpoints no Backend (`api_v2.js`)

1. **`POST /api/v2/panel/video-jobs/:id/approve-pilot`**
   - Autenticado com `panelAuthMiddleware`.
   - Executa lock SQL atômico (`UPDATE ... WHERE status IN ('PILOT_READY', 'REMAINDER_FAILED')`).
   - Se sucesso, dispara `generateRemainderVideos(jobId)` em segundo plano e retorna `HTTP 202 Accepted`.

2. **`POST /api/v2/panel/video-jobs/:id/reject-pilot`**
   - Autenticado com `panelAuthMiddleware`.
   - Executa transição atômica para `PILOT_REJECTED` (`WHERE status = 'PILOT_READY'`).
   - Retorna `HTTP 200 OK`. Nenhuma ação adicional é disparada.

3. **`GET /api/v2/panel/video-jobs/:id/video/:index`**
   - Autenticado com `panelAuthMiddleware`.
   - `:index` aceita `1`, `2` ou `3`.
   - Valida existência física dentro de `outputs/jobs/<job_id>/`.
   - Retorna o vídeo via streaming (`res.sendFile()`).

---

## 7. Alterações na Interface Web (`video-painel.html`)

1. **Quando `status === 'PILOT_READY'`:**
   - Exibe o player do Piloto (Vídeo 1).
   - Exibe dois botões de decisão:
     - `✅ Aprovar Piloto & Gerar Restantes (Ganchos 2 e 3)`
     - `❌ Reprovar Piloto`
2. **Quando `status IN ('REMAINDER_SUBMITTED', 'REMAINDER_RENDERING')`:**
   - Desabilita botões e exibe spinner com progresso:
     *"⏳ Processando Ganchos 2 e 3 na HeyGen e montando coleção criativa..."*
   - Polling automático a cada 5 segundos via `GET /api/v2/panel/video-jobs/:id`.
3. **Quando `status === 'REMAINDER_FAILED'`:**
   - Card vermelho de alerta com o erro reportado pelo servidor.
   - Botão **"Tentar Novamente"** que reaciona o pipeline aproveitando os assets já concluídos.
4. **Quando `status === 'PILOT_REJECTED'`:**
   - Card cinza informativo: *"Vídeo piloto reprovado. O pipeline para este job foi finalizado."*
5. **Quando `status === 'CREATIVE_SET_READY'`:**
   - Card verde: `🎉 COLEÇÃO CRIATIVA PRONTA (3 VÍDEOS COMPLETOS)`.
   - Grade responsiva com 3 players de vídeo independentes:
     - **Vídeo 1 (Choque / Entrada):** Gancho 1 + Corpo Imóvel (`/video/1`).
     - **Vídeo 2 (Aluguel vs Parcela):** Gancho 2 + Corpo Imóvel (`/video/2`).
     - **Vídeo 3 (Renda Familiar):** Gancho 3 + Corpo Imóvel (`/video/3`).
   - Botões de download direto para cada um dos 3 vídeos.

---

## 8. Bateria de Testes e Homologação da Fase 2C

A suíte automatizada de homologação abrangerá 24 verificações rigorosas:

1. **Aprovação Nominal de `PILOT_READY`:** Submissão de `POST /approve-pilot` retorna `HTTP 202` e transita para `REMAINDER_SUBMITTED`.
2. **Reprovação de `PILOT_READY`:** Submissão de `POST /reject-pilot` retorna `HTTP 200` e transita para `PILOT_REJECTED`.
3. **Concorrência Atômica:** Chamadas concorrentes simultâneas de aprovação resultam em exatamente uma vitória (`HTTP 202`) e uma rejeição (`HTTP 409 Conflict`).
4. **Reuso Estrito do Body:** Validação de que `outputs/jobs/<job_id>/body.mp4` é utilizado sem requisição de novo corpo.
5. **Teste de Body com Tamanho Zero:** Se `body.mp4` tiver 0 bytes, a rotina falha imediatamente para `REMAINDER_FAILED` sem chamar a HeyGen.
6. **Teste de Body com Path Traversal:** Se `local_path` contiver `../` apontando para fora de `outputs/jobs/<job_id>/`, a rotina rejeita com erro de segurança.
7. **[OBRIGATÓRIO] Teste de Symlink Externo:** Se `body.mp4` for um link simbólico apontando para arquivo fora de `outputs/jobs/<job_id>/`, resolução física via `realpathSync` detecta e rejeita para `REMAINDER_FAILED`.
8. **[OBRIGATÓRIO] Teste de Body Sem Stream de Áudio:** Se `body.mp4` tiver duração > 0 porém sem faixa de áudio no `ffprobe`, a validação falha para `REMAINDER_FAILED`.
9. **[OBRIGATÓRIO] Teste de Body Sem Stream de Vídeo:** Se `body.mp4` tiver duração > 0 porém sem faixa de vídeo no `ffprobe`, a validação falha para `REMAINDER_FAILED`.
10. **Teste de Body com Duração Zero (`ffprobe`):** Se `body.mp4` tiver duração 0, transita para `REMAINDER_FAILED`.
11. **Smart Retry com Hook 2 Salvo:** Ao reexecutar job em falha onde Hook 2 já tem ID, o sistema NÃO reenvia Hook 2 para a HeyGen.
12. **Smart Retry com Hook 3 Salvo:** Ao reexecutar job em falha onde Hook 3 já tem ID, o sistema NÃO reenvia Hook 3 para a HeyGen.
13. **[OBRIGATÓRIO] Smart Retry com Vídeo 2 Inválido (Sem Áudio/Vídeo):** Se `video_2.mp4` existir no disco mas faltar stream de áudio ou vídeo, o sistema NÃO considera concluído e refaz a montagem.
14. **Smart Retry com Vídeo 2 Concatenado e Válido:** Ao reexecutar job em falha onde Vídeo 2 possui áudio, vídeo e duração comprovados, o sistema NÃO refaz a concatenação do Vídeo 2.
15. **Smart Retry com Ambos os Hooks Prontos:** Se ambos os clips já foram baixados, o retry executa estritamente a concatenação FFmpeg com zero chamadas à HeyGen.
16. **Geração dos Ganchos 2 e 3:** Submissão correta dos textos de `hooks[1]` e `hooks[2]`.
17. **Montagem dos Vídeos 2 e 3:** Concatenação FFmpeg sem perdas de áudio ou vídeo.
18. **Smart Resume no Boot com Hook 2 Salvo e Hook 3 Faltando:** Recuperação automática no boot sem reenvio de Hook 2.
19. **Smart Resume no Boot com Ambos os IDs Salvos:** Recuperação automática de polling/download no boot.
20. **Resiliência a Falhas:** Registro inequívoco de `error_message` no metadata ao simular erro na HeyGen.
21. **Streaming Autenticado dos 3 Vídeos:** `GET /video/1`, `/video/2` e `/video/3` entregam arquivos com Basic Auth e rejeitam sem credenciais (`HTTP 401`).
22. **Bloqueio Estático Mantido:** `/outputs/jobs/<job_id>/video_2.mp4` retorna `HTTP 403 Forbidden`.
23. **Idempotência de Consulta:** `GET /panel/video-jobs/:id` é estritamente read-only.
24. **Saúde de Produção e Não-Regressão Total:** PM2 online, PostgreSQL active, WhatsApp V1 (`CLONE`, `OK`) 100% ONLINE e Fase 2B intacta.
