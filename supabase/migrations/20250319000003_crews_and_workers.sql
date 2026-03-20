-- 003: Crews and workers
-- Workers belong to crews. Elevated workers (supervisors) are tracked via the type enum
-- and the self-referential reports_to column.

CREATE TABLE crews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  default_vineyard_id uuid REFERENCES vineyards (id),
  default_block_id   uuid REFERENCES blocks (id),
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE workers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  phone       text UNIQUE,
  type        worker_type DEFAULT 'standard',
  crew_id     uuid REFERENCES crews (id),
  hourly_rate numeric,
  language    language_pref DEFAULT 'es',
  is_active   boolean DEFAULT true,
  reports_to  uuid REFERENCES workers (id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
