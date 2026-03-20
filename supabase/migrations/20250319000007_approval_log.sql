-- 007: Immutable approval / rejection / edit audit trail

CREATE TABLE approval_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid REFERENCES time_entries (id) ON DELETE CASCADE,
  summary_id   uuid REFERENCES weekly_summaries (id) ON DELETE CASCADE,
  action       approval_action NOT NULL,
  performed_by uuid REFERENCES workers (id) ON DELETE SET NULL,
  notes        text,
  created_at   timestamptz DEFAULT now(),

  CONSTRAINT chk_approval_target CHECK (entry_id IS NOT NULL OR summary_id IS NOT NULL)
);
