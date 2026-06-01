-- Colonnes nécessaires pour le Sales Agent
-- À coller dans Supabase → SQL Editor → Run

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS followup_sms_sent_at timestamptz;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS final_sms_sent_at    timestamptz;

-- Index pour accélérer les requêtes du Sales Agent
CREATE INDEX IF NOT EXISTS idx_prospects_opened_at     ON prospects(opened_at)     WHERE opened_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_sms_sent      ON prospects(hot_sms_sent_at);
CREATE INDEX IF NOT EXISTS idx_prospects_status        ON prospects(status);
