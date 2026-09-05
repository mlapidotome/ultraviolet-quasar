# Proposta Arquitetural & Plano de Implementação — Fase 2C
## Aprovação do Piloto e Geração dos Vídeos Restantes (Ganchos 2 e 3)

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2C (Aprovação / Reprovação do Piloto e Conclusão do Creative Set)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Após o Job atingir o estado `PILOT_READY` na Fase 2B, permitir que Marcel avalie o vídeo piloto no painel e decida entre **APROVAR** ou **REPROVAR**.  
Se aprovado, o sistema reaproveita o `body.mp4` **já existente e vinculado ao Job**, gera exclusivamente os Ganchos 2 e 3 na HeyGen, monta os Vídeos 2 e 3 via FFmpeg e entrega a coleção criativa completa (3 vídeos), **sem regenerar o corpo, sem gastar créditos duplicados na HeyGen, com concorrência atômica, Smart Resume parcial e entrega 100% autenticada**.

---

## 1. Diagnóstico do Fluxo Legado (`OK / GERAR RESTANTE` no WhatsApp)

A inspeção em `/var/www/bali-gestor/video_anuncios_engine.js` (linhas 580 a 635) evidenciou os seguintes acoplamentos no fluxo legado:

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

1. **O `body.mp4` é um Asset Exclusivo e Inequívoco do `job_id`:**  
   O arquivo de corpo utilizado na concatenação dos Vídeos 2 e 3 é **estritamente aquele gerado na Fase 2B**, localizado em:
   `/var/www/bali-gestor/outputs/jobs/<job_id>/body.mp4`
   e referenciado em `video_jobs.metadata.pilot.body.local_path`.  
   **É expressamente proibido:**
   * Procurar arquivos por nome genérico em `outputs/`;
   * Executar `readdirSync` para encontrar "o último body";
   * Regenerar o corpo automaticamente (desperdiçando créditos);
   * Utilizar body de outro Job;
   * Utilizar body de outro imóvel apenas porque `property_ref` coincide.  
   *Se o arquivo físico do body não existir ou não for validado, a operação é interrompida imediatamente com falha explícita (`REMAINDER_FAILED`).*

2. **Transição Atômica de Concorrência no PostgreSQL:**  
   A ação de aprovação e início da renderização dos restantes deve ser **100% atômica no banco de dados**:
   ```sql
   UPDATE video_jobs
   SET status = 'REMAINDER_SUBMITTED', updated_at = NOW()
   WHERE id = $1
     AND status IN ('PILOT_READY', 'REMAINDER_FAILED')
   RETURNING *;
   ```
   - **Somente a requisição que obtiver linha no `RETURNING`** inicia as chamadas à HeyGen.
   - Chamadas concorrentes simultâneas recebem `HTTP 409 Conflict` se já em andamento (`REMAINDER_SUBMITTED` ou `REMAINDER_RENDERING`), ou `HTTP 200 OK` se o conjunto já estiver pronto (`CREATIVE_SET_READY`).

3. **Entrega de Vídeos 100% Autenticada:**  
   - O diretório `/outputs/jobs/` permanece **estritamente bloqueado contra acesso estático público (`HTTP 403 Forbidden`)**.
   - Os 3 vídeos são servidos por rotas autenticadas com HTTP Basic Auth:
     - Vídeo 1 (Piloto): `GET /api/v2/panel/video-jobs/:id/pilot` (ou `/video/1`)
     - Vídeo 2 (Gancho 2 + Body): `GET /api/v2/panel/video-jobs/:id/video/2`
     - Vídeo 3 (Gancho 3 + Body): `GET /api/v2/panel/video-jobs/:id/video/3`
   - Validação anti-path-traversal e streaming nativo via `res.sendFile()`.

4. **Smart Resume no Boot para Qualquer Combinação Parcial:**  
   O recovery de inicialização do servidor (`initStartupRecovery()`) deve cobrir todos os estados parciais:
   - Se Hook 2 já tem ID e Hook 3 não: submete apenas Hook 3.
   - Se Hook 3 já tem ID e Hook 2 não: submete apenas Hook 2.
   - Se ambos os IDs existem: reassume polling sem reenviar nada à HeyGen.
   - Se os clips foram baixados mas a concatenação do Vídeo 3 falhou: executa apenas a concatenação pendente.
   - **Nunca refaz um asset já gerado e validado.**

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
                                            │ Submete Hook 2 & 3
                                            ▼
                                ┌───────────────────────┐
                                │  REMAINDER_RENDERING  │
                                └─────┬───────────┬─────┘
                     Sucesso Total    │           │ Falha (HeyGen/FFmpeg)
                                      ▼           ▼
                         ┌────────────────────┐ ┌────────────────────┐
                         │ CREATIVE_SET_READY │ │  REMAINDER_FAILED  │
                         └────────────────────┘ └─────────┬──────────┘
                                                          │ Retry
                                                          └───────────► REMAINDER_SUBMITTED
```

| Estado | Significado | Ações Permitidas |
|---|---|---|
| `PILOT_READY` | Vídeo Piloto gerado e disponível para avaliação. | Marcel pode clicar em **"Aprovar Piloto"** ou **"Reprovar Piloto"**. |
| `PILOT_REJECTED` | Piloto reprovado por Marcel. Pipeline paralisado. | Exibe aviso no painel; não gera assets adicionais. Permite arquivamento ou reinício futuro. |
| `REMAINDER_SUBMITTED` | Aprovação registrada via lock atômico; clips 2 e 3 sendo despachados. | Painel desabilita botões e exibe spinner de processamento. |
| `REMAINDER_RENDERING` | HeyGen processando Ganchos 2 e 3; polling ativo. | Painel realiza polling read-only (`GET /api/v2/panel/video-jobs/:id`). |
| `CREATIVE_SET_READY` | Ganchos 2 e 3 baixados e concatenados com o mesmo `body.mp4`. Os 3 vídeos estão prontos. | Painel exibe os 3 players de vídeo e botões de download. |
| `REMAINDER_FAILED` | Erro na HeyGen, download ou FFmpeg para Ganchos 2 ou 3. | Painel exibe mensagem de erro e botão **"Tentar Novamente"**. |

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
O campo `metadata` passa a armazenar o histórico completo do Creative Set:

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
      "concatenated_at": "2026-09-05T03:11:35.000Z"
    },
    "video3": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/<job_id>/video_3.mp4",
      "authenticated_url": "/api/v2/panel/video-jobs/<job_id>/video/3",
      "size_bytes": 4792180,
      "concatenated_at": "2026-09-05T03:11:45.000Z"
    },
    "attempts": 1,
    "completed_at": "2026-09-05T03:11:45.000Z"
  }
}
```

---

## 5. Orquestração do Smart Resume Parcial (Fase 2C)

A função `initStartupRecovery()` é expandida para inspecionar Jobs com `status IN ('PILOT_SUBMITTED', 'PILOT_RENDERING', 'REMAINDER_SUBMITTED', 'REMAINDER_RENDERING')`:

1. **Para Jobs em `REMAINDER_SUBMITTED` ou `REMAINDER_RENDERING`:**
   - Verifica se `updated_at > 30 min`: marca `REMAINDER_FAILED` com mensagem de timeout.
   - Se dentro da janela de tempo:
     - **Passo A (Garantia do Body):** Valida a existência física de `outputs/jobs/<job_id>/body.mp4`. Se ausente, interrompe com `REMAINDER_FAILED`.
     - **Passo B (Hook 2):** Se `metadata.remainder.hook2.heygen_video_id` existir, **NUNCA ressubmete**. Se não existir, submete apenas Hook 2 à HeyGen e grava o ID.
     - **Passo C (Hook 3):** Se `metadata.remainder.hook3.heygen_video_id` existir, **NUNCA ressubmete**. Se não existir, submete apenas Hook 3 à HeyGen e grava o ID.
     - **Passo D (Downloads):** Baixa apenas os clips cujos arquivos locais `hook_2.mp4` ou `hook_3.mp4` ainda não existirem no disco.
     - **Passo E (Concatenações FFmpeg):**
       - Se `video_2.mp4` já existir e tiver tamanho válido, pula para o Vídeo 3.
       - Se `video_2.mp4` estiver pendente, concatena `hook_2.mp4 + body.mp4`.
       - Se `video_3.mp4` estiver pendente, concatena `hook_3.mp4 + body.mp4`.
     - Ao concluir com sucesso, atualiza para `CREATIVE_SET_READY`.

---

## 6. Fluxos de Aprovação e Reprovação no Backend

### 6.1. Rota de Aprovação: `POST /api/v2/panel/video-jobs/:id/approve-pilot`
* **Proteção:** `panelAuthMiddleware`.
* **Fluxo:**
  1. Executa lock atômico SQL:
     `UPDATE video_jobs SET status = 'REMAINDER_SUBMITTED' WHERE id = $1 AND status IN ('PILOT_READY', 'REMAINDER_FAILED') RETURNING *;`
  2. Se 0 linhas:
     - Se `REMAINDER_SUBMITTED` ou `RENDERING`: retorna `HTTP 409 Conflict`.
     - Se `CREATIVE_SET_READY`: retorna `HTTP 200 OK` informando que os 3 vídeos já estão prontos.
     - Outro status: retorna `HTTP 400 Bad Request`.
  3. Se 1 linha atualizada:
     - Inicia processamento assíncrono em `pilotService.generateRemainderVideos(jobId)`.
     - Retorna imediatamente `HTTP 202 Accepted { success: true, status: 'REMAINDER_SUBMITTED' }`.

### 6.2. Rota de Reprovação: `POST /api/v2/panel/video-jobs/:id/reject-pilot`
* **Proteção:** `panelAuthMiddleware`.
* **Fluxo:**
  1. Executa transição atômica:
     ```sql
     UPDATE video_jobs
     SET status = 'PILOT_REJECTED', 
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pilot,rejected_at}', to_jsonb(NOW()::text)),
         updated_at = NOW()
     WHERE id = $1 AND status = 'PILOT_READY'
     RETURNING *;
     ```
  2. Se 0 linhas: retorna `HTTP 400 Bad Request` ou `HTTP 404`.
  3. Se 1 linha: retorna `HTTP 200 OK { success: true, status: 'PILOT_REJECTED' }`.
  4. Nenhum vídeo adicional é gerado.

---

## 7. Rota Autenticada de Entrega dos Vídeos (1, 2 e 3)

### Endpoint Unificado: `GET /api/v2/panel/video-jobs/:id/video/:index`
* **Parâmetros:** `:id` (UUID), `:index` (`1`, `2` ou `3`).
* *(Para retrocompatibilidade: `GET /api/v2/panel/video-jobs/:id/pilot` continua funcionando como alias para o Vídeo 1).*
* **Segurança:**
  1. Protegido por `panelAuthMiddleware`.
  2. Valida UUID do `:id` e índice numérico (`1`, `2` ou `3`).
  3. Consulta o Job no PostgreSQL.
  4. Se índice `1`: requer status `PILOT_READY` ou `CREATIVE_SET_READY`.
  5. Se índices `2` ou `3`: requer status `CREATIVE_SET_READY`.
  6. Valida que o arquivo físico reside estritamente em `outputs/jobs/<job_id>/` (anti-path-traversal).
  7. Serve o arquivo com `res.sendFile()` (suporte a *HTTP 206 Partial Content* para player).

---

## 8. Alterações na Interface Web (`video-painel.html`)

A interface ganha os seguintes recursos:

1. **Card de Decisão do Piloto (quando `status === 'PILOT_READY'`):**
   - Dois botões lado a lado:
     - `✅ Aprovar Piloto & Gerar Restantes (Ganchos 2 e 3)`
     - `❌ Reprovar Piloto`
2. **Estado de Processamento dos Restantes (quando `REMAINDER_SUBMITTED` ou `RENDERING`):**
   - Spinner ativo e badge roxo/amarelo:
     *"⏳ Renderizando Ganchos 2 e 3 na HeyGen e montando com o corpo original..."*
   - Polling automático a cada 5 segundos via `GET /api/v2/panel/video-jobs/:id`.
3. **Exibição da Coleção Completa (quando `status === 'CREATIVE_SET_READY'`):**
   - Card verde: `🎉 COLEÇÃO CRIATIVA PRONTA (3 VÍDEOS COMPLETOS)`.
   - Grade responsiva com 3 players de vídeo individuais:
     - **Vídeo 1 (Choque / Entrada):** Look Terno + Gancho 1 + Corpo Imóvel (`/video/1`).
     - **Vídeo 2 (Aluguel vs Parcela):** Look Podcaster + Gancho 2 + Corpo Imóvel (`/video/2`).
     - **Vídeo 3 (Renda Familiar):** Look Casual + Gancho 3 + Corpo Imóvel (`/video/3`).
   - Botões de download direto autenticado para cada um dos 3 vídeos.
4. **Estado de Reprovação (quando `status === 'PILOT_REJECTED'`):**
   - Badge cinza/vermelho `PILOT_REJECTED`.
   - Mensagem: *"Vídeo piloto reprovado. Nenhuma produção adicional foi disparada."*

---

## 9. Arquivos a Criar e Modificar

1. **`migrations/003_add_creative_set_fields.sql` [NOVO]:**
   - Adiciona `video2_url` e `video3_url` à tabela `video_jobs`.

2. **`video_engine/pilot_service.js` [MODIFICAR]:**
   - Adicionar funções:
     - `lockAndSubmitRemainder(jobId)`: transição atômica SQL para aprovação;
     - `rejectPilot(jobId)`: transição atômica SQL para reprovação;
     - `generateRemainderVideos(jobId)`: orquestra geração dos Ganchos 2 e 3, reuso do body existente e FFmpeg;
     - Atualizar `initStartupRecovery()` para cobrir os novos estados e casos parciais da Fase 2C.

3. **`video_engine/api_v2.js` [MODIFICAR]:**
   - `POST /api/v2/panel/video-jobs/:id/approve-pilot`: aciona lock e geração dos restantes.
   - `POST /api/v2/panel/video-jobs/:id/reject-pilot`: registra reprovação limpa do piloto.
   - `GET /api/v2/panel/video-jobs/:id/video/:index`: rota autenticada para streaming dos vídeos 1, 2 e 3.

4. **`video-painel.html` [MODIFICAR]:**
   - Adicionar botões de Aprovar e Reprovar piloto.
   - Polling de estado para `CREATIVE_SET_READY`.
   - Renderização da grade dos 3 players de vídeo e botões de download.

---

## 10. O Que Permanece Rigorosamente Intocado

* ❌ **WhatsApp V1 Intacto:** Fluxo `#REF`, `CLONE`, `OK` e `activeVideoSessions` permanecem 100% inalterados.
* ❌ **Sem BullMQ / Redis:** Processamento assíncrono controlado localmente com lock no PostgreSQL e recovery no boot.
* ❌ **Sem ferramentas de edição de timeline ou troca de avatars**.
* ❌ **Sem integração externa com Meta Ads / Facebook**.

---

## 11. Bateria de Testes e Homologação da Fase 2C

1. **Aprovação Nominal de `PILOT_READY`:**  
   Submissão de `POST /approve-pilot` para Job em `PILOT_READY`. Valida retorno `HTTP 202 Accepted` e transição para `REMAINDER_SUBMITTED`.
2. **Reprovação de `PILOT_READY`:**  
   Submissão de `POST /reject-pilot` para Job em `PILOT_READY`. Valida retorno `HTTP 200 OK`, transição para `PILOT_REJECTED` e interrupção do pipeline.
3. **Concorrência Atômica na Aprovação:**  
   Duas chamadas simultâneas de aprovação: exatamente uma recebe `HTTP 202 Accepted`; a segunda recebe `HTTP 409 Conflict`.
4. **Reaproveitamento Estrito do Body Existente:**  
   Comprovar que `outputs/jobs/<job_id>/body.mp4` é lido diretamente do disco; zero chamadas à HeyGen para renderização de novo corpo.
5. **Geração dos Ganchos 2 e 3:**  
   Validação da submissão dos textos e looks de `hooks[1]` e `hooks[2]`, com persistência imediata dos `heygen_video_id`.
6. **Montagem dos Vídeos 2 e 3:**  
   Comprovar que o FFmpeg monta:
   - `video_2.mp4` = `hook_2.mp4 + body.mp4`
   - `video_3.mp4` = `hook_3.mp4 + body.mp4`
7. **Smart Resume no Boot com Hook 2 Salvo e Hook 3 Faltando:**  
   Simular boot; comprovar que o Hook 2 não é reenviado e apenas o Hook 3 é despachado.
8. **Smart Resume no Boot com Ambos os IDs Salvos:**  
   Comprovar que o sistema retoma apenas polling/download/FFmpeg sem reenviar nenhum clip.
9. **Smart Resume com Vídeo 2 Pronto e Vídeo 3 Faltando:**  
   Comprovar que o Vídeo 2 não é reconcatenado, finalizando apenas o Vídeo 3.
10. **Resiliência a Falhas:**  
    Simular falha em Hook 2, Hook 3 ou FFmpeg; comprovar transição para `REMAINDER_FAILED` com gravação de `error_message` e possibilidade de retry.
11. **Streaming Autenticado dos 3 Vídeos:**  
    Validar que `GET /video/1`, `GET /video/2` e `GET /video/3` entregam os respectivos arquivos com Basic Auth e rejeitam sem credenciais.
12. **Bloqueio Estático Mantido:**  
    Acesso direto a `/outputs/jobs/<job_id>/video_2.mp4` e `/video_3.mp4` retorna `HTTP 403 Forbidden`.
13. **Idempotência do GET de Consulta:**  
    `GET /api/v2/panel/video-jobs/:id` retorna os metadados dos 3 vídeos sem qualquer alteração de estado.
14. **Saúde de Produção e Não-Regressão Total:**  
    PM2 online, PostgreSQL active, WhatsApp V1 100% ONLINE e Fase 2B intacta.
