-- Phase 2 schema changes

-- Add inferred_from to time_entries for crew intelligence audit trail
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS inferred_from uuid REFERENCES time_entries(id) ON DELETE SET NULL;

-- Add source type to time_entries (sms, photo, voice, app, manager, inferred)
-- Using text instead of enum for flexibility
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'sms';

-- Anomalies table for flagging discrepancies
CREATE TABLE IF NOT EXISTS anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id uuid REFERENCES crews(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES workers(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES time_entries(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL, -- 'hours_variance', 'block_mismatch', 'excessive_hours'
  severity text NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
  description text NOT NULL,
  context jsonb DEFAULT '{}',
  resolved boolean DEFAULT false,
  resolved_by uuid REFERENCES workers(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_anomalies_date ON anomalies(date DESC);
CREATE INDEX idx_anomalies_unresolved ON anomalies(resolved) WHERE resolved = false;

-- RLS for anomalies
ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON anomalies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON anomalies FOR ALL TO anon USING (true) WITH CHECK (true);
