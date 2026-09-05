# Proposta Arquitetural & Plano de Implementação — Fase 1D: Job API Mínima

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 1D (Job API Mínima HTTP)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Prover o primeiro ponto de entrada HTTP da Video Engine V2 que NÃO dependa do WhatsApp, consumindo exatamente o mesmo `video_engine/job_service.js` homologado na Fase 1C, validando que o Job Core é uma camada de domínio reutilizável por múltiplas interfaces.

---

## 1. Inspeção da Arquitetura do Servidor (`gestor_server.js`)

Uma auditoria no arquivo `/var/www/bali-gestor/gestor_server.js` e na infraestrutura de rede do VPS revelou:

1. **Estrutura Express & Middlewares Existentes:**
   - O servidor utiliza Express 4 com middlewares globais:
     - `app.use(cors())`: Permite requisições Cross-Origin de qualquer origem.
     - `app.use(express.json())`: Habilita parsing de bodies em JSON.
     - Múltiplos middlewares de estáticos para arquivos públicos, cards e outputs de vídeo.
   - **Autenticação Atual:** Não existe middleware de autenticação global. As rotas atuais (`/leads`, `/imoveis`, `/compradores`, `/gestor`) são cockpits internos abertos na rede local/VPS.
   - **Tratamento de Erros:** Não há middleware centralizado de erro (`app.use((err, req, res, next) => ...)`). Cada rota implementa blocos `try/catch` locais retornando `res.status(500).json({ error: e.message })`.

2. **Exposição de Rede & Portas:**
   - O processo escuta diretamente em `0.0.0.0:3005` (`*:3005`), além de estar mapeado no Nginx local (`proxy_pass http://127.0.0.1:3005;` nas portas 80/443).
   - **Riscos de Exposição Pública Não Protegida:**  
     Como o servidor está acessível na internet e possui CORS liberado, expor uma rota pública de criação de jobs sem proteção permitiria que qualquer varredura de bots ou terceiros disparasse requisições à API da ImobTotal e enchesse o PostgreSQL com registros espúrios.
   - **Solução de Segurança Mínima Adequada:**  
     Proteção por **API Key Pré-Compartilhada** (`VIDEO_ENGINE_API_KEY`) via header `Authorization: Bearer <KEY>` ou `x-api-key: <KEY>`, configurada exclusivamente no `.env` do servidor (permissão 600). Não requer sistema complexo de usuários e protege totalmente a rota.

3. **Como Adicionar a Rota V2 Sem Interferir na V1:**
   - Em vez de poluir o `gestor_server.js` com novos handlers, a menor e mais segura intervenção é **modularizar a rota em um roteador Express isolado**:  
     📁 `video_engine/api_v2.js`
   - No `gestor_server.js`, adiciona-se apenas uma única linha de montagem com prefixo:
     ```javascript
     app.use('/api/v2', require('./video_engine/api_v2'));
     ```
   - Isso isola 100% o código V2, garante reversibilidade instantânea e não toca em nenhuma rota existente da V1.

---

## 2. Desenho Arquitetural da Fase 1D

```
                                  [Requisição HTTP Externa]
                                     POST /api/v2/video-jobs
                                     Header: x-api-key
                                     Body: { property_ref: "1639" }
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            gestor_server.js                                 │
│                                                                             │
│  app.use('/api/v2', videoApiV2) ──────────────────────────┐                 │
└───────────────────────────────────────────────────────────┼─────────────────┘
                                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        video_engine/api_v2.js                               │
│                                                                             │
│  1. [Middleware de Autenticação] -> Valida x-api-key / Bearer Token        │
│  2. [Validação de Schema]        -> Exige property_ref válido               │
│  3. [Delegação ao Domínio]       -> Invoca initializeVideoJob(...)         │
│  4. [Mapeamento de Resposta]     -> Retorna HTTP 201 / 200 / 400 / 404     │
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     video_engine/job_service.js (Job Core)                  │
│                                                                             │
│  • fetchImovelData(ref)                                                     │
│  • generateCompleteScripts(imovel)                                          │
│  • createVideoJob({ property_ref, broker_id: "marcel", source: "web" })     │
└───────────────────────────────────────────┬─────────────────────────────────┘
                                            │
                                            ▼
                                  PostgreSQL (video_jobs)
```

---

## 3. Especificação do Contrato HTTP

### Rota: `POST /api/v2/video-jobs`

#### Headers Obrigatórios:
* `Content-Type: application/json`
* `x-api-key: <VIDEO_ENGINE_API_KEY>` (ou `Authorization: Bearer <VIDEO_ENGINE_API_KEY>`)

#### Request Body:
```json
{
  "property_ref": "1639",
  "broker_id": "marcel"
}
```
* `property_ref` (string ou number, obrigatório): Referência do imóvel no estoque Bali/ImobTotal.
* `broker_id` (string, opcional): Padrão `'marcel'`.

---

#### Respostas Padronizadas da API:

1. **Sucesso Nominal (HTTP 201 Created):**
   Job criado com sucesso no PostgreSQL e dados calculados.
   ```json
   {
     "success": true,
     "job_id": "8b2cf780-f764-424e-ab34-626d4c85e5ec",
     "status": "SCRIPT_READY",
     "source": "web",
     "property": {
       "codigo": "1639",
       "titulo": "Apartamento com 2 quartos à venda, 75 m² por R$ 395.000 - Centro - Taubaté/SP",
       "bairro": "Centro",
       "valor_venda": 395000
     },
     "scripts": {
       "financeiro": {
         "valorVenda": 395000,
         "entrada": 79000,
         "valorFinanciado": 316000,
         "parcelaEstimada": 2844,
         "rendaMinima": 9385
       },
       "hooks": [
         { "index": 1, "tipo": "Choque / Entrada", "text": "..." },
         { "index": 2, "tipo": "Aluguel vs Parcela", "text": "..." },
         { "index": 3, "tipo": "Renda Familiar / Oportunidade", "text": "..." }
       ],
       "body": {
         "text": "..."
       }
     }
   }
   ```

2. **Modo Degradado / Fail-Open (HTTP 200 OK):**
   PostgreSQL offline temporariamente; scripts calculados e retornados, sem quebrar o cliente.
   ```json
   {
     "success": true,
     "job_id": null,
     "status": "DEGRADED",
     "message": "Job processado em memória, persistência temporariamente indisponível",
     "property": { ... },
     "scripts": { ... }
   }
   ```

3. **Imóvel Não Encontrado no CRM (HTTP 404 Not Found):**
   ```json
   {
     "success": false,
     "error": "PROPERTY_NOT_FOUND",
     "message": "Imóvel não encontrado na carteira para a referência informada"
   }
   ```

4. **Parâmetros Inválidos (HTTP 400 Bad Request):**
   ```json
   {
     "success": false,
     "error": "INVALID_PARAMS",
     "message": "property_ref é obrigatório"
   }
   ```

5. **Não Autorizado (HTTP 401 Unauthorized):**
   ```json
   {
     "success": false,
     "error": "UNAUTHORIZED",
     "message": "Chave de API inválida ou não fornecida"
   }
   ```

---

## 4. Estratégia de Segurança e Autenticação Mínima

* **Variável de Ambiente:** `VIDEO_ENGINE_API_KEY` injetada em `/var/www/bali-gestor/.env`.
* **Middleware no Router (`video_engine/api_v2.js`):**
  ```javascript
  function requireApiKey(req, res, next) {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-api-key'];
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
      ? authHeader.slice(7).trim() 
      : customHeader;
    
    const configuredKey = process.env.VIDEO_ENGINE_API_KEY;
    if (!configuredKey) {
      return res.status(500).json({ success: false, error: 'SERVER_MISCONFIGURED', message: 'VIDEO_ENGINE_API_KEY não configurada' });
    }
    if (!token || token !== configuredKey) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Acesso negado: chave de API inválida' });
    }
    next();
  }
  ```
* Não há necessidade de criar usuários, tabelas de tokens ou sessões HTTP nesta fase.
* O frontend futuro nunca conterá chaves públicas; o backend do painel fará a autenticação segura.

---

## 5. Arquivos a Criar e Modificar

1. **`video_engine/api_v2.js` [NOVO]:**
   - Router do Express para a V2.
   - Aplica `requireApiKey`.
   - Implementa rota `POST /video-jobs`.
   - Delega para `jobService.initializeVideoJob({ property_ref, broker_id, source: 'web', metadata })`.

2. **`gestor_server.js` [MODIFICAR]:**
   - Montagem do roteador V2:
     ```javascript
     // Rotas da Video Engine V2 (Independente de WhatsApp)
     app.use('/api/v2', require('./video_engine/api_v2'));
     ```
   - Nenhuma linha de rota V1 ou serviço de leads/WhatsApp é alterada.

3. **`/var/www/bali-gestor/.env`:**
   - Adicionar chave segura `VIDEO_ENGINE_API_KEY` (permissão 600, fora do git).

---

## 6. O Que Permanece Rigorosamente Intocado

* ❌ Nenhum painel ou frontend visual é criado nesta fase.
* ❌ Sem workers, sem BullMQ, sem filas em background.
* ❌ Sem state machine complexa além de `SCRIPT_READY`.
* ❌ Sem alteração em `CLONE`, `OK`, `GERAR RESTANTE`, áudios 1-4.
* ❌ Sem alteração nas integrações HeyGen, FFmpeg, Cloudflare R2.
* ❌ `activeVideoSessions` continua operando exclusivamente no WhatsApp V1.
* ❌ Zero duplicação da lógica de busca ou cálculo de roteiros (ambos usam `job_service.js`).

---

## 7. Plano de Testes e Homologação da Fase 1D

A homologação da Fase 1D cobrirá os 9 testes solicitados:

1. **Criação de Job via HTTP sem WhatsApp:**
   - `curl -X POST http://localhost:3005/api/v2/video-jobs -H "x-api-key: ..." -d '{"property_ref":"1639"}'`
   - Validar retorno HTTP 201 com JSON completo (`job_id`, `status: 'SCRIPT_READY'`).
2. **Job Persistido no PostgreSQL:**
   - Consultar no banco pelo `job_id` retornado e conferir `source = 'web'`, `broker_id = 'marcel'`, snapshots JSONB.
3. **Garantia de Exatamente Um Job Criado:**
   - Validar incremento estrito de 1 no contador de jobs da tabela `video_jobs`.
4. **Imóvel Inexistente via HTTP:**
   - Enviar `property_ref: "99999999"`.
   - Validar retorno HTTP 404 com `PROPERTY_NOT_FOUND` e zero registros no banco.
5. **Parâmetros Inválidos:**
   - Enviar `{}` (sem `property_ref`).
   - Validar retorno HTTP 400 com `INVALID_PARAMS`.
6. **Requisição Não Autorizada:**
   - Enviar requisição sem header ou com chave inválida.
   - Validar retorno HTTP 401 `UNAUTHORIZED`.
7. **Fail-Open com PostgreSQL Offline:**
   - Parar temporariamente o PostgreSQL (`systemctl stop postgresql`).
   - Disparar requisição com `#1639`.
   - Validar retorno HTTP 200 com `job_id: null` e status `DEGRADED`, com `property` e `scripts` preservados.
   - Restaurar PostgreSQL imediatamente para `active`.
8. **WhatsApp V1 Continuando Operacional:**
   - Disparar teste de WhatsApp `#1639` e comprovar que a V1 continua entregando mensagens e criando sessão em memória.
9. **Saúde de Produção:**
   - Confirmar `bali-gestor` online no PM2 e PostgreSQL `active`.

---

## 8. Limites Explícitos da Fase 1D

* Esta fase NÃO cria tela de usuário (frontend).
* Esta fase NÃO executa renderização de vídeo pelo HTTP (a renderização continua no fluxo dos ganchos).
* A API atua puramente como um adaptador de inicialização de Jobs independente do WhatsApp.
