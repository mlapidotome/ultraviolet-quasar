ALTER TABLE video_jobs 
      ADD COLUMN IF NOT EXISTS pilot_video_url TEXT,
      ADD COLUMN IF NOT EXISTS error_message TEXT;

    CREATE INDEX IF NOT EXISTS idx_video_jobs_pilot_status ON video_jobs (status, created_at DESC);