-- 012: Allow anon role full access for admin dashboard (no auth yet)
-- Will be replaced with proper auth policies later.

CREATE POLICY "anon_all" ON vineyards            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON lease_agreements     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON blocks               FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON tasks                FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON crews                FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON workers              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON raw_messages         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON time_entries         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON weekly_summaries     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON approval_log         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON conversation_state   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON notification_schedule FOR ALL TO anon USING (true) WITH CHECK (true);
