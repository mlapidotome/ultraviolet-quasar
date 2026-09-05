# Changelog: Fase 1A — Fundação de Persistência PostgreSQL & Tabela video_jobs

**Data de Conclusão:** 04/09/2026  
**Status:** CONCLUÍDO COM SUCESSO  
**Job de Teste (UUID):** `ea084896-a1b1-4d6f-8391-557a1e2fdb81`  

---

## 1. O Que Foi Realizado

1. **Instalação e Configuração do PostgreSQL 16**:
   - Pacotes oficiais `postgresql` e `postgresql-contrib` instalados no VPS Ubuntu 24.04.
   - Serviço ativo e habilitado no systemd (`systemctl is-active postgresql` -> active).
   - Cluster local configurado com banco de dados `bali_gestor` e usuário de aplicação dedicado `bali_user`.
   - Credenciais injetadas exclusivamente no `.env` com permissão 600 (sem commit).

2. **Criação da Migration Versionada**:
   - Arquivo: `migrations/001_create_video_jobs.sql`
   - Habilitação da extensão `pgcrypto` para UUIDs determinísticos/v4 (`gen_random_uuid()`).
   - Tabela `video_jobs` criada com campos obrigatórios (`id`, `property_ref`, `broker_id`, `status`, `source`, `script_version`, `created_at`, `updated_at`) e campos JSONB flexíveis (`property_snapshot`, `scripts_snapshot`, `metadata`).
   - Índices criados em `property_ref`, `status`, `broker_id` e `created_at DESC`.

3. **Módulo Isolado de Persistência**:
   - Arquivo: `video_engine/db.js`
   - Encapsulamento de conexão via `pg.Pool`.
   - Implementadas as funções puras:
     - `createVideoJob(data)`
     - `getVideoJobById(id)`
     - `updateVideoJob(id, patch)` com allowlist estrita e atualização automática de `updated_at = NOW()`.
     - `runMigrations()` executável somente de forma explícita (sem disparo em import).

4. **Isolamento e Risco Zero em Produção**:
   - `activeVideoSessions` permanece como fonte operacional atual da V1.
   - Nenhuma alteração feita em `video_anuncios_engine.js`, WhatsApp Web, HeyGen, ImobTotal ou FFmpeg.
   - Processo PM2 `bali-gestor` reiniciado e validado como `online`.

5. **Teste de Persistência em Duas Etapas**:
   - **Etapa 1:** Criação do job mock (`id: ea084896-a1b1-4d6f-8391-557a1e2fdb81`), leitura inicial e atualização de status para `PILOT_READY` com validação de `updated_at > created_at`.
   - **Etapa 2 (Pós-Restart):** Reinício manual do PM2 e execução de script independente de leitura. O registro persistiu 100% íntegro com todos os campos JSONB e timestamps intactos.


# Estado Atual do Sistema (Current State)

**Última Atualização:** 04/09/2026  
**Fase Concluída:** Fase 1A — Fundação de Persistência PostgreSQL  

---

## Componentes Ativos

1. **V1 em Produção (Operacional)**:
   - Motor: `video_anuncios_engine.js` (Gerenciamento via WhatsApp, Looks Marcel, Voz Clonada HeyGen, FFmpeg, Piloto Primeiro).
   - Sessões em Memória: `activeVideoSessions = {}` (Inalterado).
   - Processo PM2: `bali-gestor` (Porta 3005, Online).

2. **V2 Fundação de Persistência (Instalada e Testada)**:
   - Banco de Dados: PostgreSQL 16 (Localhost VPS, Banco: `bali_gestor`).
   - Tabela Mestre: `video_jobs` com suporte a UUID e JSONB.
   - Módulo de Acesso: `video_engine/db.js` com pool seguro e queries parametrizadas.
   - Migrations: Versionadas em `/migrations/`.
   - UUID de Homologação: `ea084896-a1b1-4d6f-8391-557a1e2fdb81` (Status: `PILOT_READY`).

3. **Próximo Passo Planejado**:
   - Fase 1B: Criação do worker de Jobs e transição não-destrutiva do estado em memória para o PostgreSQL.
