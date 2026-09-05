# Changelog: Fase 1C — Job Core Independente de Interface

**Data de Conclusão:** 04/09/2026  
**Status:** HOMOLOGADO E CONCLUÍDO COM SUCESSO  
**Job de Homologação Real (UUID):** `8b2cf780-f764-424e-ab34-626d4c85e5ec`  
**Job Unitário Independente do Core (UUID):** `bdfeca21-b453-4d54-a943-09356f873d05`  
**Canal de Origem:** `whatsapp` / `system`  

---

## 1. O Que Foi Desenvolvido

1. **Criação do Núcleo de Domínio (`video_engine/job_service.js`)**:
   - Centralizou as regras de negócio de consulta de imóvel (`fetchImovelData`), simulação financeira e roteirização (`generateCompleteScripts`), e inicialização de Jobs de vídeo (`initializeVideoJob`).
   - Módulo 100% puro e agnóstico de canal: **não possui qualquer importação ou dependência de `video_anuncios_engine.js`** (zero dependência circular).
   - Não contém formatações de chat com emojis nem regras específicas do WhatsApp.

2. **Desacoplamento do Adaptador WhatsApp (`video_anuncios_engine.js`)**:
   - O manipulador `#REF` deixou de chamar diretamente o CRM ou o banco de dados. Agora ele apenas delega a inicialização para `job_service.initializeVideoJob()`.
   - O bloco shadow temporário implementado na Fase 1B foi removido do engine.
   - **Garantia de Exatamente UMA Chamada:** Apenas o `job_service` é responsável por criar o `video_job` no PostgreSQL, eliminando qualquer risco de duplicação.
   - O engine re-exporta `fetchImovelData` e `generateCompleteScripts`, mantendo **100% de compatibilidade reversa** com consumidores externos (`gestor_server.js`).

3. **Contrato de Retorno e Fail-Open Estrito**:
   - **Sucesso Nominal:** `{ success: true, job: {...}, imovel, scripts }`.
   - **Modo Degradado (Fail-Open / PostgreSQL Offline):** `{ success: true, job: null, imovel, scripts }`. A V1 continua operacional, enviando roteiros normalmente.
   - **Imóvel Não Encontrado:** `{ success: false, error: 'PROPERTY_NOT_FOUND', job: null, imovel: null, scripts: null }` (sem gravação de Job).

4. **Isolamento de Estado**:
   - `activeVideoSessions` permaneceu estritamente dentro de `video_anuncios_engine.js` e não existe dentro do `job_service`.

---

## 2. Diagrama da Arquitetura Homologada

```
[Canal WhatsApp (V1)]              [Futuro: Painel Web]          [Testes Automatizados]
video_anuncios_engine.js              POST /api/v2/jobs                  node test.js
       │                                    │                                │
       └──────────────────────────┬─────────┴────────────────────────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │ video_engine/job_service  │
                    │                           │
                    │ • fetchImovelData         │
                    │ • generateCompleteScripts │
                    │ • createVideoJob (DB)     │
                    │   (Exatamente 1 chamada)  │
                    └─────────────┬─────────────┘
                                  ▼
                        Retorno de Domínio:
                    { success, job, imovel, scripts }
                                  │
       ┌──────────────────────────┴──────────────────────────┐
       ▼                                                     ▼
[Adaptador WhatsApp V1]                             [Adaptador Web V2]
├── activeVideoSessions[sessionKey] = {...}         └── Retorna JSON HTTP
│     videoJobId: job ? job.id : null
├── Formata mensagem com emojis
└── client.sendMessage
```

---

## 3. Resultados da Suíte de Homologação

| Teste | Objetivo | Resultado |
| :--- | :--- | :--- |
| **1. Unitário Isolado do Core** | Invocar `initializeVideoJob` diretamente sem WhatsApp | **APROVADO** (Job `bdfeca21-b453-4d54-a943-09356f873d05` gerado com dados íntegros) |
| **2. Imóvel Inexistente** | Testar ref `99999999` | **APROVADO** (Retornou `success: false`, `error: 'PROPERTY_NOT_FOUND'`, zero jobs no DB) |
| **3. Fail-Open com DB Offline** | Parar PostgreSQL e invocar `initializeVideoJob` | **APROVADO** (Retornou `success: true`, `job: null`, `imovel` e `scripts` preservados; DB restaurado) |
| **4. Fluxo WhatsApp Integrado** | Enviar `#1639` pelo fluxo do WhatsApp | **APROVADO** (Roteiro entregue no chat, `session.videoJobId` preenchido) |
| **5. Exatamente 1 Job Criado** | Comparar contagem de jobs no DB antes e depois | **APROVADO** (Contagem incrementou em exatamente 1; UUID: `8b2cf780-f764-424e-ab34-626d4c85e5ec`) |
| **6. Não-Regressão `gestor_server`** | Invocar funções reexportadas pelo engine | **APROVADO** (100% compatível sem alterações em `gestor_server.js`) |
| **7. Sintaxe e PM2** | `node -c` em todos os arquivos e restart do PM2 | **APROVADO** (PM2 PID 58364 `online`, PostgreSQL `active`) |

---

## 4. Arquivos Modificados / Criados

* `video_engine/job_service.js` [NOVO]: Núcleo de domínio e orquestração de criação de jobs.
* `video_anuncios_engine.js` [MODIFICADO]: Delegou lógica de domínio para `job_service`, removeu bloco shadow e re-exportou funções de domínio.
* `gestor_server.js` [INTOCADO]: Permaneceu 100% inalterado, consumindo as funções re-exportadas.
