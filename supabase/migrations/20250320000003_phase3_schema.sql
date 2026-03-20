-- Phase 3 schema changes: approval workflow & pay summaries

-- Expand weekly_summaries with pay and audit fields
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS week_end date;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS total_pay numeric;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS hourly_rate_used numeric;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS entry_count integer DEFAULT 0;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS unconfirmed_count integer DEFAULT 0;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS inferred_count integer DEFAULT 0;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS worker_confirmed_at timestamptz;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS boss_approved_at timestamptz;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS owner_approved_at timestamptz;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS payroll_sent_at timestamptz;
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Expand approval_log with before/after values and actor role
ALTER TABLE approval_log ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE approval_log ADD COLUMN IF NOT EXISTS previous_value jsonb;
ALTER TABLE approval_log ADD COLUMN IF NOT EXISTS new_value jsonb;

-- Relax the check constraint so approval_log can also log standalone actions
ALTER TABLE approval_log DROP CONSTRAINT IF EXISTS chk_approval_target;

-- Expand summary_status enum for the full approval flow
ALTER TYPE summary_status ADD VALUE IF NOT EXISTS 'worker_confirmed';
ALTER TYPE summary_status ADD VALUE IF NOT EXISTS 'boss_approved';
ALTER TYPE summary_status ADD VALUE IF NOT EXISTS 'owner_approved';
ALTER TYPE summary_status ADD VALUE IF NOT EXISTS 'payroll_sent';

-- Expand approval_action enum for more action types
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'created';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'auto_approved';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'payroll_sent';

-- Add supervisor_approved status to entry_status enum
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'boss_approved';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'owner_approved';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'payroll_sent';

-- Index for approval dashboard queries
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_status ON weekly_summaries(status, week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_worker ON weekly_summaries(worker_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_approval_log_entry ON approval_log(entry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_approval_log_summary ON approval_log(summary_id, created_at);
