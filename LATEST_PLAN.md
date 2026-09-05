# Proposta Arquitetural & Plano de Implementação — Fase 1D: Job API Mínima (Revisado)

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 1D (Job API Mínima HTTP)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Prover o primeiro ponto de entrada HTTP da Video Engine V2 que NÃO dependa do WhatsApp, consumindo diretamente o mesmo `video_engine/job_service.js` homologado na Fase 1C, validando que o Job Core é uma camada de domínio reutilizável por múltiplas interfaces.

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
     Como o servidor está acessível na internet e possui CORS liberado, expor uma rota pública de criação de jobs sem proteção permitiria que qualquer varredura de bots ou terceiros disparasse requisições descontroladas à API da ImobTotal e ao PostgreSQL.
   - **Solução de Segurança Mínima Padronizada:**  
     Proteção por **API Key Pré-Compartilhada via Bearer Token** (`Authorization: Bearer <VIDEO_ENGINE_API_KEY>`), configurada exclusivamente no `.env` do servidor (permissão 600, fora do git). Não requer sistema complexo de usuários e protege totalmente a rota.

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
                                     Header: Authorization: Bearer <KEY>
                                     Body: { "property_ref": "1639" }
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
│  1. [Middleware de Autenticação] -> Exige Authorization: Bearer <KEY>       │
│  2. [Validação de Schema]        -> Exige property_ref; ignora broker_id   │
│  3. [Delegação ao Domínio]       -> Invoca initializeVideoJob({             │
│                                       property_ref,                         │
│                                       broker_id: 'marcel', // fixo          │
│                                       source: 'web',                        │
│                                       metadata                              │
│                                     })                                      │
│  4. [Mapeamento HTTP]            -> HTTP 201 (Sucesso)                      │
│                                     HTTP 503 (Persistência Offline)         │
│                                     HTTP 404 (Imóvel Não Encontrado)        │
│                                     HTTP 400 (Parâmetro Inválido)           │
│                                     HTTP 401 (Não Autorizado)               │
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
* `Authorization: Bearer <VIDEO_ENGINE_API_KEY>`  
  *(Apenas Bearer token é aceito; `x-api-key` não será utilizado)*

#### Request Body:
```json
{
  "property_ref": "1639"
}
```
* `property_ref` (string ou number, obrigatório): Referência do imóvel no estoque Bali/ImobTotal.
* **Sem `broker_id` público:** O cliente não pode escolher arbitrariamente o `broker_id`. O adaptador HTTP injeta automaticamente o identificador canônico `broker_id = "marcel"`. Multiusuário fica para fase futura.

---

#### Respostas Padronizadas da API:

1. **Sucesso Nominal (HTTP 201 Created):**  
   Job persistido com sucesso no PostgreSQL e dados/roteiros gerados.
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

2. **Modo Degradado / Falha no Banco (HTTP 503 Service Unavailable):**  
   O Job Core executou com sucesso (dados e roteiros gerados), mas o PostgreSQL estava offline (`job === null`). Como a API HTTP tem a semântica de criar um Job persistente, a ausência de `job_id` é mapeada para HTTP 503 com `success: false`. Os dados processados são devolvidos no corpo para transparência.
   ```json
   {
     "success": false,
     "error": "PERSISTENCE_UNAVAILABLE",
     "message": "Os dados e roteiros foram processados, mas o Job não pôde ser persistido no banco de dados",
     "job_id": null,
     "property": { ... },
     "scripts": { ... }
   }
   ```
   > [!NOTE]
   > Isso NÃO altera o contrato interno do Job Core (`success: true, job: null`) e NÃO altera o fail-open do WhatsApp V1 (que continua entregando a mensagem mesmo com o banco offline). Apenas a API HTTP sinaliza que a persistência não foi concluída.

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
     "message": "Token de autorização ausente ou inválido"
   }
   ```

---

## 4. Estratégia de Segurança Padronizada

* **Variável de Ambiente:** `VIDEO_ENGINE_API_KEY` injetada exclusivamente em `/var/www/bali-gestor/.env` com permissão 600.
* **Middleware Exclusivo de Bearer Token (`video_engine/api_v2.js`):**
  ```javascript
  function requireApiKey(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Header Authorization: Bearer <TOKEN> obrigatório'
      });
    }

    const token = authHeader.slice(7).trim();
    const configuredKey = process.env.VIDEO_ENGINE_API_KEY;

    if (!configuredKey) {
      console.error('[API_V2 ERROR] VIDEO_ENGINE_API_KEY não configurada no .env');
      return res.status(500).json({
        success: false,
        error: 'SERVER_MISCONFIGURED',
        message: 'Configuração de segurança pendente no servidor'
      });
    }

    if (token !== configuredKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Token de autorização inválido'
      });
    }

    next();
  }
  ```
* Sem suporte a `x-api-key` para manter uma convenção única e padronizada.
* Sem secrets em frontend público.

---

## 5. Arquivos a Criar e Modificar

1. **`video_engine/api_v2.js` [NOVO]:**
   - Express Router para `/api/v2`.
   - Middleware `requireApiKey`.
   - Rota `POST /video-jobs`:
     ```javascript
     router.post('/video-jobs', requireApiKey, async (req, res) => {
       const { property_ref } = req.body || {};
       if (!property_ref || String(property_ref).trim() === '') {
         return res.status(400).json({
           success: false,
           error: 'INVALID_PARAMS',
           message: 'property_ref é obrigatório'
         });
       }

       try {
         const result = await jobService.initializeVideoJob({
           property_ref: String(property_ref).trim(),
           broker_id: 'marcel',
           source: 'web',
           metadata: {
             client_ip: req.ip,
             user_agent: req.headers['user-agent']
           }
         });

         if (!result.success) {
           return res.status(404).json({
             success: false,
             error: 'PROPERTY_NOT_FOUND',
             message: 'Imóvel não encontrado na carteira para a referência informada'
           });
         }

         if (!result.job) {
           return res.status(503).json({
             success: false,
             error: 'PERSISTENCE_UNAVAILABLE',
             message: 'Os dados e roteiros foram processados, mas o Job não pôde ser persistido no banco de dados',
             job_id: null,
             property: result.imovel,
             scripts: result.scripts
           });
         }

         return res.status(201).json({
           success: true,
           job_id: result.job.id,
           status: result.job.status,
           source: result.job.source,
           property: result.imovel,
           scripts: result.scripts
         });
       } catch (err) {
         console.error('[API_V2 ERROR] Erro inesperado:', err);
         return res.status(500).json({
           success: false,
           error: 'INTERNAL_ERROR',
           message: 'Erro interno ao processar criação de job'
         });
       }
     });
     ```

2. **`gestor_server.js` [MODIFICAR]:**
   - Inclusão de uma única linha de montagem:
     ```javascript
     // Rotas da Video Engine V2 (Independente de WhatsApp)
     app.use('/api/v2', require('./video_engine/api_v2'));
     ```

3. **`/var/www/bali-gestor/.env`:**
   - Adicionar chave secreta segura `VIDEO_ENGINE_API_KEY`.

---

## 6. O Que Permanece Rigorosamente Intocado

* ❌ Zero painel ou frontend visual nesta fase.
* ❌ Sem workers, sem BullMQ, sem filas em background.
* ❌ Sem state machine complexa além de `SCRIPT_READY`.
* ❌ Sem alteração em `CLONE`, `OK`, `GERAR RESTANTE`, áudios 1-4.
* ❌ Sem alteração nas integrações HeyGen, FFmpeg, Cloudflare R2.
* ❌ `activeVideoSessions` continua operando exclusivamente no WhatsApp V1.
* ❌ Zero duplicação da lógica de domínio: toda a inteligência permanece encapsulada em `video_engine/job_service.js`.

---

## 7. Plano de Testes e Homologação da Fase 1D

A homologação da Fase 1D cobrirá os 9 cenários de teste previstos:

1. **Criação de Job via HTTP sem WhatsApp:**
   - `curl -X POST http://localhost:3005/api/v2/video-jobs -H "Authorization: Bearer <KEY>" -d '{"property_ref":"1639"}'`
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
   - Enviar requisição sem header ou com token incorreto.
   - Validar retorno HTTP 401 `UNAUTHORIZED`.
7. **Falha de Persistência / PostgreSQL Offline (HTTP 503):**
   - Parar temporariamente o PostgreSQL (`systemctl stop postgresql`).
   - Disparar requisição HTTP com `#1639`.
   - Validar retorno HTTP 503 com `PERSISTENCE_UNAVAILABLE`, `job_id: null`, e dados de imóvel e scripts presentes.
   - Restaurar PostgreSQL imediatamente para `active`.
8. **WhatsApp V1 Continuando Operacional:**
   - Disparar teste de WhatsApp `#1639` e comprovar que a V1 continua entregando mensagens e criando sessão em memória.
9. **Saúde de Produção:**
   - Confirmar `bali-gestor` online no PM2 e PostgreSQL `active`.

---

## 8. Limites Explícitos da Fase 1D

* Esta fase NÃO cria tela de usuário (frontend).
* Esta fase NÃO executa renderização de vídeo pelo HTTP.
* A API atua puramente como um adaptador HTTP fino e seguro sobre o Job Core independente do WhatsApp.
