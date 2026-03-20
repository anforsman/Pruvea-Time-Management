-- 006: Weekly hour summaries sent to workers for confirmation

CREATE TABLE weekly_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   uuid NOT NULL REFERENCES workers (id),
  week_start  date NOT NULL,
  total_hours numeric NOT NULL,
  status      summary_status DEFAULT 'pending',
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT uq_weekly_summary UNIQUE (worker_id, week_start)
);
