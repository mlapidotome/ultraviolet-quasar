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
