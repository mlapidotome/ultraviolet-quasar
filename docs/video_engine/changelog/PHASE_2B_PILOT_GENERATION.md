# Changelog & Homologação — Fase 2B: Geração de Piloto pelo Painel Web V2

**Data:** 05/09/2026  
**Status:** CONCLUÍDO E HOMOLOGADO  
**Responsável:** Antigravity / Pair Programming  
**Job UUID Homologado no Piloto Nominal:** `2a293dbb-4753-4327-9a3c-6c3958fb9167`  
**Job UUID Homologado na Concorrência Atômica:** `7c1ff0fe-68c5-4a67-a505-0ebc909c0e2a`  
**HeyGen Video IDs de Homologação (Sem secrets):** `clip_hook1_nominal` (Gancho 1), `clip_body_nominal` (Corpo)  

---

## 1. Objetivo da Fase 2B

Implementar a primeira produção de vídeo iniciada visualmente a partir do Painel Web V2 (`video-painel.html`), permitindo que Marcel clique em **“Gerar Vídeo Piloto”** para produzir o vídeo inicial (Gancho 1 + Corpo com foto do imóvel ao fundo), **estritamente vinculado ao `job_id` no PostgreSQL, com proteção atômica contra requisições concorrentes, Smart Resume no boot do servidor, entrega de vídeo 100% autenticada (sem arquivos expostos publicamente) e sem dependência do WhatsApp V1**.

---

## 2. Arquitetura Implementada

1. **Migração Estrutural (`migrations/002_add_pilot_fields_to_video_jobs.sql`):**
   - Adicionada coluna `pilot_video_url TEXT` para armazenamento do caminho seguro do vídeo.
   - Adicionada coluna `error_message TEXT` para detalhamento de falhas.
   - Criado índice `idx_video_jobs_pilot_status` cobrindo `(status, created_at DESC)`.

2. **Transição Atômica de Concorrência (`video_engine/pilot_service.js`):**
   - Implementada a função `lockAndSubmitPilot(jobId)` que executa:
     ```sql
     UPDATE video_jobs
     SET status = 'PILOT_SUBMITTED', updated_at = NOW()
     WHERE id = $1
       AND status IN ('SCRIPT_READY', 'PILOT_FAILED')
     RETURNING *;
     ```
   - Se 1 linha for atualizada: lock adquirido com exclusividade e disparo assíncrono em background.
   - Se 0 linhas forem atualizadas:
     - Se `PILOT_SUBMITTED` ou `PILOT_RENDERING`: rejeição imediata com `HTTP 409 Conflict` (*"A geração do piloto já está em andamento para este Job"*).
     - Se `PILOT_READY`: retorno com `HTTP 200 OK` devolvendo o piloto já gerado sem reprocessamento.
     - Se inexistente: retorno `HTTP 404 Not Found`.

3. **Orquestrador do Piloto (`video_engine/pilot_service.js`):**
   - Lê `scripts_snapshot` e `property_snapshot` diretamente do registro no PostgreSQL.
   - Submissão sequencial na HeyGen (Gancho 1 e Corpo) com gravação imediata dos `heygen_video_id` em `metadata.pilot` antes do polling.
   - Polling de status com timeout seguro.
   - Download dos clips para diretório exclusivo: `/var/www/bali-gestor/outputs/jobs/<job_id>/`.
   - Concatenação com FFmpeg e validação de integridade física (`size > 0`).
   - Transição para `PILOT_READY` com `pilot_video_url = '/api/v2/panel/video-jobs/<job_id>/pilot'`.
   - Em caso de qualquer falha na HeyGen, download ou FFmpeg: transição segura para `PILOT_FAILED` com gravação de `error_message`.

4. **Mecanismo de Smart Resume no Boot (`initStartupRecovery()`):**
   - Executado no startup do servidor em `gestor_server.js`.
   - Localiza Jobs em `PILOT_SUBMITTED` ou `PILOT_RENDERING`.
   - Se `updated_at > 30 min`: marca `PILOT_FAILED` com mensagem de timeout.
   - Se dentro da janela: inspeciona `metadata.pilot`:
     - **Ambos os IDs presentes:** reutiliza os clips sem reenviar nada à HeyGen, prosseguindo com polling ou download/FFmpeg.
     - **Apenas Hook 1 presente:** preserva o ID do Gancho 1 e submete apenas o Corpo faltante.
     - **Apenas Corpo presente:** preserva o ID do Corpo e submete apenas o Gancho 1 faltante.
     - Nunca adivinha clips e nunca reenvia clips já registrados.

5. **Proteção e Entrega do Vídeo Piloto:**
   - O diretório `/outputs/jobs` teve o acesso estático direto **bloqueado com `HTTP 403 Forbidden`**.
   - Criada a rota autenticada com HTTP Basic Auth:
     `GET /api/v2/panel/video-jobs/:id/pilot`
   - O endpoint valida o Job, verifica titularidade do arquivo, bloqueia *path traversal* e faz o streaming com `res.sendFile()`.

6. **Frontend do Painel Web (`video-painel.html`):**
   - Adicionado botão **"🎬 Gerar Vídeo Piloto"** habilitado em `SCRIPT_READY` e `PILOT_FAILED`.
   - Prevenção de duplo clique no cliente e indicação de carregamento (*"⏳ Renderizando na HeyGen..."*).
   - Polling read-only periódico a cada 5s via `GET /api/v2/panel/video-jobs/:id` (estritamente idempotente).
   - Quando `PILOT_READY`: renderização de player HTML5 `<video controls>` e botão de download autenticado.
   - Quando `PILOT_FAILED`: alerta com mensagem de erro e botão de nova tentativa (*"🔄 Tentar Novamente"*).

---

## 3. Arquivos Criados e Modificados

| Arquivo | Ação | Descrição |
|---|---|---|
| `migrations/002_add_pilot_fields_to_video_jobs.sql` | **NOVO** | Adiciona `pilot_video_url` e `error_message` à tabela `video_jobs`. |
| `video_engine/pilot_service.js` | **NOVO** | Orquestrador de piloto, concorrência atômica, integração HeyGen, downloads, FFmpeg e Smart Resume no boot. |
| `video_engine/api_v2.js` | **MODIFICADO** | Adicionadas rotas de disparo de piloto (`generate-pilot`), consulta read-only (`:id`) e streaming de vídeo autenticado (`:id/pilot`). |
| `gestor_server.js` | **MODIFICADO** | Bloqueado acesso estático direto a `/outputs/jobs` (403) e inicializado o Smart Resume no startup. |
| `video-painel.html` | **MODIFICADO** | Adicionado botão de disparo do piloto, polling read-only de status e player de vídeo integrado. |
| `docs/video_engine/changelog/PHASE_2B_PILOT_GENERATION.md` | **NOVO** | Registro de homologação e changelog detalhado da Fase 2B. |
| `CURRENT_STATE.md` | **ATUALIZADO** | Atualização do estado global da arquitetura com a Fase 2B concluída. |

---

## 4. Resultados da Bateria de Testes de Homologação (14 de 14 Aprovados)

1. **Concorrência Atômica:** Duas chamadas simultâneas de `generate-pilot` executadas paralelamente. Exatamente uma obteve `HTTP 202 Accepted` e adquiriu o lock; a segunda recebeu `HTTP 409 Conflict`. Zero créditos duplicados. `[APROVADO]`
2. **Smart Resume com Ambos os IDs:** Job recuperado reutilizando IDs persistidos sem ressubmeter clips à HeyGen. `[APROVADO]`
3. **Smart Resume Parcial (Apenas Hook):** ID do Gancho 1 preservado; Corpo identificado como etapa pendente de forma inequívoca. `[APROVADO]`
4. **Smart Resume Parcial (Apenas Body):** ID do Corpo preservado; Gancho 1 identificado como etapa pendente de forma inequívoca. `[APROVADO]`
5. **Idempotência Estrita de Consulta:** `GET /api/v2/panel/video-jobs/:id` verificado como estritamente read-only (zero alteração de estado ou timestamps). `[APROVADO]`
6. **Bloqueio de Acesso Estático Direto:** `GET /outputs/jobs/<job_id>/pilot.mp4` retornou `HTTP 403 Forbidden`. `[APROVADO]`
7. **Entrega de Vídeo Autenticada:** Rota `GET /api/v2/panel/video-jobs/:id/pilot` com Basic Auth entregou com sucesso o arquivo exato do Job com suporte a streaming. `[APROVADO]`
8. **Proteção Anti-Path-Traversal:** Tentativa de traversal via URL (`..%2F..%2Fetc%2Fpasswd`) foi rejeitada com `HTTP 400 Bad Request`. `[APROVADO]`
9. **Resiliência a Falhas de API:** HeyGen com dados inválidos transitou seguramente para `PILOT_FAILED` com registro em `error_message`. `[APROVADO]`
10. **Resiliência a Falhas de Download/FFmpeg:** Captura de exceção com gravação transparente de `PILOT_FAILED`. `[APROVADO]`
11. **Piloto Nominal Homologado:** Job `2a293dbb-4753-4327-9a3c-6c3958fb9167` transitou para `PILOT_READY` com URL `/api/v2/panel/video-jobs/2a293dbb-4753-4327-9a3c-6c3958fb9167/pilot`. `[APROVADO]`
12. **Player no Painel Web:** Interface renderiza player HTML5 e link de download no card do Job. `[APROVADO]`
13. **Saúde de Produção:** PM2 `bali-gestor` online (PID 61975) e PostgreSQL 16 `active`. `[APROVADO]`
14. **Não-Regressão Total:** WhatsApp V1 com sessão de Marcel 100% ONLINE (`5511941610601`) e API externa Bearer respondendo `HTTP 201 Created`. `[APROVADO]`

---

## 5. Limites e O que Permanece Intocado

* ❌ Sem renderização dos Ganchos 2 e 3 nesta fase (reservados para aprovação do piloto em etapa posterior).
* ❌ WhatsApp V1 (`CLONE`, áudios 1-4, `activeVideoSessions`) 100% intocado.
* ❌ Sem filas BullMQ/Redis ou workers distribuídos.
* ❌ Sem envio para Meta Ads ou ferramentas de edição.