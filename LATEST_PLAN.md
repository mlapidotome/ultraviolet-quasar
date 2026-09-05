# Plano de Implementação — Fase 1B: Persistência Shadow de Jobs no PostgreSQL

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase Atual:** 1B (Shadow Jobs)  
**Status do Plano:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo:** Criar um registro persistente (`video_job`) no PostgreSQL sempre que um imóvel real for carregado pelo fluxo de atendimento do WhatsApp, operando em modo shadow/paralelo, sem substituir a memória de sessão (`activeVideoSessions`) e com garantia absoluta de não interrupção da produção V1.

---

## 1. Princípios e Regras Fundamentais da Fase 1B

1. **V1 Intacta e Operacional:**
   - `activeVideoSessions` continua sendo a **única fonte da verdade operacional** para todas as interações do usuário.
   - Nenhuma decisão operacional da V1 fará leitura do banco de dados nesta fase.

2. **Garantia Crítica de Degradação Graciosa (Resiliência):**
   - A chamada para salvar no banco é estritamente assíncrona e envolvida em bloco `try/catch`.
   - Se o PostgreSQL estiver offline, reiniciar, recusar conexão ou apresentar timeout:
     - O erro será registrado de forma explícita no log (`console.error`).
     - O fluxo V1 **NÃO será interrompido**: a sessão em memória será criada normalmente, o roteiro será enviado ao WhatsApp e os comandos subsequentes (`CLONE`, áudios) continuarão funcionando 100%.

3. **Remoção de Fallbacks Silenciosos e Sem Fallback de Imóvel:**
   - O fallback `broker_id || 'marcel_teste'` será removido de `video_engine/db.js`. O `broker_id` deverá ser fornecido obrigatoriamente ou lançar erro claro.
   - O imóvel consultado e persistido no Job será estritamente a referência real enviada na mensagem do WhatsApp (sem fallback para 1639).

4. **Escopo Deliberadamente Restrito (O que NÃO será feito nesta fase):**
   - ❌ NÃO criar workers em segundo plano.
   - ❌ NÃO criar filas (BullMQ, Redis, etc.).
   - ❌ NÃO criar state machine complexa além de `SCRIPT_READY`.
   - ❌ NÃO recuperar sessões a partir do banco de dados.
   - ❌ NÃO alterar a lógica de geração de roteiros, busca no CRM, HeyGen, FFmpeg, Cloudflare R2 ou comandos `CLONE` / `OK` / áudios.

---

## 2. Mudanças Arquiteturais Propostas

```
Mensagem WhatsApp (#REF)
       │
       ▼
Validação & Busca CRM (ImobTotal)
       │
       ▼
Geração de Roteiros (3 Ganchos + Corpo)
       │
       ├──────────────────────────────────────────────┐
       ▼                                              ▼
[Caminho Operacional V1]                    [Caminho Shadow V2]
activeVideoSessions[sessionKey]             createVideoJob({
  ├── imovelRef                               ├── property_ref: ref
  ├── imovelData                              ├── broker_id: brokerId
  ├── scripts                                 ├── status: 'SCRIPT_READY'
  ├── waitingAudios: true                     ├── source: 'whatsapp'
  ├── audiosReceived: []                      ├── script_version: 1
  └── videoJobId: job.id <─── (vínculo) ──────┤   property_snapshot: imovel
                                              ├── scripts_snapshot: scripts
       │                                      └── metadata: { from, to, ... }
       ▼                                    })  [try/catch - degradação graciosa]
Envio de Roteiro no WhatsApp
```

---

## 3. Especificação dos Componentes e Arquivos

### A. Módulo de Banco (`video_engine/db.js`)
- **Ajuste na validação de `createVideoJob(data)`**:
  - Validar obrigatoriedade estrita de `data.broker_id`.
  - Lançar erro: `if (!data.broker_id) throw new Error('[DB] broker_id é obrigatório para criar um video_job');`
  - Remover a expressão `data.broker_id || 'marcel_teste'` na lista de parâmetros da query SQL.

### B. Motor de Vídeo (`video_anuncios_engine.js`)
- Importar `createVideoJob` do módulo `./video_engine/db`.
- No manipulador de detecção de código de imóvel (após buscar dados no CRM e gerar roteiros):
  1. Instanciar `activeVideoSessions[sessionKey]` com o payload padrão da V1.
  2. Executar bloco de persistência paralela:
     ```javascript
     try {
       const job = await createVideoJob({
         property_ref: ref,
         broker_id: brokerId,
         status: 'SCRIPT_READY',
         source: 'whatsapp',
         script_version: 1,
         property_snapshot: imovel,
         scripts_snapshot: scripts,
         metadata: {
           session_key: sessionKey,
           from: msg.from,
           to: msg.to,
           channel: 'whatsapp_self_chat'
         }
       });
       session.videoJobId = job.id;
       console.log('[VIDEO_ENGINE] Shadow Job persistido:', job.id);
     } catch (err) {
       console.error('[VIDEO_ENGINE ERROR] Falha ao persistir shadow job no PostgreSQL:', err.message);
       // Não relança o erro: o fluxo V1 segue intacto
     }
     ```
  3. Enviar mensagem de resposta com os roteiros no WhatsApp normalmente.

---

## 4. Plano de Verificação e Homologação

A execução deste plano seguirá 4 testes rigorosos e controlados:

### Teste 1: Validação Unitária de `broker_id` em `db.js`
- Executar chamada a `createVideoJob` omitindo `broker_id`.
- Comprovar que a função rejeita a operação com erro claro e não aplica nenhum valor padrão.

### Teste 2: Fluxo Real Controlado (Cenário Nominal)
- Simular o recebimento de mensagem com referência real (`#1639`) e `brokerId = 'marcel_teste'`.
- Validar:
  1. Imóvel consultado na API ImobTotal.
  2. Roteiro gerado e retornado ao WhatsApp.
  3. Sessão em memória (`activeVideoSessions['marcel']`) criada.
  4. Registro inserido na tabela `video_jobs` com:
     - `property_ref = '1639'`
     - `broker_id = 'marcel_teste'`
     - `status = 'SCRIPT_READY'`
     - `source = 'whatsapp'`
     - `property_snapshot` idêntico aos dados do imóvel.
     - `scripts_snapshot` idêntico aos roteiros gerados.
  5. `session.videoJobId` preenchido exatamente com o UUID retornado pelo PostgreSQL.
  6. Consulta SQL direta pelo UUID validando integridade de todos os campos.

### Teste 3: Teste de Degradação Graciosa (Falha Simulada do PostgreSQL)
- Parar temporariamente o serviço PostgreSQL (`systemctl stop postgresql`) em ambiente controlado.
- Disparar o comando com referência de imóvel.
- Validar:
  1. A tentativa de criação do Job gera log explícito de erro (`[VIDEO_ENGINE ERROR]`).
  2. A sessão `activeVideoSessions` é criada normalmente (com `videoJobId = undefined`).
  3. A mensagem com os roteiros é enviada ao WhatsApp sem qualquer falha ou travamento.
- Restaurar imediatamente o banco de dados (`systemctl start postgresql`).
- Confirmar que o serviço PostgreSQL voltou ao estado `active`.

### Teste 4: Verificação do Processo PM2
- Verificar saúde do processo `bali-gestor` no PM2 (`pm2 status`, `pm2 logs`).
- Confirmar que o socket do WhatsApp permaneceu online durante todo o processo.

---

## 5. Entregáveis e Documentação da Fase 1B

Ao finalizar a execução (após aprovação prévia):
1. Criação do changelog detalhado em:  
   `docs/video_engine/changelog/PHASE_1B_SHADOW_JOBS.md`
2. Atualização do documento de arquitetura e status em:  
   `CURRENT_STATE.md`
3. Commit e push para o branch `main` no GitHub.
4. Exibição do relatório final com UUIDs dos testes, diff de alterações e resumo pronto para compartilhamento com o ChatGPT.
