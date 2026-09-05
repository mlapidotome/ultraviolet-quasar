# Proposta Arquitetural Revisada — Fase 1C: Job Core Independente de Interface

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 1C (Job Core Independente de Interface)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Estabelecer um núcleo de domínio independente (`job_service`) para inicialização de Jobs de vídeo, que possa ser consumido indiferentemente por WhatsApp, Painel Web ou Testes Internos, eliminando acoplamentos e garantindo que o WhatsApp V1 continue funcionando como adaptador de canal.

---

## 1. Diagnóstico de Acoplamento e Mapeamento de Usos

### A. Acoplamento Identificado no Fluxo Atual
No manipulador `#REF` de `video_anuncios_engine.js`, estão misturados:
1. **Entrada de canal:** Regex de mensagem do WhatsApp;
2. **Notificação de progresso:** Mensagem no chat ("🔍 Consultando imóvel...");
3. **Domínio:** Busca no CRM (`fetchImovelData`), simulação financeira e roteirização (`generateCompleteScripts`);
4. **Persistência:** Chamada direta a `createVideoJob` no PostgreSQL;
5. **Estado Operacional V1:** Mutação em `activeVideoSessions[sessionKey]`;
6. **Apresentação & Saída:** Formatação de texto com emojis e envio via `client.sendMessage`.

### B. Mapeamento de Usos Atuais das Funções de Domínio
Uma auditoria completa no repositório revelou os seguintes consumidores:
* **`fetchImovelData(ref)`**:
  - `video_anuncios_engine.js`: linhas 381 (`getOrInitSession`), 600 (`handleIncomingMessage`), exportada na linha 781.
  - `gestor_server.js`: linha 1110 (`const imovel = await videoEngine.fetchImovelData('1639');`).
* **`generateCompleteScripts(imovel)`**:
  - `video_anuncios_engine.js`: linhas 386 (`getOrInitSession`), 606 (`handleIncomingMessage`), exportada na linha 782.
  - `gestor_server.js`: linha 1114 (`scripts: videoEngine.generateCompleteScripts(imovel);`).

---

## 2. Decisão Arquitetural: Propriedade das Funções & Zero Dependência Circular

Para evitar dependência circular (`job_service` importar `video_anuncios_engine` enquanto `video_anuncios_engine` importa `job_service`), a **propriedade das funções de domínio será centralizada no Job Core**:

```
┌─────────────────────────────────────────────────────────────┐
│                video_engine/job_service.js                  │
│                                                             │
│  [PROPRIETÁRIO DO DOMÍNIO]                                  │
│  • fetchImovelData(ref)                                     │
│  • generateCompleteScripts(imovel)                          │
│  • initializeVideoJob({ property_ref, broker_id, ... })     │
│                                                             │
│  Importa:                                                   │
│  └── video_engine/db (createVideoJob)                       │
│  NÃO IMPORTA: video_anuncios_engine.js                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ exporta funções
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 video_anuncios_engine.js                    │
│                                                             │
│  [ADAPTADOR DE CANAL WHATSAPP V1]                           │
│  Importa de job_service:                                    │
│  ├── initializeVideoJob                                     │
│  ├── fetchImovelData (re-exportado para gestor_server.js)    │
│  └── generateCompleteScripts (re-exportado)                 │
└─────────────────────────────────────────────────────────────┘
```

### Vantagens Desta Abordagem:
1. **Sem Dependência Circular:** `job_service.js` tem zero dependências de `video_anuncios_engine.js`.
2. **Compatibilidade Reversa Absoluta:** O `video_anuncios_engine.js` re-exporta `fetchImovelData` e `generateCompleteScripts`, de modo que consumidores externos como `gestor_server.js` continuam funcionando sem alteração de uma única linha.
3. **Zero Duplicação:** As funções existem em apenas um lugar no código.

---

## 3. Especificação do Job Core (`video_engine/job_service.js`)

### Assinatura do Serviço:
```javascript
async function initializeVideoJob({
  property_ref,
  broker_id,
  source = 'system',
  metadata = {}
})
```

### Contrato de Retorno:
* **Sucesso Nominal:**
  ```javascript
  {
    success: true,
    job: { id: 'uuid-...', status: 'SCRIPT_READY', ... },
    imovel: { ... },
    scripts: { hooks: [...], body: { ... }, financeiro: { ... } }
  }
  ```

* **Sucesso em Modo Degradado (PostgreSQL Offline - Fail-Open):**
  ```javascript
  {
    success: true,
    job: null,
    imovel: { ... },
    scripts: { hooks: [...], body: { ... }, financeiro: { ... } }
  }
  ```

* **Falha de Domínio (Imóvel Inexistente no CRM):**
  ```javascript
  {
    success: false,
    error: 'PROPERTY_NOT_FOUND',
    job: null,
    imovel: null,
    scripts: null
  }
  ```

* **Falha de Parâmetros Obrigatórios:**
  ```javascript
  {
    success: false,
    error: 'MISSING_REQUIRED_PARAMS', // se faltar property_ref ou broker_id
    job: null,
    imovel: null,
    scripts: null
  }
  ```

---

## 4. Regras Operacionais Críticas

1. **Exatamente UMA chamada a `createVideoJob` por `#REF`:**
   - O bloco shadow implementado na Fase 1B em `video_anuncios_engine.js` será **removido**.
   - O `job_service` torna-se o **único responsável** por chamar `createVideoJob`.
   - Isso elimina qualquer risco de registros duplicados no banco.

2. **Clarificação de "Não-Bloqueante" (Fail-Open):**
   - Não se trata de disparar promise sem `await`. O `job_service` aguarda (`await createVideoJob(...)`) para que, em caso de sucesso, o `job.id` já retorne para a sessão.
   - "Não-bloqueante" significa **Fail-Open**: se o banco falhar, o erro é capturado internamente no `catch`, logado de forma explícita (`console.error`), e a função retorna `success: true` com `job: null`. A V1 não é interrompida.

3. **Zero Formatação de Canal no Job Core:**
   - O `job_service` trabalha estritamente com dados estruturados.
   - Nenhuma string formatada com emojis ("🏠 *IMÓVEL ENCONTRADO...*"), tags de negrito ou regras de chat do WhatsApp reside no Core.

4. **`activeVideoSessions` 100% Fora do Core:**
   - O Job Core não conhece sessões, sockets ou remetentes.
   - A gestão de memória `activeVideoSessions[sessionKey]` permanece inteiramente sob custódia do adaptador `video_anuncios_engine.js`.

---

## 5. Fluxo Antes vs Depois

### Antes (Fase 1B):
```
WhatsApp Msg (#REF) ──> video_anuncios_engine.js
                            ├── fetchImovelData (local)
                            ├── generateCompleteScripts (local)
                            ├── activeVideoSessions[sessionKey] = {...}
                            ├── createVideoJob (PostgreSQL direto - shadow)
                            └── client.sendMessage (template WhatsApp)
```

### Depois (Fase 1C):
```
[WhatsApp / Adaptador V1]            [Futuro: Painel Web]          [Futuro: Testes / CLI]
video_anuncios_engine.js                POST /api/v2/jobs                  node test.js
         │                                     │                                │
         └───────────────────────────┬─────────┴────────────────────────────────┘
                                     ▼
                       ┌───────────────────────────┐
                       │ video_engine/job_service  │
                       │                           │
                       │ 1. fetchImovelData        │
                       │ 2. generateCompleteScripts│
                       │ 3. createVideoJob (DB)    │
                       │    (única chamada)        │
                       └─────────────┬─────────────┘
                                     ▼
                           Retorno de Domínio:
                       { success, job, imovel, scripts }
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
[Adaptador WhatsApp V1]                                 [Adaptador Web V2]
├── Se !success: msg "Imóvel não encontrado"            └── Retorna JSON HTTP
├── activeVideoSessions[sessionKey] = {                     { success, job }
│     imovelRef, imovelData, scripts,
│     videoJobId: job ? job.id : null
│   }
├── Monta template de texto (emojis / ganchos)
└── client.sendMessage
```

---

## 6. O Que Permanece Rigorosamente Intocado

Nesta fase, permanecem **100% inalterados**:
* Fluxo de áudios reais do WhatsApp (1, 2, 3 e 4);
* Comando `CLONE` e modo piloto;
* Renderização HeyGen e concatenação FFmpeg;
* Upload para Cloudflare R2;
* Comandos `OK` e `GERAR RESTANTE`;
* Entrega de vídeos finais no WhatsApp;
* `activeVideoSessions` como única fonte operacional da V1.

---

## 7. Plano de Verificação e Testes da Fase 1C

1. **Teste Unitário Independente do Core (`job_service`):**
   - Executar script chamando `initializeVideoJob({ property_ref: '1639', broker_id: 'marcel', source: 'unit_test' })` sem cliente WhatsApp.
   - Comprovar retorno `{ success: true, job, imovel, scripts }` e exatamente 1 registro criado no PostgreSQL.
2. **Teste de Imóvel Inexistente:**
   - Chamar `initializeVideoJob({ property_ref: '9999999', broker_id: 'marcel' })`.
   - Comprovar retorno `{ success: false, error: 'PROPERTY_NOT_FOUND', job: null }` e zero registros criados no banco.
3. **Teste de Degradação Graciosa (Fail-Open com DB Offline):**
   - Parar temporariamente o PostgreSQL (`systemctl stop postgresql`).
   - Invocar `initializeVideoJob`.
   - Comprovar que retorna `{ success: true, job: null, imovel, scripts }` sem lançar exceção.
   - Restaurar imediatamente o banco.
4. **Teste Integrado com WhatsApp:**
   - Disparar `#1639` via WhatsApp/mock.
   - Validar que as 2 mensagens são entregues, `activeVideoSessions` é populada, `session.videoJobId` contém o UUID do Job e existe **exatamente 1 Job** gerado no banco.
5. **Teste de Não-Regressão de `gestor_server.js`:**
   - Validar que a importação `videoEngine.fetchImovelData` e `videoEngine.generateCompleteScripts` continuam funcionando sem quebra.

---

## 8. Limites Explícitos da Fase 1C

* ❌ NÃO criar rotas Express nem endpoints HTTP.
* ❌ NÃO criar tela de frontend nem painel web.
* ❌ NÃO criar workers de renderização em background.
* ❌ NÃO criar filas (BullMQ, etc.).
* ❌ NÃO migrar a máquina de estados de `CLONE` / áudios para o banco.
* ❌ NÃO alterar a operação da V1 em produção.
