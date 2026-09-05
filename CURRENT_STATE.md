# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 04/09/2026  
**Fase Atual Concluída:** Fase 1B — Shadow Jobs no PostgreSQL  
**Próxima Fase:** Fase 1C — Rastreamento de Estado Shadow (ou a definir)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 56925)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Visão Geral da Arquitetura Atual

A Video Engine opera atualmente em um modelo híbrido **V1 Operacional + V2 Shadow**:

* **Fonte da Verdade Operacional (V1):**  
  `activeVideoSessions` em memória continua sendo a fonte responsável por gerenciar estados em tempo real, etapas de áudio, comandos `CLONE` e envio de vídeos finais via WhatsApp.

* **Persistência Shadow Paralela (V2):**  
  A cada requisição de imóvel válida (`#REF`), um registro na tabela `video_jobs` do PostgreSQL é criado automaticamente com status `SCRIPT_READY`, contendo os snapshots do CRM e dos roteiros, e associando seu UUID à sessão em memória (`session.videoJobId = job.id`).

* **Garantia de Degradação Graciosa:**  
  A gravação em banco é não-bloqueante. Se o PostgreSQL estiver offline, um erro é registrado no log e a produção V1 continua funcionando sem interrupções.

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video_engine/db.js`:  
  Módulo de persistência encapsulado via `pg.Pool`. Exporta `createVideoJob`, `getVideoJobById`, `updateVideoJob` (com allowlist estrita e `updated_at = NOW()`) e `runMigrations`. Valida obrigatoriedade estrita de `property_ref` e `broker_id`.

* `/var/www/bali-gestor/migrations/001_create_video_jobs.sql`:  
  Migration estrutural com extensão `pgcrypto`, tabela `video_jobs` e índices otimizados para `property_ref`, `broker_id`, `status` e `created_at DESC`.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Motor unificado de anúncios integrado ao WhatsApp, HeyGen, FFmpeg e Cloudflare R2, com persistência shadow no PostgreSQL e identificador canônico `marcel`.

* `/var/www/bali-gestor/.env`:  
  Arquivo de credenciais e secrets em produção (permissão 600, excluído do versionamento).

---

## 3. Histórico de Homologações

* **Fase 1A (Fundação PostgreSQL & video_jobs):**  
  UUID de Teste: `ea084896-a1b1-4d6f-8391-557a1e2fdb81`  
  Validação de CRUD, tipos JSONB e resiliência após restart do processo PM2.

* **Fase 1B (Shadow Jobs no Fluxo Real):**  
  UUID de Homologação Real: `a1aca1e3-c5d3-494c-89a2-2b49afd0a082`  
  Validação de:
  - Rejeição unitária de `broker_id` ausente.
  - Criação automática de Job com `#1639` (`broker_id = 'marcel'`, status `SCRIPT_READY`).
  - Degradação graciosa confirmada com PostgreSQL offline (roteiros e sessão mantidos intactos na V1).
  - Restauração automática do banco e saúde do PM2.
