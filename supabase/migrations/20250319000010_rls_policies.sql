-- 010: Row Level Security — enable on all tables
-- Starting with permissive policies for authenticated users.
-- service_role bypasses RLS automatically. Will tighten policies later.

ALTER TABLE vineyards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_agreements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE crews                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_summaries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_schedule ENABLE ROW LEVEL SECURITY;

-- Permissive policies: allow all operations for authenticated users
CREATE POLICY "authenticated_all" ON vineyards            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON lease_agreements     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON blocks               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON tasks                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON crews                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON workers              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON raw_messages         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON time_entries         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON weekly_summaries     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON approval_log         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON conversation_state   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON notification_schedule FOR ALL TO authenticated USING (true) WITH CHECK (true);
