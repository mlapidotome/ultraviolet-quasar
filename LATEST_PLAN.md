# Inspeção Técnica Pré-Implementação: V2 Video Engine & Persistência PostgreSQL

**Data da Inspeção:** 04/09/2026  
**Servidor:** VPS DigitalOcean (Ubuntu 24.04 LTS Noble Numbat)  
**Projeto:** Bali Imóveis / Video Engine  

---

## 1. Diagnóstico do Ambiente Encontrado

### A. PostgreSQL no Sistema Operacional (VPS)
* **Binário `psql`:** Não instalado (`which psql` -> *not found*).
* **Serviço PostgreSQL:** Inexistente/Inativo (`systemctl is-active postgresql` -> *inactive*).
* **Pacotes dpkg:** Nenhum pacote PostgreSQL instalado no sistema.
* **Recursos de Hardware do Host:**
  * **RAM Total:** 2.0 GB (com ~908 MB disponíveis em repouso).
  * **Swap:** 6.0 GB configurado.
  * **Disco:** 24 GB no volume principal, com 9.0 GB livres (62% de uso).
  * *Conclusão de Capacidade:* O servidor possui folga de memória e disco perfeitamente dimensionada para rodar uma instância local do PostgreSQL (consumo de ~25 a 35 MB de RAM em idle).

### B. Dependências de Banco no `package.json`
* O driver nativo `pg` (node-postgres) **não está instalado**.
* Dependências existentes relacionadas a dados:
  * `@supabase/supabase-js: ^2.101.1` (sem credenciais de acesso ativas no ambiente).
  * `sqlite3: ^6.0.1` (presente no `package.json`, porém sem utilização ativa no código).

### C. Persistência Atual do `bali-gestor`
* O sistema opera atualmente sobre **arquivos JSON planos** no diretório `/var/www/bali-gestor/data/`:
  * `banco_imoveis_carteira.json` (1.2 MB)
  * `banco_leads_atendimentos.json` (3.8 MB)
  * `banco_compradores_perfil.json`
  * `campanhas_reativacao.json`
* Na engine de vídeo (`video_anuncios_engine.js`), o controle de estado é **100% volátil em memória RAM** (`const activeVideoSessions = {};`).

---

## 2. Decisão de Infraestrutura e Banco de Dados

Como não existe PostgreSQL pré-configurado, a abordagem mais sólida, isolada e com menor latência para a V2 é:
1. Instalar os pacotes oficiais `postgresql` e `postgresql-contrib` diretamente no Ubuntu via `apt-get`.
2. Inicializar um cluster local seguro ouvindo em `localhost:5432`.
3. Criar o banco de dados dedicado `bali_gestor`.
4. Criar um usuário de aplicação (`bali_user`) com permissões restritas e senha forte gerada aleatoriamente.
5. Injetar as credenciais exclusivamente no arquivo `/var/www/bali-gestor/.env` (permissões 600, fora do controle de versão).

---

## 3. Plano de Arquivos (Modificações e Criações)

### A. Arquivos a Criar:
1. **`migrations/001_create_video_jobs.sql`**:
   * Extensão para geração de UUID (`gen_random_uuid()`).
   * Schema da tabela `video_jobs`:
     * `id` (UUID, PK, default gen_random_uuid())
     * `property_ref` (VARCHAR(50), NOT NULL)
     * `broker_id` (VARCHAR(100), NOT NULL)
     * `status` (VARCHAR(50), NOT NULL, ex: 'PENDING', 'PILOT_RENDERING', 'PILOT_READY', 'COMPLETED', 'FAILED')
     * `source` (VARCHAR(50), default 'whatsapp')
     * `script_version` (INTEGER, default 1)
     * `property_snapshot` (JSONB)
     * `scripts_snapshot` (JSONB)
     * `metadata` (JSONB)
     * `created_at` (TIMESTAMP WITH TIME ZONE, default NOW())
     * `updated_at` (TIMESTAMP WITH TIME ZONE, default NOW())
2. **`video_engine/db.js`**:
   * Módulo isolado de acesso ao PostgreSQL utilizando `pg.Pool`.
   * Leitura de credenciais estritamente via `process.env` (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`).
   * Funções exportadas:
     * `createVideoJob(data)`
     * `getVideoJobById(id)`
     * `updateVideoJob(id, patch)`
     * `runMigrations()`
3. **`scripts/test_video_jobs_persistence.js`**:
   * Script de teste que executa: Conexão -> CREATE job -> READ por ID -> UPDATE status -> READ validando persistência -> RESTART de processo -> READ pós-restart.
   * Não executa nenhuma chamada a HeyGen, WhatsApp, FFmpeg ou ImobTotal.

### B. Arquivos a Modificar:
1. **`package.json`**: Adição da dependência oficial `pg` (`npm install pg`).
2. **`.env`**: Inclusão das variáveis de ambiente de conexão ao PostgreSQL (sem versionamento).
3. **`.env.example`**: Inclusão das variáveis documentais do PostgreSQL com valores fictícios.

### C. O Que NÃO Será Modificado (Garantia de Risco Zero):
* `video_anuncios_engine.js`: **Zero alterações funcionais.**
* `activeVideoSessions`: Permanece como a fonte da verdade operacional da V1.
* Fluxo do WhatsApp, comandos `CLONE`, `OK`, ganchos e renderização HeyGen continuam idênticos ao estado atual.
