-- Supervisor SMS review flow: schema changes
-- After a worker confirms their weekly summary, the system forwards it to
-- their supervisor via SMS. The supervisor can approve or suggest changes.
-- Pay-affecting changes require worker confirmation.

-- New conversation states
ALTER TYPE conversation_state_type ADD VALUE IF NOT EXISTS 'awaiting_supervisor_review';
ALTER TYPE conversation_state_type ADD VALUE IF NOT EXISTS 'awaiting_change_response';

-- New approval actions for SMS-based supervisor review
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'supervisor_sms_approved';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'supervisor_sms_edited';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'worker_change_accepted';
ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'worker_change_rejected';

-- Queue table: accumulates worker confirmations per supervisor per week.
-- When all (or enough) workers in a crew confirm, the system batches them
-- into one SMS to the supervisor.
CREATE TABLE IF NOT EXISTS supervisor_review_queue (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id           uuid NOT NULL REFERENCES workers(id),
  worker_id               uuid NOT NULL REFERENCES workers(id),
  summary_id              uuid NOT NULL REFERENCES weekly_summaries(id),
  week_start              date NOT NULL,
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',              -- worker confirmed, waiting for batch send
                            'sent_to_supervisor',   -- included in SMS to supervisor
                            'approved',             -- supervisor approved (no changes)
                            'changes_pending',      -- supervisor made pay-affecting changes, awaiting worker response
                            'completed',            -- fully resolved
                            'disputed'              -- worker rejected supervisor changes
                          )),
  supervisor_changes      jsonb DEFAULT '[]',
  worker_response         text CHECK (worker_response IN ('accepted', 'rejected')),
  worker_rejection_reason text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),

  CONSTRAINT uq_supervisor_review UNIQUE (supervisor_id, worker_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_review_queue_supervisor
  ON supervisor_review_queue(supervisor_id, week_start);
CREATE INDEX IF NOT EXISTS idx_supervisor_review_queue_status
  ON supervisor_review_queue(status);

-- RLS: allow service role and authenticated access
ALTER TABLE supervisor_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON supervisor_review_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON supervisor_review_queue
  FOR ALL TO anon USING (true) WITH CHECK (true);
