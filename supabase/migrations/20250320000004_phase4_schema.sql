-- Phase 4 schema changes: cost allocation, multi-tenant, auth

-- Add cost_share_formula to lease_agreements
ALTER TABLE lease_agreements ADD COLUMN IF NOT EXISTS cost_share_formula jsonb DEFAULT '{"type": "percentage", "lessee_share": 0.5, "owner_share": 0.5}';

-- Link blocks to lease agreements
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS lease_agreement_id uuid REFERENCES lease_agreements(id) ON DELETE SET NULL;

-- Organizations table for multi-tenant support
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text DEFAULT 'America/Los_Angeles',
  pay_period text DEFAULT 'weekly', -- weekly, biweekly
  approval_deadline_hours integer DEFAULT 48,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add org_id to core tables
ALTER TABLE vineyards ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- User accounts linked to workers (for dashboard auth)
CREATE TABLE IF NOT EXISTS user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE, -- Supabase Auth UID
  worker_id uuid REFERENCES workers(id) ON DELETE CASCADE,
  email text UNIQUE,
  role text NOT NULL DEFAULT 'worker', -- worker, field_boss, owner, admin
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- RLS for new tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON organizations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON organizations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON user_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON user_accounts FOR ALL TO anon USING (true) WITH CHECK (true);

-- Seed a default organization
INSERT INTO organizations (name, slug) VALUES ('Tedeschi Family Vineyards', 'tedeschi')
ON CONFLICT (slug) DO NOTHING;
