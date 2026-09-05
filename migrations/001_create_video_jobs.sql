-- Migration 001: Criar tabela video_jobs
-- Sistema Bali Imóveis - Video Engine V2

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_ref VARCHAR(50) NOT NULL,
  broker_id VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  source VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
  script_version INTEGER NOT NULL DEFAULT 1,
  property_snapshot JSONB DEFAULT '{}'::jsonb,
  scripts_snapshot JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_property_ref ON video_jobs(property_ref);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_broker_id ON video_jobs(broker_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created_at ON video_jobs(created_at DESC);