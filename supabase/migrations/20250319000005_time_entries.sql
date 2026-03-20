-- 005: Time entries — the core data model
-- vineyard_id is denormalized here (in addition to block → vineyard) for fast cost-allocation queries.

CREATE TABLE time_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id         uuid NOT NULL REFERENCES workers (id),
  vineyard_id       uuid REFERENCES vineyards (id),
  block_id          uuid REFERENCES blocks (id),
  task_id           uuid REFERENCES tasks (id),
  date              date NOT NULL,
  hours             numeric NOT NULL CHECK (hours > 0 AND hours <= 24),
  status            entry_status DEFAULT 'draft',
  source_message_id uuid REFERENCES raw_messages (id),
  ai_confidence     numeric CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),

  CONSTRAINT uq_time_entry UNIQUE (worker_id, date, block_id, task_id)
);

CREATE INDEX idx_time_entries_date        ON time_entries (date);
CREATE INDEX idx_time_entries_status      ON time_entries (status);
CREATE INDEX idx_time_entries_vineyard_id ON time_entries (vineyard_id);
