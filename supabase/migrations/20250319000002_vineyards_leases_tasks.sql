-- 002: Vineyards, lease agreements, blocks, and tasks
-- Two-level hierarchy: vineyards → blocks. Blocks carry varietal and row_range for AI matching.

CREATE TABLE vineyards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  region     text,
  total_acres numeric,
  owner_name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE lease_agreements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL REFERENCES vineyards (id),
  lessee_name text NOT NULL,
  start_date  date NOT NULL,
  end_date    date,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vineyard_id uuid NOT NULL REFERENCES vineyards (id) ON DELETE CASCADE,
  name        text NOT NULL,
  aliases     text[] DEFAULT '{}',
  varietal    text,
  acreage     numeric,
  row_range   text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  aliases    text[] DEFAULT '{}',
  category   text,
  created_at timestamptz DEFAULT now()
);
