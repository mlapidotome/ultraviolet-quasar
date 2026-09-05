# Changelog: Fase 1B — Shadow Jobs no PostgreSQL

**Data de Conclusão:** 04/09/2026  
**Status:** HOMOLOGADO E CONCLUÍDO COM SUCESSO  
**Job de Homologação Real (UUID):** `a1aca1e3-c5d3-494c-89a2-2b49afd0a082`  
**Identificador Canônico:** `marcel` (eliminado qualquer uso de identificadores de teste)  

---

## 1. Escopo Executado e Objetivos Atingidos

1. **Criação de `video_job` em Persistência Paralela / Shadow**:
   - Toda consulta de imóvel real (`#REF`) pelo WhatsApp agora dispara a criação assíncrona de um registro na tabela `video_jobs`.
   - O registro captura o estado inicial completo: `property_ref`, `broker_id = 'marcel'`, `status = 'SCRIPT_READY'`, `source = 'whatsapp'`, `script_version = 1`, `property_snapshot` (dados completos do CRM) e `scripts_snapshot` (os 3 ganchos + corpo).
   - O UUID do registro gerado é salvo na sessão em memória: `session.videoJobId = job.id`.

2. **Garantia Absoluta de Degradação Graciosa (V1 Intacta)**:
   - A chamada `createVideoJob()` está contida em bloco `try/catch` dedicado.
   - Qualquer falha de banco (queda de conexão, timeout, serviço desligado) emite log de erro explícito (`[VIDEO_ENGINE ERROR]`), mas **não interrompe** a V1.
   - A sessão em memória `activeVideoSessions` continua sendo criada, as mensagens de consulta e roteiro continuam sendo entregues pelo WhatsApp, e os fluxos subsequentes (`CLONE`, 4 áudios, HeyGen, FFmpeg) funcionam normalmente.

3. **Validação Rigorosa de `broker_id`**:
   - Removido o fallback silencioso `broker_id || 'marcel_teste'` em `video_engine/db.js`.
   - `createVideoJob` agora valida obrigatoriamente a presença de `broker_id`, lançando erro descritivo caso omitido.
   - Utilizado identificador estável e explícito `marcel`.

4. **Escopo Restrito Respeitado**:
   - Zero workers, zero filas, zero recuperação operacional pelo banco.
   - `activeVideoSessions` continua sendo a única fonte da verdade operacional da V1.
   - Nenhuma alteração nas integrações com HeyGen, FFmpeg, Cloudflare R2 ou ImobTotal.

---

## 2. Diagrama Arquitetural do Fluxo V1 + Shadow V2

```
Mensagem WhatsApp (#1639)
          │
          ▼
Validação do Remetente & Formato
          │
          ▼
Busca Dados no CRM (ImobTotal)
          │
          ▼
Geração de Roteiros (3 Ganchos + Corpo)
          │
          ├────────────────────────────────────────────────┐
          ▼                                                ▼
[Caminho Operacional V1]                      [Caminho Shadow V2]
activeVideoSessions[sessionKey]               createVideoJob({
  ├── imovelRef: '1639'                         ├── property_ref: '1639'
  ├── imovelData: {...}                         ├── broker_id: 'marcel'
  ├── scripts: {...}                            ├── status: 'SCRIPT_READY'
  ├── waitingAudios: true                       ├── source: 'whatsapp'
  ├── audiosReceived: []                        ├── script_version: 1
  └── videoJobId: job.id <──── (referência) ────┤   property_snapshot: imovel
                                                ├── scripts_snapshot: scripts
          │                                     └── metadata: { from, to, session_key }
          ▼                                   })  [try/catch - degradação graciosa]
Envio de Roteiros no WhatsApp (2 msgs)
          │
          ▼
Fluxo Segue Normal (CLONE / Áudios)
```

---

## 3. Resultados dos Testes de Homologação

### Teste 1: Validação Unitária de `broker_id`
- **Cenário:** Chamada a `createVideoJob({ property_ref: '1639' })` omitindo `broker_id`.
- **Resultado:** Rejeição imediata com erro: `[DB] broker_id é obrigatório para criar um video_job`.
- **Status:** APROVADO.

### Teste 2: Fluxo Nominal Real (`#1639`)
- **Cenário:** Recebimento de `#1639` com remetente Marcel e `brokerId = 'marcel'`.
- **Resultado:**
  - Imóvel consultado na ImobTotal: *Apartamento com 2 quartos à venda, 75 m² por R$ 395.000 - Centro - Taubaté/SP - Edifício Diana*.
  - Roteiros gerados e enviados ao WhatsApp (2 mensagens).
  - Shadow Job criado com sucesso no PostgreSQL:
    - **UUID:** `a1aca1e3-c5d3-494c-89a2-2b49afd0a082`
    - **property_ref:** `'1639'`
    - **broker_id:** `'marcel'`
    - **status:** `'SCRIPT_READY'`
    - **property_snapshot:** Dados completos salvos como JSONB.
    - **scripts_snapshot:** 3 ganchos + corpo salvos como JSONB.
  - Leitura direta via `getVideoJobById(UUID)` validada.
- **Status:** APROVADO.

### Teste 3: Degradação Graciosa (PostgreSQL Offline)
- **Cenário:** Parada temporária do PostgreSQL (`systemctl stop postgresql` -> `inactive`). Disparo de `#1639`.
- **Resultado:**
  - Log registrou captura do erro: `[VIDEO_ENGINE ERROR] Falha ao criar shadow VideoJob no PostgreSQL para ref 1639`.
  - `activeVideoSessions` criada normalmente.
  - As 2 mensagens (consulta + roteiros) foram transmitidas normalmente ao cliente do WhatsApp.
  - Serviço PostgreSQL restaurado imediatamente (`systemctl start postgresql` -> `active`).
- **Status:** APROVADO.

### Teste 4: Saúde do PM2
- **Cenário:** Reinício do processo `bali-gestor` no PM2.
- **Resultado:** Processo `online` (pid `56925`), memória estável, portas HTTP ativas e cliente WhatsApp reconectado.
- **Status:** APROVADO.

---

## 4. Arquivos Modificados
1. `video_engine/db.js`: Adição de validação obrigatória para `broker_id` e remoção de fallback silencioso.
2. `video_anuncios_engine.js`: Importação de `createVideoJob`, inclusão do bloco shadow try/catch e vinculação de `session.videoJobId`.
