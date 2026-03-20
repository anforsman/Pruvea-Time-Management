-- 008: Per-worker conversation state for the SMS AI agent
-- One row per worker (UNIQUE on worker_id). Tracks where the worker is in the
-- conversational flow and any pending time entry being built.

CREATE TABLE conversation_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id        uuid NOT NULL UNIQUE REFERENCES workers (id) ON DELETE CASCADE,
  state            conversation_state_type DEFAULT 'idle',
  pending_entry_id uuid REFERENCES time_entries (id) ON DELETE SET NULL,
  context          jsonb DEFAULT '{}',
  updated_at       timestamptz DEFAULT now()
);
