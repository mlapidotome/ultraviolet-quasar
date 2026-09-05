# Proposta Arquitetural — Fase 1C: Job Core Independente de Interface

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 1C (Desacoplamento do Núcleo de Jobs)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Transformar a criação de jobs de vídeo em uma operação independente de canal/interface, criando um serviço de domínio reutilizável (`job_service`), permitindo que WhatsApp, Painel Web e Testes Internos invoquem o mesmo núcleo de negócio sem duplicação de regras.

---

## 1. Diagnóstico da Arquitetura Atual & Acoplamentos Encontrados

Atualmente, o arquivo `video_anuncios_engine.js` acumula seis responsabilidades distintas em um único fluxo de execução no manipulador `handleIncomingMessage`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       video_anuncios_engine.js                              │
│                                                                             │
│  [1. Parser WhatsApp]        Detecta #REF, dígitos ou URL da mensagem      │
│          │                                                                  │
│  [2. Socket WhatsApp]        Dispara "🔍 Consultando imóvel..."            │
│          │                                                                  │
│  [3. Integração CRM]         fetchImovelData(ref)                           │
│          │                                                                  │
│  [4. Inteligência Roteiro]   generateCompleteScripts(imovel)                │
│          │                                                                  │
│  [5. Memória de Sessão V1]   activeVideoSessions[sessionKey] = {...}        │
│          │                                                                  │
│  [6. Persistência Shadow]    createVideoJob(...) no PostgreSQL             │
│          │                                                                  │
│  [7. Renderizador de Texto]  Gera template com emojis, ganchos e regras     │
│          │                                                                  │
│  [8. Envio WhatsApp]         client.sendMessage(...) com o roteiro          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Problemas do Acoplamento Atual:
1. **Dependência do Protocolo WhatsApp:** A lógica de consultar CRM, calcular parâmetros financeiros (MCMV, parcelas, entrada), gerar ganchos e registrar o Job no PostgreSQL só pode ser disparada através de um evento de mensagem do `whatsapp-web.js`.
2. **Inviabilidade de Reúso no Painel Web:** Se uma interface web tentar criar um job de vídeo hoje, precisaria ou duplicar o código de busca/roteiro/banco ou forjar um objeto falso de mensagem do WhatsApp (`msg.from`, `msg.body`).
3. **Mistura de Camadas:** A camada de transporte (WhatsApp), a camada de domínio (imóvel + roteirização) e a camada de persistência (PostgreSQL + memória) residem na mesma função.

---

## 2. A Menor Extração Possível (Design da Fase 1C)

A menor extração segura, que não quebra a V1 e não introduz complexidade prematura, consiste em extrair um **Job Core Service** em um módulo dedicado:

📁 **`video_engine/job_service.js`**

Este serviço encapsula exclusivamente a lógica de domínio:
* Recebe: `{ property_ref, broker_id, source, metadata }`
* Executa:
  1. Busca dados do imóvel no CRM (`fetchImovelData`);
  2. Gera roteiros inteligentes (`generateCompleteScripts`);
  3. Cria registro persistente no PostgreSQL (`createVideoJob`) em modo resiliente (não-bloqueante);
* Retorna: objeto de domínio unificado `{ success, job, imovel, scripts, error }`.

### O que o Job Core NÃO sabe:
* NÃO sabe o que é WhatsApp, socket ou `client.sendMessage`;
* NÃO sabe como formatar texto de chat nem quais emojis usar;
* NÃO gerencia `activeVideoSessions` (que permanece no adaptador WhatsApp da V1).

---

## 3. Visão da Arquitetura Proposta (Antes vs Depois)

### Fluxo Antes (Fase 1B):
```
WhatsApp Event (#REF) ──> video_anuncios_engine.js
                              ├── fetch CRM
                              ├── generate scripts
                              ├── activeVideoSessions = {...}
                              ├── createVideoJob (PostgreSQL)
                              └── client.sendMessage (WhatsApp)
```

### Fluxo Depois (Fase 1C):
```
[Canal WhatsApp]                   [Futuro: Painel Web]          [Futuro: Testes / CLI]
video_anuncios_engine.js              POST /api/jobs                    node test.js
       │                                    │                                │
       └──────────────────────────┬─────────┴────────────────────────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │ video_engine/job_service  │
                    │                           │
                    │ • fetchImovelData         │
                    │ • generateCompleteScripts │
                    │ • createVideoJob (DB)     │
                    └─────────────┬─────────────┘
                                  ▼
                        Retorno de Domínio:
                    { success, job, imovel, scripts }
                                  │
       ┌──────────────────────────┴──────────────────────────┐
       ▼                                                     ▼
[Adaptador WhatsApp V1]                             [Adaptador Web V2]
├── activeVideoSessions = {...}                     └── Retorna JSON HTTP
├── Monta template de texto (emojis)
└── client.sendMessage
```

---

## 4. Avaliação de Escopo: Módulo Interno vs HTTP API

> [!TIP]
> **Recomendação de Engenharia:** Na Fase 1C, devemos criar **somente o módulo interno de serviço (`video_engine/job_service.js`)** e conectar o fluxo atual do WhatsApp nele.
>
> A criação de endpoints HTTP (`POST /api/v2/jobs`) e interfaces visuais (painel) deve ser postergada para fases seguintes (ex: Fase 1D ou Fase 2).  
> **Motivo:** Isso mantém a Fase 1C focada exclusivamente na pureza do domínio e no desacoplamento, com risco zero de regressão em produção.

---

## 5. Arquivos a Criar e Modificar

### 1. [NOVO] `video_engine/job_service.js`
* Exporta a função principal:
  ```javascript
  async function initializeVideoJob({ property_ref, broker_id, source = 'system', metadata = {} })
  ```
* Contém (ou importa) `fetchImovelData` e `generateCompleteScripts`.
* Invoca `createVideoJob` de `video_engine/db.js` com captura graciosa de erros.
* Retorna o resultado puro da operação.

### 2. [MODIFICAR] `video_anuncios_engine.js`
* Deixa de conter a lógica duplicada de criação de job e busca direta no manipulador `#REF`.
* Importa `initializeVideoJob` de `./video_engine/job_service`.
* No recebimento de `#REF`:
  1. Chama `const result = await initializeVideoJob({ property_ref: ref, broker_id: canonicalBrokerId, source: 'whatsapp', metadata: { from, to, session_key: sessionKey } })`;
  2. Se `!result.success`: envia mensagem de erro ao WhatsApp ("Imóvel não encontrado").
  3. Se `result.success`:
     - Armazena na memória operacional:
       ```javascript
       activeVideoSessions[sessionKey] = {
         imovelRef: ref,
         imovelData: result.imovel,
         scripts: result.scripts,
         waitingAudios: true,
         audiosReceived: [],
         videoJobId: result.job ? result.job.id : null
       };
       ```
     - Formata a mensagem com os roteiros e envia via `client.sendMessage`.

---

## 6. O Que Permanece Rigorosamente Intocado

Nesta fase, continuam **100% inalterados**:
* Fluxo de áudios reais (1, 2, 3 e 4);
* Comando `CLONE` e modo piloto;
* Integração com HeyGen (geração de vídeo e polling);
* Renderização e concatenação com FFmpeg;
* Upload para Cloudflare R2;
* Entrega de vídeos finais no WhatsApp;
* `activeVideoSessions` como fonte operacional da V1.

---

## 7. Riscos e Medidas de Mitigação

| Risco Identificado | Impacto | Mitigação Arquitetural |
| :--- | :--- | :--- |
| **Regressão na formatação de roteiro do WhatsApp** | Médio | Manter a função de formatação de mensagens inteiramente dentro do adaptador WhatsApp, sem alterar uma única linha do template de texto. |
| **Falha de rede com ImobTotal** | Baixo | Preservar intacto o fallback existente para a base local em cache (`banco_imoveis_carteira.json`). |
| **Falha no PostgreSQL interromper fluxo** | Alto | O `job_service` absorve o erro do banco no `try/catch` e retorna `{ success: true, job: null, imovel, scripts }`, garantindo que a V1 continue operando normalmente. |

---

## 8. Plano de Testes da Fase 1C (Quando Aprovada)

1. **Teste Unitário Isolado do Core (`job_service`):**
   - Invocar `initializeVideoJob` diretamente via script Node.js sem passar por cliente WhatsApp.
   - Validar retorno `{ success: true, job, imovel, scripts }` com dados consistentes e persistência no PostgreSQL.
2. **Teste Integrado via WhatsApp:**
   - Enviar `#1639` pelo fluxo de homologação.
   - Validar que o adaptador WhatsApp consome o `job_service`, preenche `activeVideoSessions` com `videoJobId` e entrega o roteiro no chat sem nenhuma divergência visual ou funcional.
3. **Teste de Degradação do Core:**
   - Validar que `job_service` com banco offline retorna `job: null` com `imovel` e `scripts` íntegros, permitindo entrega normal no WhatsApp.

---

## 9. Limites Explícitos da Fase 1C

* ❌ NÃO criar endpoints Express/HTTP ainda.
* ❌ NÃO criar tela de frontend / painel web ainda.
* ❌ NÃO criar workers de renderização em background.
* ❌ NÃO criar filas nem mensageria assíncrona.
* ❌ NÃO migrar a máquina de estados de `CLONE` / áudios para o banco.
* ❌ NÃO alterar a V1 de produção.
