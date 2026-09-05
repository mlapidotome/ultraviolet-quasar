# Changelog: Fase 1D — Job API Mínima HTTP

**Data de Conclusão:** 04/09/2026  
**Status:** HOMOLOGADO E CONCLUÍDO COM SUCESSO  
**Job de Homologação HTTP Real (UUID):** `20e570ee-dadc-438a-9d7f-491807ffa1cb`  
**Endpoint:** `POST /api/v2/video-jobs`  
**Autenticação:** `Authorization: Bearer <VIDEO_ENGINE_API_KEY>` (injetada exclusivamente via `.env`)  
**Identificador Canônico Injetado:** `broker_id = 'marcel'`  
**Origem:** `source = 'web'`  

---

## 1. O Que Foi Desenvolvido

1. **Roteador HTTP Isolado (`video_engine/api_v2.js`)**:
   - Implementado como um Express Router modular e independente.
   - Montado no `gestor_server.js` com uma única linha sem tocar na V1:
     `app.use('/api/v2', require('./video_engine/api_v2'));`
   - Consome diretamente o `jobService.initializeVideoJob()` homologado na Fase 1C.

2. **Segurança Estrita e Padronizada**:
   - Middleware `requireBearerAuth` exige o header padronizado `Authorization: Bearer <TOKEN>`.
   - Chave `VIDEO_ENGINE_API_KEY` mantida estritamente no arquivo `/var/www/bali-gestor/.env` com permissão restrita 600.
   - A chave não é exposta, não é versionada e não é exibida em logs ou relatórios.
   - Requisições sem token ou com token inválido são rejeitadas com `HTTP 401 Unauthorized`.

3. **Contrato HTTP Restrito e Protegido**:
   - Request body aceita exclusivamente:
     ```json
     {
       "property_ref": "1639"
     }
     ```
   - O campo `broker_id` não é aceito do cliente; o adaptador HTTP injeta internamente o valor `'marcel'`.
   - Validação de schema rejeita requisições sem `property_ref` com `HTTP 400 Bad Request`.
   - Imóvel inexistente no CRM retorna `HTTP 404 Not Found`.

4. **Mapeamento Semântico para Modo Degradado (Fail-Open -> HTTP 503)**:
   - Se o banco de dados PostgreSQL estiver offline, o Job Core executa com sucesso em memória (`job: null`), preservando o fail-open da V1.
   - Na camada HTTP, como o endpoint tem a finalidade de criar um Job persistente, a ausência de `job_id` é mapeada para **`HTTP 503 Service Unavailable`** com `success: false` e código `PERSISTENCE_UNAVAILABLE`, devolvendo os dados calculados de imóvel e roteiro.

5. **Isolamento Total da Produção V1**:
   - O WhatsApp V1 continua operando 100% inalterado.
   - A memória de sessão `activeVideoSessions` continua exclusiva do WhatsApp V1.
   - Zero alterações em HeyGen, FFmpeg, Cloudflare R2 ou renderizadores.

---

## 2. Diagrama Arquitetural Homologado

```
                              [Cliente HTTP Externo]
                              POST /api/v2/video-jobs
                              Header: Authorization: Bearer <KEY>
                              Body: { "property_ref": "1639" }
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            gestor_server.js                                 │
│  app.use('/api/v2', videoApiV2) ──────────────────────────┐                 │
└───────────────────────────────────────────────────────────┼─────────────────┘
                                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        video_engine/api_v2.js                               │
│  1. [requireBearerAuth]      -> Valida Bearer Token                         │
│  2. [Schema Validation]      -> Exige property_ref; fixa broker_id='marcel' │
│  3. [Delegação ao Core]      -> initializeVideoJob({ ref, marcel, web })    │
│  4. [Mapeamento de Status]   -> HTTP 201 (Sucesso)                          │
│                                 HTTP 503 (DB Offline)                       │
│                                 HTTP 404 (Não Encontrado)                   │
│                                 HTTP 400 (Parâmetro Inválido)               │
│                                 HTTP 401 (Não Autorizado)                   │
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     video_engine/job_service.js (Job Core)                  │
│  • fetchImovelData(ref)                                                     │
│  • generateCompleteScripts(imovel)                                          │
│  • createVideoJob({ property_ref, broker_id: "marcel", source: "web" })     │
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
                                            ▼
                                  PostgreSQL (video_jobs)
```

---

## 3. Resultados dos 10 Testes de Homologação

| # | Teste Executado | Cenário / Entrada | Resultado Esperado | Resultado Obtido | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **1** | **Criação Nominal HTTP** | `POST /api/v2/video-jobs` com `#1639` e Bearer token | HTTP 201 com `job_id`, dados do imóvel e roteiros | HTTP 201 (`UUID: 20e570ee-dadc-438a-9d7f-491807ffa1cb`) | **APROVADO** |
| **2** | **Persistência PostgreSQL** | Consulta direta no banco pelo UUID retornado | `broker_id='marcel'`, `source='web'`, snapshots gravados | Registro confirmado no banco com todos os campos | **APROVADO** |
| **3** | **Exatamente 1 Job Criado** | Comparação da contagem de jobs no DB antes e depois | Diferença estrita de +1 no contador | Contagem antes: 6, depois: 7 (Diferença: 1) | **APROVADO** |
| **4** | **Imóvel Inexistente** | `property_ref: "99999999"` | HTTP 404 `PROPERTY_NOT_FOUND` | HTTP 404 retornado | **APROVADO** |
| **5** | **Parâmetros Inválidos** | Body vazio `{}` | HTTP 400 `INVALID_PARAMS` | HTTP 400 retornado | **APROVADO** |
| **6** | **Token Ausente** | Requisição sem header `Authorization` | HTTP 401 `UNAUTHORIZED` | HTTP 401 retornado | **APROVADO** |
| **7** | **Token Inválido** | `Authorization: Bearer token_falso` | HTTP 401 `UNAUTHORIZED` | HTTP 401 retornado | **APROVADO** |
| **8** | **Fail-Open Mapeado** | PostgreSQL cluster offline temporariamente | HTTP 503 `PERSISTENCE_UNAVAILABLE` com dados preservados | HTTP 503 retornado; cluster restaurado para `active` | **APROVADO** |
| **9** | **WhatsApp V1 Intacto** | Disparo de `#1639` via socket do WhatsApp | Roteiro entregue no chat e sessão criada normalmente | 2 mensagens enviadas com sucesso | **APROVADO** |
| **10** | **Saúde do Ambiente** | `pm2 status bali-gestor` e `systemctl is-active postgresql` | PM2 online e PostgreSQL active | PM2 PID 59114 online, PostgreSQL active | **APROVADO** |

---

## 4. Arquivos Modificados / Criados

* `video_engine/api_v2.js` [NOVO]: Roteador Express da V2 com middleware Bearer e rota `POST /video-jobs`.
* `gestor_server.js` [MODIFICADO]: Montagem da rota `/api/v2`.
* `docs/video_engine/changelog/PHASE_1D_JOB_API.md` [NOVO]: Este relatório de homologação.
* `CURRENT_STATE.md` [MODIFICADO]: Atualizado com a conclusão da Fase 1D.
