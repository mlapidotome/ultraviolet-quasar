-- migrations/003_add_creative_set_fields.sql
-- Fase 2C: Colunas para acesso direto aos vídeos da coleção criativa

ALTER TABLE video_jobs 
  ADD COLUMN IF NOT EXISTS video2_url TEXT,
  ADD COLUMN IF NOT EXISTS video3_url TEXT;

CREATE INDEX IF NOT EXISTS idx_video_jobs_creative_status ON video_jobs (status, updated_at DESC);