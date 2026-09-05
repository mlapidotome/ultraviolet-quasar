-- migrations/004_create_video_assets_and_blueprints.sql
-- Fase 3A: Asset Model e Creative Blueprint Foundation

-- 1. Tabela do Catálogo de Assets
CREATE TABLE IF NOT EXISTS video_assets (
    id VARCHAR(64) PRIMARY KEY, -- ex: ast_hk_e3b0c442, ast_bd_8b2cf780
    job_id UUID REFERENCES video_jobs(id) ON DELETE SET NULL,
    property_ref VARCHAR(32),
    asset_type VARCHAR(32) NOT NULL, -- 'hook_clip', 'body_clip', 'property_photo', 'property_video', 'rendered_creative', etc.
    storage_type VARCHAR(32) NOT NULL DEFAULT 'local_file', -- 'local_file', 'external_cdn', 'provider_ref'
    storage_path TEXT, -- NULL até que o arquivo seja baixado e validado localmente
    provider_ref VARCHAR(128), -- ID no provedor externo (ex: HeyGen video_id)
    remote_url TEXT, -- URL temporária ou externa de download
    file_hash VARCHAR(64), -- SHA-256 dos bytes reais no disco (preenchido quando ready)
    generation_key VARCHAR(64) NOT NULL, -- SHA-256 da receita determinística normalizada
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'remote_ready', 'ready', 'failed', 'archived'
    specs JSONB NOT NULL DEFAULT '{}'::jsonb, -- { duration, width, height, fps, codec, audio_channels, file_size }
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- Parâmetros de geração, logs e diagnósticos
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Coluna Explícita de Blueprints Criativos em video_jobs
ALTER TABLE video_jobs 
    ADD COLUMN IF NOT EXISTS creative_blueprints JSONB DEFAULT '[]'::jsonb;

-- 3. Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_video_assets_generation_key ON video_assets (generation_key);
CREATE INDEX IF NOT EXISTS idx_video_assets_file_hash ON video_assets (file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_assets_job_type ON video_assets (job_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_video_assets_property_type ON video_assets (property_ref, asset_type);
CREATE INDEX IF NOT EXISTS idx_video_assets_status ON video_assets (status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_blueprints ON video_jobs USING GIN (creative_blueprints);