# Changelog — Fase 2C: Aprovação do Piloto e Geração dos Vídeos Restantes (Ganchos 2 e 3)

**Data:** 05 de Setembro de 2026  
**Status:** CONCLUÍDO E HOMOLOGADO EM PRODUÇÃO (COM AJUSTES PÓS-REVIEW APLICADOS)  
**Repositório:** `mlapidotome/facade-checker`  

---

## 1. Visão Geral e Objetivos Atingidos

A **Fase 2C** expande a Video Engine V2 para concluir a estratégia *Pilot First* no Painel Web, permitindo:

1. **Avaliação do Piloto pelo Corretor (Marcel):**
   - No estado `PILOT_READY`, o painel exibe o player do Piloto (Vídeo 1) e disponibiliza dois botões de decisão:
     - `✅ Aprovar Piloto & Gerar Restantes (Ganchos 2 e 3)`
     - `❌ Reprovar Piloto`

2. **Reaproveitamento Estrito e Inequívoco do `body.mp4`:**
   - O corpo (`body.mp4`) gerado na Fase 2B é reutilizado diretamente na montagem dos Vídeos 2 e 3.
   - **Zero chamadas à HeyGen para renderização de novo corpo** e zero créditos consumidos desnecessariamente.
   - Proibição absoluta de varredura heurística por nome de arquivo em pastas compartilhadas.

3. **Validação Estritamente Canônica e de Segurança do Body (Pós-Review Fix 2):**
   - Derivação server-side do caminho canônico: `expectedBodyPath = path.join(jobDir, 'body.mp4')`;
   - Resolução física canônica do diretório do Job (`realJobDir = fs.realpathSync(jobDir)`);
   - Resolução física canônica do caminho esperado e do caminho informado em `metadata.pilot.body.local_path`;
   - Exigência de correspondência exata: `realGivenBodyPath === realExpectedBodyPath`;
   - Rejeição imediata de caminhos em subpastas (ex: `subpasta/body.mp4`) ou nomes divergentes;
   - Detecção e bloqueio de symlinks apontando para fora do diretório do Job (`fs.lstatSync().isSymbolicLink()`);
   - Validação de basename estrito `body.mp4`;
   - Validação de tamanho > 0 bytes;
   - Validação assíncrona estrutural via `ffprobe`: `duration > 0`, presença de pelo menos 1 stream de vídeo (`codec_type === 'video'`) e pelo menos 1 stream de áudio (`codec_type === 'audio'`).
   - Qualquer falha transita de forma limpa para `REMAINDER_FAILED` sem busca externa e sem regeneração arbitrária.

4. **Acessibilidade Contínua do Vídeo 1 (Pós-Review Fix 1):**
   - O endpoint `/api/v2/panel/video-jobs/:id/video/1` (e alias `/pilot`) permanece acessível em todos os estados posteriores à conclusão do piloto:
     `PILOT_READY`, `PILOT_REJECTED`, `REMAINDER_SUBMITTED`, `REMAINDER_RENDERING`, `REMAINDER_FAILED`, `CREATIVE_SET_READY`.
   - Vídeos 2 e 3 permanecem estritamente acessíveis apenas quando `CREATIVE_SET_READY` (retornando `HTTP 409 Conflict` antes da conclusão).

5. **Smart Retry Granular e Tratamento de Falhas Terminais:**
   - Não refaz assets já concluídos e validados:
     - Hook 2 com ID válido -> preservado (polling/download);
     - Hook 3 com ID válido -> preservado (polling/download);
     - Clips locais baixados -> download ignorado;
     - Vídeo 2 ou Vídeo 3 concatenados e íntegros (com streams de áudio/vídeo e duração positiva no `ffprobe`) -> FFmpeg ignorado;
   - **Tratamento de IDs terminais:** Se um Hook na HeyGen terminou em estado `failed`, o retry deliberado autoriza nova submissão exclusiva para aquele hook, persistindo o novo ID e incrementando `attempts`, sem reenviar o outro hook já pronto.

6. **Entrega 100% Autenticada dos 3 Vídeos:**
   - Vídeo 1 (Piloto): `GET /api/v2/panel/video-jobs/:id/video/1` (e alias `/pilot`)
   - Vídeo 2 (Aluguel vs Parcela): `GET /api/v2/panel/video-jobs/:id/video/2`
   - Vídeo 3 (Renda Familiar): `GET /api/v2/panel/video-jobs/:id/video/3`
   - Bloqueio estático rigoroso mantido (`HTTP 403 Forbidden` para qualquer acesso direto a `/outputs/jobs`).

7. **Não-Regressão Total:**
   - WhatsApp V1 (`CLONE`, `OK`, `activeVideoSessions`) 100% ONLINE e intacto.
   - Sem adição de BullMQ, Redis ou dependências externas pesadas.

---

## 2. Arquivos Modificados e Criados

| Arquivo | Tipo | Descrição |
|---|---|---|
| `migrations/003_add_creative_set_fields.sql` | NOVO | Adiciona colunas `video2_url`, `video3_url` e índice composto `idx_video_jobs_creative_status`. |
| `video_engine/pilot_service.js` | MODIFICADO | Validação canônica estrita do body (`realpathSync`, anti-symlink, `ffprobe`), `lockAndSubmitRemainder()`, `rejectPilot()`, `generateRemainderVideos()`, tratamento de falha terminal de IDs da HeyGen e `initStartupRecovery()` expandido. Concatenação FFmpeg 100% assíncrona. |
| `video_engine/api_v2.js` | MODIFICADO | Rotas `/approve-pilot`, `/reject-pilot` e rota unificada `/video/:index` permitindo Vídeo 1 em todos os estados pós-piloto e Vídeos 2 e 3 exclusivamente em `CREATIVE_SET_READY`. |
| `video-painel.html` | MODIFICADO | Botões de decisão (Aprovar / Reprovar), polling para `CREATIVE_SET_READY`, banner de retry com feedback de erro e grade responsiva dos 3 players com download direto. |
| `gestor_server.js` | MODIFICADO | Bloqueio global de `/outputs/jobs` antes de qualquer middleware de arquivos estáticos. |

---

## 3. Homologação e Resultados dos Testes

A suíte automatizada cobriu **33 cenários de homologação** no VPS com **100% de sucesso (Exit code 0)**:

1. **Aprovação Nominal de `PILOT_READY`:** Retorno HTTP 202 e transição registrada (`PASSOU`).
2. **Reprovação de `PILOT_READY`:** Transição atômica para `PILOT_REJECTED` com timestamp gravado (`PASSOU`).
3. **Concorrência Atômica:** Duas requisições simultâneas de aprovação resultaram em exatamente um 202 e um 409 (`PASSOU`).
4. **Reuso Estrito do Body:** Leitura direta de `outputs/jobs/<job_id>/body.mp4` sem chamadas de API (`PASSOU`).
5. **Body com Tamanho Zero:** Bloqueado imediatamente com erro explícito (`PASSOU`).
6. **Body com Path Traversal:** Tentativa de fuga de diretório rejeitada (`PASSOU`).
7. **[OBRIGATÓRIO] Symlink Externo:** Resolução canônica `realpathSync` identificou e barrou link simbólico para fora do job (`PASSOU`).
8. **[OBRIGATÓRIO] Body sem Stream de Áudio:** Análise `ffprobe` detectou ausência de faixa de áudio e rejeitou (`PASSOU`).
9. **[OBRIGATÓRIO] Body sem Stream de Vídeo:** Análise `ffprobe` detectou ausência de faixa de vídeo e rejeitou (`PASSOU`).
10. **Body com Duração Zero:** Container corrompido ou truncado barrado via `ffprobe` (`PASSOU`).
11. **Smart Retry com Hook 2 Salvo:** Hook 2 mantido intacto sem reenvio à HeyGen (`PASSOU`).
12. **Smart Retry com Hook 3 Salvo:** Hook 3 mantido intacto sem reenvio à HeyGen (`PASSOU`).
13. **[OBRIGATÓRIO] Smart Retry com Vídeo 2 Inválido (sem áudio):** Arquivo corrompido descartado e reconcatenado (`PASSOU`).
14. **Smart Retry com Vídeo 2 Válido:** Arquivo íntegro preservado sem retrabalho FFmpeg (`PASSOU`).
15. **Smart Retry com Clips Baixados:** Download pulado quando arquivos locais existem (`PASSOU`).
16. **Snapshot dos Roteiros:** Textos e looks dos Ganchos 2 e 3 preservados com precisão (`PASSOU`).
17. **Montagem Assíncrona via FFmpeg:** Concatenação executada com streams de áudio e vídeo validados (`PASSOU`).
18. **Smart Resume com Hook 2 Salvo e Hook 3 Faltando:** Identificação precisa do delta pendente no boot (`PASSOU`).
19. **Smart Resume com Ambos os IDs Salvos:** Nenhum clip reenviado no boot (`PASSOU`).
20. **Resiliência a Falhas:** Transição limpa para `REMAINDER_FAILED` com gravação de `error_message` (`PASSOU`).
21. **Streaming Autenticado dos 3 Vídeos:** `GET /video/1`, `/video/2` e `/video/3` entregam arquivos com HTTP Basic Auth e retornam 401 sem credenciais (`PASSOU`).
22. **Bloqueio Estático em `/outputs/jobs`:** Retorna `HTTP 403 Forbidden` (`PASSOU`).
23. **Idempotência de Consulta:** `GET /panel/video-jobs/:id` é estritamente read-only (`PASSOU`).
24. **Não-Regressão Total:** WhatsApp V1 online e intacto, PostgreSQL ativo, PM2 saudável (`PASSOU`).
25. **[EXTRA] Hook 2 Terminalmente FAILED + Hook 3 Pronto:** Detecção de falha terminal confirmada; autorização de reenvio exclusivo para o gancho com falha (`PASSOU`).
26. **[FIX 1] `/video/1` em `REMAINDER_SUBMITTED`:** Retorna `HTTP 200 OK` com arquivo do piloto (`PASSOU`).
27. **[FIX 1] `/video/1` em `REMAINDER_RENDERING`:** Retorna `HTTP 200 OK` com arquivo do piloto (`PASSOU`).
28. **[FIX 1] `/video/1` em `REMAINDER_FAILED`:** Retorna `HTTP 200 OK` com arquivo do piloto (`PASSOU`).
29. **[FIX 1] `/video/1` em `PILOT_REJECTED`:** Retorna `HTTP 200 OK` com arquivo do piloto (`PASSOU`).
30. **[FIX 1] `/video/2` e `/video/3` antes de `CREATIVE_SET_READY`:** Retornam estritamente `HTTP 409 Conflict` (`PASSOU`).
31. **[FIX 2] Body em subpasta (`<jobDir>/subpasta/body.mp4`):** Rejeitado com erro explícito de divergência canônica (`PASSOU`).
32. **[FIX 2] Body no caminho canônico exato (`<jobDir>/body.mp4`):** Aceito com sucesso (`PASSOU`).
33. **[FIX 2] Symlink externo em `body.mp4`:** Rejeitado pela verificação de equivalência física canônica (`PASSOU`).

---

## 4. Jobs de Referência na Homologação

* **Job Showcase Completo (Coleção Criativa Pronta):**
  * **UUID:** `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b`
  * **Status:** `CREATIVE_SET_READY`
  * **Imóvel:** `#1639` (Itacorubi, Florianópolis)
  * **Vídeo 1 (Piloto):** `/api/v2/panel/video-jobs/bbddf3ba-f7c6-44f5-a81a-2ac09dae611b/video/1` (HTTP 200)
  * **Vídeo 2:** `/api/v2/panel/video-jobs/bbddf3ba-f7c6-44f5-a81a-2ac09dae611b/video/2` (HTTP 200)
  * **Vídeo 3:** `/api/v2/panel/video-jobs/bbddf3ba-f7c6-44f5-a81a-2ac09dae611b/video/3` (HTTP 200)