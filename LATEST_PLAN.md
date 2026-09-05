# Proposta Arquitetural & Plano de Implementação — Fase 2B (Revisado)
## Geração de Vídeo Piloto pelo Painel Web V2 (Vinculada ao Job)

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2B (Primeira Produção de Vídeo Iniciada pelo Painel Visual)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Permitir que, após criar um Job no painel web e inspecionar os roteiros gerados, Marcel possa acionar **“Gerar Piloto”**, disparando a produção do primeiro vídeo (Gancho 1 + Desenvolvimento/Corpo) **estritamente vinculado ao `job_id` no PostgreSQL, com proteção atômica contra concorrência, recuperação segura no boot (Smart Resume), entrega de vídeo protegida por autenticação (sem arquivos estáticos expostos) e zero dependência do fluxo WhatsApp V1**.

---

## 1. Diagnóstico dos Acoplamentos no Fluxo Legado (`CLONE` no WhatsApp)

A inspeção em `/var/www/bali-gestor/video_anuncios_engine.js` confirmou os seguintes gargalos e riscos arquiteturais da versão legada:

1. **Acoplamento com Memória Volátil (`activeVideoSessions`):**
   - O comando `CLONE` depende de um dicionário em memória RAM (`activeVideoSessions[sessionKey]`).
   - Se a sessão não existir na memória (ou se o PM2 reiniciar), o sistema recorre a um **fallback arbitrário para o imóvel `1639`** (`getOrInitSession("1639")`).

2. **Reutilização de Vídeo de Corpo Baseada em Varredura de Diretório:**
   - O motor busca o corpo executando:  
     `fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith("body_" + session.imovelRef) && f.endsWith(".mp4")).sort().reverse()[0]`
   - O sistema simplesmente escolhe o último arquivo por ordem alfabética de nome.
   - **Risco:** Se os roteiros foram alterados ou se outro corretor gerou o mesmo imóvel, o sistema reutiliza um arquivo defasado ou arbitrário sem validar versão nem Job ID.

3. **Sobrescrita Indiscriminada de Arquivos:**
   - O vídeo final é gravado com nome fixo `Anuncio_Completo_1_Imovel_<ref>.mp4`, sobrescrevendo execuções anteriores no disco.

4. **Perda de Rastreabilidade em Reinício do PM2:**
   - Os IDs de vídeo da HeyGen ficam exclusivamente em memória volátil. Reiniciar o PM2 interrompe o polling e perde o rastreio dos vídeos pagos.

---

## 2. Regras Arquiteturais Absolutas da Fase 2B

1. **Vínculo Unívoco ao `job_id`:**  
   Toda e qualquer operação de geração ou consulta é atrelada estritamente ao UUID do Job no PostgreSQL.  
   **Se o sistema não conseguir identificar exatamente qual Job está sendo continuado, ele para imediatamente.**  
   *Zero adivinhação de imóvel, zero adivinhação de sessão, zero fallback para `1639` e zero varredura de arquivos por `readdirSync`.*

2. **Transição Atômica de Concorrência no PostgreSQL:**  
   Não confiar em "ler status, verificar `SCRIPT_READY` e depois atualizar".  
   O bloqueio para início da renderização deve ser **atômico diretamente na instrução SQL**:
   ```sql
   UPDATE video_jobs
   SET status = 'PILOT_SUBMITTED', updated_at = NOW()
   WHERE id = $1
     AND status IN ('SCRIPT_READY', 'PILOT_FAILED')
   RETURNING *;
   ```
   - **Somente a requisição que obtiver linha no `RETURNING`** recebe permissão para disparar as chamadas à HeyGen.
   - Se nenhuma linha for atualizada:
     - Se o status atual for `PILOT_SUBMITTED` ou `PILOT_RENDERING`: retorna `HTTP 409 Conflict` (*"Geração de piloto já está em andamento para este Job."*);
     - Se o status for `PILOT_READY`: retorna `HTTP 200 OK` com os dados do piloto já existente (sem renderizar novamente);
     - Qualquer outro status: rejeita com `HTTP 400 Bad Request` indicando transição inválida.
   - **Garantia:** Duas requisições simultâneas nunca gerarão dois pilotos nem duplicarão consumo de créditos na HeyGen.

3. **Entrega de Vídeo 100% Protegida por Autenticação (Sem Diretório Estático Público):**  
   - O diretório `/outputs/jobs/` é explicitamente **bloqueado contra acesso estático público** (`HTTP 403 Forbidden`). Ninguém pode baixar o vídeo apenas por conhecer o UUID.
   - O vídeo do piloto é servido exclusivamente por rota autenticada com HTTP Basic Auth:
     `GET /api/v2/panel/video-jobs/:id/pilot`
   - O backend valida a existência do Job, checa que o path físico pertence estritamente ao `<job_id>`, bloqueia qualquer tentativa de *path traversal* e entrega o arquivo via `res.sendFile()` (com suporte nativo a range requests para o player HTML5).

4. **Identificador Durável: `heygen_video_id`:**  
   O identificador permanente da HeyGen é o **`heygen_video_id`** (string). URLs de download retornadas pela HeyGen são transitórias e não constituem fonte de verdade para recuperação futura.

5. **Mecanismo Explícito de Smart Resume no Startup (Sem Efeitos Colaterais no GET):**  
   - A rota `GET /api/v2/panel/video-jobs/:id` é **estritamente somente-leitura** e nunca dispara retomada ou renderização como efeito colateral.
   - O Smart Resume roda exclusivamente na **inicialização do servidor (startup hook)**:
     - Busca no banco Jobs em `PILOT_SUBMITTED` ou `PILOT_RENDERING`;
     - Executa `resumePilot(jobId)`;
     - Se os `heygen_video_id` já estiverem gravados, consulta a HeyGen usando esses IDs (nunca reenvia clips);
     - Se os clips estiverem prontos, procede com download e FFmpeg;
     - Se estiverem renderizando, reassume o polling;
     - Se o Job estiver travado há mais de 30 minutos ou a HeyGen tiver descartado os dados, marca `PILOT_FAILED` com mensagem descritiva para permitir nova tentativa limpa.

---

## 3. Diagrama do Fluxo Arquitetural Revisado

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PAINEL WEB (video-painel.html)                   │
│                                                                             │
│  Marcel visualiza Job SCRIPT_READY                                          │
│  Clica em "🎬 Gerar Vídeo Piloto"                                           │
│  Dispara: POST /api/v2/panel/video-jobs/:id/generate-pilot                  │
│  (Autenticado via HTTP Basic Auth)                                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP POST (Same-Origin BFF)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BACKEND EXPRESS (video_engine/api_v2.js)                │
│                                                                             │
│  TRANSIÇÃO ATÔMICA NO BANCO:                                                │
│  UPDATE video_jobs SET status = 'PILOT_SUBMITTED' ...                       │
│  WHERE id = $1 AND status IN ('SCRIPT_READY', 'PILOT_FAILED') RETURNING *   │
│                                                                             │
│  ├─ Se 0 linhas atualizadas:                                                │
│  │   ├─ Status atual PILOT_SUBMITTED / RENDERING ──> 409 Conflict           │
│  │   ├─ Status atual PILOT_READY ──> 200 OK (retorna piloto existente)     │
│  │   └─ Outro estado ──> 400 Bad Request                                    │
│  │                                                                          │
│  └─ Se 1 linha atualizada (Lock Atômico Conquistado):                       │
│      Dispara assincronamente: pilotService.generatePilot(jobId)             │
│      Retorna imediatamente: 202 Accepted { status: 'PILOT_SUBMITTED' }      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ORQUESTRADOR DO PILOTO (video_engine/pilot_service.js)       │
│                                                                             │
│  1. Lê scripts_snapshot e property_snapshot diretamente do Job no PostgreSQL │
│  2. Submete clips na HeyGen (Voz clonada Marcel):                           │
│     • Gancho 1 (Look Terno, avatar normal)                                  │
│     • Corpo (Look Terno, avatar círculo, foto do imóvel)                    │
│  3. GRAVAÇÃO IMEDIATA NO BANCO:                                             │
│     Salva heygen_video_id de cada clip em video_jobs.metadata.pilot         │
│     Atualiza status para 'PILOT_RENDERING'                                  │
│  4. Polling na API HeyGen até conclusão                                     │
│  5. Download dos vídeos para diretório isolado:                             │
│     outputs/jobs/<job_id>/hook_1.mp4                                        │
│     outputs/jobs/<job_id>/body.mp4                                          │
│  6. Concatenação via FFmpeg:                                                │
│     outputs/jobs/<job_id>/pilot.mp4                                         │
│  7. Validação de integridade do arquivo (> 0 bytes)                         │
│  8. Atualiza PostgreSQL:                                                    │
│     status = 'PILOT_READY', pilot_video_url = '/api/v2/panel/video-jobs/... │
│                                                                             │
│  ⚠️ Em caso de falha:                                                       │
│     status = 'PILOT_FAILED', error_message = <erro_detalhado>               │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 EXIBIÇÃO SEGURA DO VÍDEO NO NAVEGADOR                       │
│                                                                             │
│  Painel faz polling read-only: GET /api/v2/panel/video-jobs/:id             │
│  Quando status == PILOT_READY:                                              │
│  Player carrega rota autenticada:                                           │
│  <video controls src="/api/v2/panel/video-jobs/:id/pilot"></video>          │
│  🔒 Rota pública direta /outputs/jobs/... bloqueada com HTTP 403            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Persistência Mínima no PostgreSQL

### 4.1. Migração Estrutural: `migrations/002_add_pilot_fields_to_video_jobs.sql`
```sql
ALTER TABLE video_jobs 
  ADD COLUMN IF NOT EXISTS pilot_video_url TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_video_jobs_pilot_status ON video_jobs (status, created_at DESC);
```

### 4.2. Estrutura de `metadata.pilot` (JSONB)
```json
{
  "pilot": {
    "hook1": {
      "heygen_video_id": "v78a1bc90d",
      "heygen_video_url": "https://resource.heygen.ai/...",
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../hook_1.mp4",
      "submitted_at": "2026-09-05T03:00:00.000Z",
      "completed_at": "2026-09-05T03:01:00.000Z"
    },
    "body": {
      "heygen_video_id": "v89b2cd01e",
      "heygen_video_url": "https://resource.heygen.ai/...",
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../body.mp4",
      "submitted_at": "2026-09-05T03:00:05.000Z",
      "completed_at": "2026-09-05T03:01:10.000Z"
    },
    "final": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../pilot.mp4",
      "concatenated_at": "2026-09-05T03:01:30.000Z"
    },
    "attempts": 1,
    "started_at": "2026-09-05T02:59:30.000Z",
    "completed_at": "2026-09-05T03:01:30.000Z"
  }
}
```

> **Nota sobre `heygen_video_url`:** O campo `heygen_video_url` é armazenado em metadata estritamente para auditoria técnica imediata. Ele é temporário e expira. A recuperação futura e validação apoia-se unicamente no `heygen_video_id`.

---

## 5. Máquina de Estados e Matriz de Transições

| Estado Atual | Ação Solicitada | Próximo Estado | Resposta HTTP |
|---|---|---|---|
| `SCRIPT_READY` | `generate-pilot` | `PILOT_SUBMITTED` | `HTTP 202 Accepted` |
| `PILOT_FAILED` | `generate-pilot` (Retry) | `PILOT_SUBMITTED` | `HTTP 202 Accepted` |
| `PILOT_SUBMITTED` | `generate-pilot` (Concorrente) | *(Sem alteração)* | `HTTP 409 Conflict` |
| `PILOT_RENDERING` | `generate-pilot` (Concorrente) | *(Sem alteração)* | `HTTP 409 Conflict` |
| `PILOT_READY` | `generate-pilot` | *(Sem alteração)* | `HTTP 200 OK` (retorna dados existentes) |
| Qualquer | Falha de API/FFmpeg | `PILOT_FAILED` | `error_message` registrado |

---

## 6. Mecanismo de Smart Resume no Startup do Servidor

No arquivo principal (`gestor_server.js`), após a conexão do banco e subida dos módulos:

```javascript
// Recuperação limpa de jobs pendentes no boot (Smart Resume Fase 2B)
pilotService.initStartupRecovery().catch(err => {
  console.error('[PILOT RECOVERY ERROR] Erro na rotina de inicialização:', err.message);
});
```

### Comportamento da Função `initStartupRecovery()`:
1. Executa consulta direcionada:
   ```sql
   SELECT id, status, metadata, updated_at 
   FROM video_jobs 
   WHERE status IN ('PILOT_SUBMITTED', 'PILOT_RENDERING')
   ORDER BY created_at ASC;
   ```
2. Para cada Job localizado:
   - Se `updated_at` for anterior a **30 minutos**:
     Marca `status = 'PILOT_FAILED'`, `error_message = 'Renderização interrompida por reinício do servidor excedeu o tempo limite. Por favor, tente novamente.'`.
   - Se estiver dentro da janela de tempo:
     - Extrai `heygen_video_id` do Gancho 1 e do Corpo de `metadata.pilot`;
     - Se ambos os IDs existirem: consulta a HeyGen pelo status de cada um (**sem reenviar novo clip**);
     - Se ambos estiverem prontos: baixa os vídeos e dispara a concatenação FFmpeg para finalizar o Job (`PILOT_READY`);
     - Se ainda estiverem renderizando: retoma o loop assíncrono de polling;
     - Se algum clip falhou na HeyGen: marca `PILOT_FAILED` com o erro retornado pela HeyGen.

---

## 7. Rota Autenticada de Entrega do Vídeo Piloto

### Endpoint: `GET /api/v2/panel/video-jobs/:id/pilot`
* **Proteção:** `panelAuthMiddleware` (HTTP Basic Auth).
* **Regras de Negócio e Segurança:**
  1. Valida o formato UUID do parâmetro `:id`.
  2. Consulta o Job no banco. Se não existir: `HTTP 404 Not Found`.
  3. Se `status !== 'PILOT_READY'`: `HTTP 409 Conflict` (*"O vídeo piloto deste Job ainda não está pronto"*).
  4. Localiza o path físico do arquivo: `/var/www/bali-gestor/outputs/jobs/<job_id>/pilot.mp4`.
  5. Valida contra *path traversal* garantindo que o arquivo reside rigorosamente sob `outputs/jobs/<job_id>/`.
  6. Se o arquivo não existir fisicamente: `HTTP 404 Not Found`.
  7. Entrega o arquivo utilizando `res.sendFile()`, que automaticamente gerencia *Range requests* (HTTP 206) essenciais para busca e reprodução fluida no `<video>` HTML5.

### Bloqueio de Acesso Estático Direto:
Em `gestor_server.js`, antes de `app.use('/outputs', ...)`:
```javascript
// Bloquear acesso estático não autorizado a jobs da Video Engine
app.use('/outputs/jobs', (req, res) => res.status(403).send('Forbidden: Acesso direto bloqueado.'));
```

---

## 8. Arquivos a Criar e Modificar

1. **`migrations/002_add_pilot_fields_to_video_jobs.sql` [NOVO]:**
   - Criação das colunas `pilot_video_url` e `error_message`.

2. **`video_engine/pilot_service.js` [NOVO]:**
   - Funções:
     - `lockAndSubmitPilot(jobId)`: executa o `UPDATE ... RETURNING` atômico;
     - `generatePilot(jobId)`: orquestra HeyGen, download, FFmpeg e persistência;
     - `resumePilot(jobId)`: lógica de Smart Resume usando IDs persistidos;
     - `initStartupRecovery()`: varredura e recuperação no boot do servidor.

3. **`video_engine/api_v2.js` [MODIFICAR]:**
   - `POST /api/v2/panel/video-jobs/:id/generate-pilot`: aciona a transição atômica e disparo do piloto.
   - `GET /api/v2/panel/video-jobs/:id`: rota read-only pura de consulta do estado do Job.
   - `GET /api/v2/panel/video-jobs/:id/pilot`: rota autenticada para streaming do vídeo piloto.

4. **`gestor_server.js` [MODIFICAR]:**
   - Bloquear acesso estático a `/outputs/jobs`;
   - Iniciar `pilotService.initStartupRecovery()`.

5. **`video-painel.html` [MODIFICAR]:**
   - Inclusão do botão "Gerar Piloto";
   - Polling de status a cada 5s via `GET /api/v2/panel/video-jobs/:id`;
   - Player `<video controls src="/api/v2/panel/video-jobs/:id/pilot">` e botão de download quando `PILOT_READY`.

---

## 9. O Que Permanece Rigorosamente Intocado

* ❌ Sem geração dos Ganchos 2 e 3 nesta fase.
* ❌ WhatsApp V1 (`activeVideoSessions`, áudios 1-4, `CLONE`, `OK`) permanece 100% inalterado.
* ❌ Sem BullMQ, Redis ou filas distribuídas.
* ❌ Sem integração com Meta Ads ou ferramentas de edição.

---

## 10. Bateria de Testes e Homologação da Fase 2B

A homologação cobrirá os seguintes cenários estritos:

1. **Concorrência Atômica:**  
   Disparar duas requisições simultâneas de `generate-pilot` para o mesmo Job em `SCRIPT_READY`. Comprovar que apenas UMA recebe `HTTP 202 Accepted` e inicia a HeyGen; a segunda recebe `HTTP 409 Conflict`.
2. **Não Duplicação de Clips:**  
   Comprovar que a segunda requisição rejeitada não gerou novos `video_id` na HeyGen.
3. **Bloqueio de Acesso Estático Direto:**  
   Requisição direta a `http://localhost:3005/outputs/jobs/<job_id>/pilot.mp4` deve retornar `HTTP 403 Forbidden`.
4. **Entrega de Vídeo Autenticada:**  
   Requisição a `GET /api/v2/panel/video-jobs/:id/pilot` com Basic Auth deve retornar `HTTP 200 OK` (ou `HTTP 206 Partial Content`) e transmitir o vídeo correto.
5. **Smart Resume em Reinício do PM2:**  
   Simular interrupção durante `PILOT_RENDERING` com IDs persistidos no banco. Ao reiniciar o PM2, comprovar que `initStartupRecovery()` consulta os IDs existentes na HeyGen e NÃO reenvia os clips.
6. **Idempotência Estrita da Rota de Consulta:**  
   Múltiplas chamadas a `GET /api/v2/panel/video-jobs/:id` não alteram status nem disparam efeitos colaterais.
7. **Job Inexistente:**  
   Tentativa de gerar piloto para UUID aleatório retorna `HTTP 404 Not Found`.
8. **Resiliência a Erros de Renderização:**  
   Falha na HeyGen ou FFmpeg transita status de forma segura para `PILOT_FAILED` gravando `error_message`.
9. **Ciclo Completo com Sucesso:**  
   Geração nominal para imóvel `#1639` transita para `PILOT_READY` com vídeo montado e disponível no painel.
10. **Não-Regressão Total:**  
    WhatsApp V1 (`#REF`, `CLONE`) e rotas da Fase 1D/2A operando com 100% de normalidade.
11. **Saúde de Produção:**  
    PM2 `bali-gestor` online e PostgreSQL `active`.
