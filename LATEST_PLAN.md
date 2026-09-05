# Proposta Arquitetural & Plano de Implementação — Fase 2B
## Geração de Vídeo Piloto pelo Painel Web V2 (Vinculada ao Job)

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2B (Primeira Produção de Vídeo Iniciada pelo Painel Visual)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Permitir que, após criar um Job no painel web e inspecionar os roteiros gerados, Marcel possa acionar **“Gerar Piloto”**, disparando a produção do primeiro vídeo (Gancho 1 + Desenvolvimento/Corpo) **estritamente vinculado ao `job_id` no PostgreSQL, sem qualquer dependência de `activeVideoSessions`, sem adivinhar arquivos em disco e sem interferir no fluxo WhatsApp V1**.

---

## 1. Diagnóstico da Arquitetura do Fluxo Atual (`CLONE` no WhatsApp)

A inspeção detalhada em `/var/www/bali-gestor/video_anuncios_engine.js` identificou os seguintes pontos críticos e acoplamentos no fluxo legado:

1. **Acoplamento com Memória Volátil (`activeVideoSessions`):**
   - O comando `CLONE` depende de um objeto em memória indexado pelo número do remetente do WhatsApp (`activeVideoSessions[sessionKey]`).
   - Se a sessão não existir na memória (ou se o PM2 reiniciar), o sistema invoca `getOrInitSession("1639")`, que recorre a um **fallback hardcoded para o imóvel `1639`**.

2. **Reutilização de Vídeo de Corpo Baseada em Varredura de Disco:**
   - O motor busca o corpo executando:
     `fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith("body_" + session.imovelRef) && f.endsWith(".mp4")).sort().reverse()[0]`
   - O sistema simplesmente seleciona o arquivo mais recente que case com o padrão de nome.
   - **Risco Crítico no V1:** Se os roteiros foram alterados, se outro corretor gerou o mesmo imóvel ou se houve falha parcial anterior, o sistema reutiliza um vídeo de corpo defasado ou arbitrário sem validar versão de script ou identificador único de trabalho.

3. **Nomenclatura com Sobrescrita de Arquivos:**
   - O vídeo final gerado é salvo como `Anuncio_Completo_1_Imovel_<ref>.mp4`.
   - Qualquer nova execução sobrescreve diretamente o arquivo anterior no diretório `outputs/`.

4. **Perda Total de Contexto em Restart do PM2:**
   - Como os IDs dos vídeos da HeyGen (`video_id`) e o estado intermediário ficam apenas na RAM da sessão, qualquer reinicialização do PM2 interrompe o polling e descarta o contexto, impossibilitando a recuperação ou o download do vídeo já pago na HeyGen.

---

## 2. Regra Arquitetural Absoluta para a Fase 2B

> **Regra Primária de Confiabilidade V2:**  
> A execução da Fase 2B é **100% vinculada ao `job_id` (UUID)** registrado no PostgreSQL.  
> Se o sistema não conseguir identificar exatamente qual Job está sendo continuado, **ele deve parar imediatamente**.  
> É terminantemente proibido:
> * Adivinhar imóvel;
> * Adivinhar sessão;
> * Reutilizar vídeos por busca de arquivos em diretório (`readdirSync`);
> * Recorrer a fallbacks arbitrários (como `1639`);
> * Depender de `activeVideoSessions`.

---

## 3. Arquitetura Proposta: `pilot_service.js` Isolado e Orientado a `job_id`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PAINEL WEB (video-painel.html)                   │
│                                                                             │
│  Marcel visualiza o Job (ex: SCRIPT_READY)                                  │
│  Clica em: "🎬 Gerar Vídeo Piloto"                                          │
│  Dispara: POST /api/v2/panel/video-jobs/:id/generate-pilot                  │
│  (Autenticado via HTTP Basic Auth)                                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP POST (Same-Origin BFF)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BACKEND EXPRESS (video_engine/api_v2.js)                │
│                                                                             │
│  1. Valida existência do Job pelo :id                                       │
│  2. Valida status (deve ser SCRIPT_READY ou PILOT_FAILED)                   │
│  3. Se já em processamento (PILOT_SUBMITTED / RENDERING): 409 Conflict      │
│  4. Atualiza status no PostgreSQL para PILOT_SUBMITTED                      │
│  5. Dispara execução assíncrona em video_engine/pilot_service.js            │
│  6. Retorna 202 Accepted { success: true, status: 'PILOT_SUBMITTED' }       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ORQUESTRADOR DO PILOTO (video_engine/pilot_service.js)       │
│                                                                             │
│  1. Carrega Job completo do PostgreSQL pelo UUID:                           │
│     • property_snapshot (dados e fotos do imóvel)                           │
│     • scripts_snapshot (Gancho 1 + Corpo com respectivos Looks)             │
│  2. Submete clips na HeyGen (Voz clonada Marcel):                           │
│     • Gancho 1: Look Terno, avatar normal                                   │
│     • Corpo: Look Terno, avatar círculo, foto do imóvel ao fundo            │
│  3. Registra heygen_video_id de cada clip em video_jobs.metadata.pilot      │
│  4. Atualiza status para PILOT_RENDERING                                    │
│  5. Realiza Polling na API HeyGen até conclusão                             │
│  6. Faz download dos MP4 para diretório isolado:                            │
│     outputs/jobs/<job_id>/hook_1.mp4                                        │
│     outputs/jobs/<job_id>/body.mp4                                          │
│  7. Concatena com FFmpeg em outputs/jobs/<job_id>/pilot.mp4                 │
│  8. Valida integridade do arquivo gerado (tamanho > 0, duração válida)       │
│  9. Atualiza PostgreSQL:                                                    │
│     • status = 'PILOT_READY'                                                │
│     • pilot_video_url = '/outputs/jobs/<job_id>/pilot.mp4'                  │
│     • metadata.pilot.completed_at = now()                                   │
│                                                                             │
│  ⚠️ Em caso de qualquer erro:                                               │
│     • status = 'PILOT_FAILED'                                               │
│     • error_message = <detalhes do erro>                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Persistência Mínima Necessária no PostgreSQL

### 4.1. Migração Estrutural da Tabela `video_jobs`
Será criada uma migração mínima `002_add_pilot_fields_to_video_jobs.sql`:

```sql
-- Adicionar colunas diretas para acesso rápido e indexação
ALTER TABLE video_jobs 
  ADD COLUMN IF NOT EXISTS pilot_video_url TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Índice para consultas de auditoria de status
CREATE INDEX IF NOT EXISTS idx_video_jobs_pilot_status ON video_jobs (status, created_at DESC);
```

### 4.2. Estrutura dos Metadados do Piloto em `metadata.pilot` (JSONB)
Todos os detalhes técnicos da renderização ficam registrados dentro do campo `metadata` já existente:

```json
{
  "pilot": {
    "hook1": {
      "heygen_video_id": "v78a1bc90d",
      "heygen_video_url": "https://resource.heygen.ai/...",
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../hook_1.mp4",
      "rendered_at": "2026-09-05T03:00:00.000Z"
    },
    "body": {
      "heygen_video_id": "v89b2cd01e",
      "heygen_video_url": "https://resource.heygen.ai/...",
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../body.mp4",
      "rendered_at": "2026-09-05T03:01:00.000Z"
    },
    "final": {
      "local_path": "/var/www/bali-gestor/outputs/jobs/f8099b3d.../pilot.mp4",
      "public_url": "/outputs/jobs/f8099b3d.../pilot.mp4",
      "concatenated_at": "2026-09-05T03:01:30.000Z"
    },
    "attempts": 1,
    "started_at": "2026-09-05T02:59:30.000Z",
    "completed_at": "2026-09-05T03:01:30.000Z"
  }
}
```

---

## 5. Máquina de Estados Mínima do Job na Fase 2B

| Estado | Significado | Ações Permitidas |
|---|---|---|
| `SCRIPT_READY` | Imóvel e roteiros gerados no banco. Piloto não iniciado. | Marcel pode clicar em **"Gerar Piloto"**. |
| `PILOT_SUBMITTED` | Pedido de piloto recebido; clips submetidos à HeyGen. | Painel exibe spinner e desabilita botões. |
| `PILOT_RENDERING` | HeyGen processando áudio, sincronia labial e vídeo. | Painel realiza polling periódico (`GET /api/v2/panel/video-jobs/:id`). |
| `PILOT_READY` | Clips baixados, concatenados com FFmpeg e validados. | Painel exibe player de vídeo, link de download e status verde. |
| `PILOT_FAILED` | Falha na HeyGen, timeout, download corrompido ou erro FFmpeg. | Painel exibe erro amigável e botão **"Tentar Novamente"**. |

#### Prevenção de Concorrência e Conflito de Estados:
* Se uma requisição para gerar piloto chegar para um Job com status `PILOT_SUBMITTED` ou `PILOT_RENDERING`, a API rejeita imediatamente com `HTTP 409 Conflict`:
  ```json
  {
    "success": false,
    "error": "PILOT_ALREADY_IN_PROGRESS",
    "message": "A geração do piloto já está em andamento para este Job."
  }
  ```
* Se o status já for `PILOT_READY`, a API retorna `HTTP 200 OK` informando que o piloto já está pronto, devolvendo a URL existente sem gastar novos créditos de renderização.

---

## 6. Isolamento e Estrutura de Arquivos em Disco

Para erradicar qualquer conflito entre execuções e garantir rastreabilidade física:

```text
/var/www/bali-gestor/outputs/
└── jobs/
    └── <job_id>/
        ├── hook_1.mp4
        ├── body.mp4
        ├── concat_list.txt (temporário, removido após FFmpeg)
        └── pilot.mp4
```

* Cada Job possui seu próprio subdiretório baseado no UUID (`outputs/jobs/<job_id>/`).
* O vídeo piloto fica acessível publicamente no navegador via rota estática já existente:
  `http://<host>/outputs/jobs/<job_id>/pilot.mp4`.

---

## 7. Estratégia de Recuperação e Resiliência em Caso de Restart do PM2

O que acontece se o servidor ou o PM2 reiniciar durante o processo da HeyGen?

1. **Gravação Imediata dos Identificadores HeyGen:**
   - Assim que a HeyGen responde com o `video_id` de cada clip, eles são **imediatamente persistidos no PostgreSQL** (`metadata.pilot.hook1.heygen_video_id` e `metadata.pilot.body.heygen_video_id`), antes de iniciar o loop de espera.
2. **Ao reiniciar ou ao consultar o Job:**
   - Se o servidor reiniciar e o Job estiver em `PILOT_SUBMITTED` ou `PILOT_RENDERING`:
     - O serviço inspeciona o `updated_at` e os `video_id` salvos.
     - **Retomada Segura (Smart Resume):** Como os IDs existem no banco, o sistema pode consultar o status na HeyGen sem reenviar e sem gastar novos créditos. Se já estiverem prontos, realiza o download e monta o vídeo.
     - **Falha Explícita (Timeout Fallback):** Se a solicitação tiver mais de 20 minutos ou a HeyGen tiver descartado os dados, o status é alterado de forma transparente para `PILOT_FAILED` com a mensagem: *"Processamento interrompido por reinicialização do servidor. Clique em Tentar Novamente."*
3. **Nenhum contexto é esquecido ou deduzido.**

---

## 8. Alterações na Interface Web (`video-painel.html`)

A interface continuará leve e em Vanilla JS, ganhando as seguintes capacidades visuais:

1. **Seção de Ação do Piloto (no Card do Job):**
   - Quando `status === 'SCRIPT_READY'`:
     Exibe botão: `🎬 Gerar Vídeo Piloto (Gancho 1 + Corpo)`.
   - Quando `status === 'PILOT_SUBMITTED'` ou `PILOT_RENDERING'`:
     Botão desabilitado com spinner ativo: `⏳ Renderizando Piloto na HeyGen (pode levar 1 a 2 min)...`.
     Inicia polling automático a cada 5 segundos para `GET /api/v2/panel/video-jobs/:id`.
   - Quando `status === 'PILOT_READY'`:
     Badge verde `PILOT_READY`.
     Card de Vídeo com player HTML5 `<video controls src="/outputs/jobs/<job_id>/pilot.mp4">`.
     Botão para abrir em nova aba / fazer download.
   - Quando `status === 'PILOT_FAILED'`:
     Badge vermelho `PILOT_FAILED`.
     Alerta de erro com a mensagem descritiva.
     Botão reabilitado: `🔄 Tentar Novamente`.

---

## 9. Arquivos a Criar e Modificar

1. **`migrations/002_add_pilot_fields_to_video_jobs.sql` [NOVO]:**
   - Adiciona `pilot_video_url` e `error_message` à tabela `video_jobs`.

2. **`video_engine/pilot_service.js` [NOVO]:**
   - Módulo isolado contendo as funções:
     - `generatePilot(jobId)`
     - `checkPilotStatus(jobId)`
     - Chamadas à HeyGen (avatar, voz clonada, fundo dinâmico), downloads de stream para disco e concatenação FFmpeg.

3. **`video_engine/api_v2.js` [MODIFICAR]:**
   - Adicionar rotas BFF do painel (protegidas por Basic Auth):
     - `POST /api/v2/panel/video-jobs/:id/generate-pilot`
     - `GET /api/v2/panel/video-jobs/:id`
   - Adicionar rotas externas equivalentes (protegidas por Bearer Token):
     - `POST /api/v2/video-jobs/:id/generate-pilot`
     - `GET /api/v2/video-jobs/:id`

4. **`video-painel.html` [MODIFICAR]:**
   - Inclusão do botão "Gerar Piloto", polling de status e player de vídeo para exibição do resultado.

---

## 10. Limites Explícitos da Fase 2B

* ❌ **Sem geração dos vídeos restantes**: Apenas o Piloto (Gancho 1 + Corpo) é produzido nesta fase. Ganchos 2 e 3 não são renderizados.
* ❌ **Sem editor de vídeo ou customização manual de timeline**.
* ❌ **Sem integração ou envio para Meta Ads / Facebook**.
* ❌ **Sem gerenciador de biblioteca ou galeria histórica**.
* ❌ **Fluxo WhatsApp V1 100% Intacto**: O comando `CLONE` e `activeVideoSessions` continuam operando paralelamente sem qualquer interferência.

---

## 11. Bateria de Testes e Homologação da Fase 2B

1. **Job Inexistente:**  
   Submeter `POST /api/v2/panel/video-jobs/00000000-0000-0000-0000-000000000000/generate-pilot`.  
   Deve retornar `HTTP 404 Not Found` e recusar a operação sem tentar adivinhar imóvel.
2. **Job Válido em `SCRIPT_READY`:**  
   Submeter comando para Job existente.  
   Deve retornar `HTTP 202 Accepted` e transitar status para `PILOT_SUBMITTED`.
3. **Prevenção de Duplicidade:**  
   Submeter nova chamada enquanto o piloto estiver renderizando.  
   Deve retornar `HTTP 409 Conflict` impedindo gasto duplo de créditos.
4. **Resiliência a Falhas de API (HeyGen com Erro):**  
   Simular ou testar payload inválido; deve transitar para `PILOT_FAILED` e gravar `error_message`.
5. **Resiliência a Falhas de Concatenação (FFmpeg):**  
   Garantir captura de erro e transição segura para `PILOT_FAILED` sem travar o processo Express.
6. **Ciclo Completo de Produção do Piloto:**  
   Executar geração real para o imóvel `#1639`.  
   Acompanhar transição: `PILOT_SUBMITTED` → `PILOT_RENDERING` → `PILOT_READY`.
7. **Validação do Arquivo Gerado:**  
   Verificar existência física de `outputs/jobs/<job_id>/pilot.mp4`, integridade do arquivo (> 0 bytes) e reprodução via `/outputs/jobs/<job_id>/pilot.mp4`.
8. **Conferência no PostgreSQL:**  
   Verificar preenchimento de `status = 'PILOT_READY'`, `pilot_video_url` e metadados com timestamps e IDs da HeyGen.
9. **Zero Dependência de `activeVideoSessions`:**  
   Comprovar que `activeVideoSessions` permanece inalterado e não é lido nem escrito pelo fluxo do painel.
10. **Zero Advinhação de Body:**  
    Comprovar que o vídeo foi gerado estritamente para o `job_id` sem reutilizar arquivos soltos de diretório.
11. **Não-Regressão Total:**  
    WhatsApp V1 (`#REF`, `CLONE`) e rotas criadas na Fase 1D/2A operando com 100% de normalidade.
12. **Saúde de Produção:**  
    PM2 `bali-gestor` online e PostgreSQL `active`.
