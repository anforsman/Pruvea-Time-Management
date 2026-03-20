-- 20250320000005: Seed realistic test data — crews, workers, time entries, weekly summaries
-- NOTE: Does NOT modify existing worker Andrew Forsman (86b1f676-8b94-47f8-834d-b8ea682cf3d6)

-- ============================================================================
-- 1. CREWS
-- ============================================================================
INSERT INTO crews (id, name, default_vineyard_id, default_block_id) VALUES
  ('aaaaaaaa-0001-0000-0000-000000000001', 'Alpha Crew', 'ca866966-1528-4473-8568-1497627bfe1d', 'ef83b951-5c7a-4ee7-9938-6dc95f8a1202'),
  ('aaaaaaaa-0002-0000-0000-000000000001', 'Bravo Crew', 'f7c03c60-6457-4e19-ae2f-45e4e78d0fa5', '0b20e95e-b445-4d9b-9b32-3a1bbc0a7d22')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. FIELD BOSS (elevated worker, no reports_to)
-- ============================================================================
INSERT INTO workers (id, full_name, phone, type, crew_id, hourly_rate, language, is_active, reports_to) VALUES
  ('bbbbbbbb-0001-0000-0000-000000000001', 'Carlos Mendoza', '+15551000001', 'elevated', 'aaaaaaaa-0001-0000-0000-000000000001', 35.00, 'es', true, NULL)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. ACTIVE WORKERS (8 total: 5 Spanish, 3 English)
-- ============================================================================
INSERT INTO workers (id, full_name, phone, type, crew_id, hourly_rate, language, is_active, reports_to) VALUES
  ('bbbbbbbb-0002-0000-0000-000000000001', 'Maria Garcia',     '+15551000002', 'standard', 'aaaaaaaa-0001-0000-0000-000000000001', 22.00, 'es', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0003-0000-0000-000000000001', 'Juan Rodriguez',   '+15551000003', 'standard', 'aaaaaaaa-0001-0000-0000-000000000001', 22.00, 'es', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0004-0000-0000-000000000001', 'Rosa Martinez',    '+15551000004', 'standard', 'aaaaaaaa-0001-0000-0000-000000000001', 22.00, 'es', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0005-0000-0000-000000000001', 'Pedro Hernandez',  '+15551000005', 'standard', 'aaaaaaaa-0002-0000-0000-000000000001', 22.00, 'es', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0006-0000-0000-000000000001', 'Ana Lopez',        '+15551000006', 'standard', 'aaaaaaaa-0002-0000-0000-000000000001', 22.00, 'es', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0007-0000-0000-000000000001', 'Mike Thompson',    '+15551000007', 'standard', 'aaaaaaaa-0002-0000-0000-000000000001', 24.00, 'en', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0008-0000-0000-000000000001', 'Sarah Chen',       '+15551000008', 'standard', 'aaaaaaaa-0002-0000-0000-000000000001', 24.00, 'en', true, 'bbbbbbbb-0001-0000-0000-000000000001'),
  ('bbbbbbbb-0009-0000-0000-000000000001', 'James Wilson',     '+15551000009', 'standard', 'aaaaaaaa-0001-0000-0000-000000000001', 24.00, 'en', true, 'bbbbbbbb-0001-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. INACTIVE WORKERS
-- ============================================================================
INSERT INTO workers (id, full_name, phone, type, crew_id, hourly_rate, language, is_active, reports_to) VALUES
  ('bbbbbbbb-0010-0000-0000-000000000001', 'Luis Ramirez', '+15551000010', 'standard', NULL, 20.00, 'es', false, NULL),
  ('bbbbbbbb-0011-0000-0000-000000000001', 'David Brown',  '+15551000011', 'standard', NULL, 20.00, 'en', false, NULL)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. TIME ENTRIES (past 8 weeks + current week) and
-- 6. WEEKLY SUMMARIES
-- ============================================================================
DO $$
DECLARE
  -- Worker info arrays (9 active workers: field boss + 8 standard)
  v_worker_ids uuid[] := ARRAY[
    'bbbbbbbb-0001-0000-0000-000000000001',  -- 1: Carlos Mendoza (Alpha, elevated)
    'bbbbbbbb-0002-0000-0000-000000000001',  -- 2: Maria Garcia (Alpha)
    'bbbbbbbb-0003-0000-0000-000000000001',  -- 3: Juan Rodriguez (Alpha)
    'bbbbbbbb-0004-0000-0000-000000000001',  -- 4: Rosa Martinez (Alpha)
    'bbbbbbbb-0009-0000-0000-000000000001',  -- 5: James Wilson (Alpha)
    'bbbbbbbb-0005-0000-0000-000000000001',  -- 6: Pedro Hernandez (Bravo)
    'bbbbbbbb-0006-0000-0000-000000000001',  -- 7: Ana Lopez (Bravo)
    'bbbbbbbb-0007-0000-0000-000000000001',  -- 8: Mike Thompson (Bravo)
    'bbbbbbbb-0008-0000-0000-000000000001'   -- 9: Sarah Chen (Bravo)
  ];

  v_hourly_rates numeric[] := ARRAY[35.00, 22.00, 22.00, 22.00, 24.00, 22.00, 22.00, 24.00, 24.00];

  -- Alpha crew = workers 1-5 (indices 1..5), Bravo = workers 6-9 (indices 6..9)
  -- Alpha blocks: Tedeschi Estate
  v_alpha_vineyard uuid := 'ca866966-1528-4473-8568-1497627bfe1d';
  v_alpha_blocks uuid[] := ARRAY[
    'ef83b951-5c7a-4ee7-9938-6dc95f8a1202',  -- Block A - Cab Sauv
    'b6fb6075-3447-4d11-bfbc-8bdf94bd8c15'   -- Block B - Cab Franc
  ];

  -- Bravo blocks: Stargazer Vineyard
  v_bravo_vineyard uuid := 'f7c03c60-6457-4e19-ae2f-45e4e78d0fa5';
  v_bravo_blocks uuid[] := ARRAY[
    '0b20e95e-b445-4d9b-9b32-3a1bbc0a7d22',  -- Block 1 - Merlot East
    '2e811ce3-24ad-4db3-b8d6-5725d9da1690',  -- Block 2 - Merlot West
    'c9c01f23-8624-44cb-a263-1f1f8e69c451'   -- Block 3 - Headlands
  ];

  -- Task IDs (fetched dynamically)
  v_task_ids uuid[];
  v_task_names text[] := ARRAY[
    'Dormant Pruning', 'Shoot Thinning', 'Suckering', 'Tucking',
    'Deleafing (Hand)', 'Spraying', 'Mowing', 'Hand Weeding',
    'Trellis Repair', 'Harvest (Hand)'
  ];

  -- Loop variables
  v_week_num integer;
  v_worker_idx integer;
  v_day_num integer;
  v_day_date date;
  v_week_start date;
  v_week_end date;
  v_current_week_start date := '2026-03-16'::date;
  v_hours numeric;
  v_start_hour integer;
  v_start_time time;
  v_end_time time;
  v_vineyard_id uuid;
  v_block_id uuid;
  v_task_id uuid;
  v_status entry_status;
  v_ai_confidence numeric;
  v_day_counter integer;  -- running counter for modulo rotation
  v_is_current_week boolean;
  v_worker_confirmed boolean;

  -- Weekly summary accumulators
  v_week_total_hours numeric;
  v_week_entry_count integer;

BEGIN
  -- Fetch task IDs by name
  SELECT array_agg(t.id ORDER BY array_position(v_task_names, t.name))
  INTO v_task_ids
  FROM tasks t
  WHERE t.name = ANY(v_task_names);

  -- Verify we got all 10 tasks
  IF array_length(v_task_ids, 1) != 10 THEN
    RAISE EXCEPTION 'Expected 10 tasks, got %', array_length(v_task_ids, 1);
  END IF;

  -- Loop: 9 weeks (week 0 = 8 weeks ago .. week 8 = current week)
  -- Week 0 starts on 2026-01-19 (Monday), current week starts 2026-03-16
  FOR v_week_num IN 0..8 LOOP
    v_week_start := '2026-01-19'::date + (v_week_num * 7);
    v_week_end := v_week_start + 6;  -- Sunday
    v_is_current_week := (v_week_start = v_current_week_start);

    FOR v_worker_idx IN 1..9 LOOP
      -- Determine if this worker is "confirmed" for current week
      -- Even-indexed workers confirmed, odd-indexed draft (0-based: workers 1,3,5,7,9 are idx 0,2,4,6,8)
      v_worker_confirmed := (v_worker_idx % 2 = 0);

      v_week_total_hours := 0;
      v_week_entry_count := 0;

      -- For current week, only generate entries Mon-Thu (today is Thursday 2026-03-20)
      -- For past weeks, generate Mon-Fri
      FOR v_day_num IN 0..4 LOOP
        v_day_date := v_week_start + v_day_num;

        -- Skip future dates: today is 2026-03-20 (Thursday = day_num 3 of current week)
        -- For current week, allow Mon(0), Tue(1), Wed(2), Thu(3)
        IF v_is_current_week AND v_day_num > 3 THEN
          EXIT;
        END IF;

        -- Running counter for deterministic variation
        v_day_counter := v_week_num * 45 + (v_worker_idx - 1) * 5 + v_day_num;

        -- Hours: cycle through 7.0, 7.5, 8.0, 8.5, 9.0 based on counter
        v_hours := 7.0 + (v_day_counter % 5) * 0.5;

        -- Start hour: cycle through 6, 7, 8 (6:00, 7:00, 8:00)
        v_start_hour := 6 + (v_day_counter % 3);
        v_start_time := make_time(v_start_hour, 0, 0);
        -- End time: start + hours (convert hours to interval)
        v_end_time := v_start_time + make_interval(secs => v_hours * 3600);

        -- Block selection based on crew
        IF v_worker_idx <= 5 THEN
          -- Alpha crew: rotate through 2 Tedeschi blocks
          v_vineyard_id := v_alpha_vineyard;
          v_block_id := v_alpha_blocks[1 + (v_day_counter % 2)];
        ELSE
          -- Bravo crew: rotate through 3 Stargazer blocks
          v_vineyard_id := v_bravo_vineyard;
          v_block_id := v_bravo_blocks[1 + (v_day_counter % 3)];
        END IF;

        -- Task: rotate through 10 tasks
        v_task_id := v_task_ids[1 + (v_day_counter % 10)];

        -- Status
        IF v_is_current_week THEN
          IF v_worker_confirmed THEN
            v_status := 'worker_confirmed';
          ELSE
            v_status := 'draft';
          END IF;
        ELSE
          v_status := 'worker_confirmed';
        END IF;

        -- AI confidence: cycle through 0.80, 0.85, 0.90, 0.95, 1.00
        v_ai_confidence := 0.80 + (v_day_counter % 5) * 0.05;

        -- Insert time entry
        INSERT INTO time_entries (
          id, worker_id, vineyard_id, block_id, task_id,
          date, hours, start_time, end_time,
          status, ai_confidence, source_type, notes
        ) VALUES (
          gen_random_uuid(),
          v_worker_ids[v_worker_idx],
          v_vineyard_id,
          v_block_id,
          v_task_id,
          v_day_date,
          v_hours,
          v_start_time,
          v_end_time,
          v_status,
          v_ai_confidence,
          'sms',
          NULL
        );

        v_week_total_hours := v_week_total_hours + v_hours;
        v_week_entry_count := v_week_entry_count + 1;
      END LOOP; -- days

      -- Create weekly summary
      -- Past weeks: all workers get summaries with status 'worker_confirmed'
      -- Current week: only confirmed workers (~50%) get summaries with status 'pending'
      IF NOT v_is_current_week THEN
        INSERT INTO weekly_summaries (
          id, worker_id, week_start, week_end,
          total_hours, total_pay, hourly_rate_used,
          entry_count, status, worker_confirmed_at
        ) VALUES (
          gen_random_uuid(),
          v_worker_ids[v_worker_idx],
          v_week_start,
          v_week_end,
          v_week_total_hours,
          v_week_total_hours * v_hourly_rates[v_worker_idx],
          v_hourly_rates[v_worker_idx],
          v_week_entry_count,
          'worker_confirmed',
          (v_week_start + 4)::date + '18:00:00'::time  -- Friday at 6pm UTC
        );
      ELSIF v_worker_confirmed THEN
        -- Current week, confirmed workers only
        INSERT INTO weekly_summaries (
          id, worker_id, week_start, week_end,
          total_hours, total_pay, hourly_rate_used,
          entry_count, status, worker_confirmed_at
        ) VALUES (
          gen_random_uuid(),
          v_worker_ids[v_worker_idx],
          v_week_start,
          v_week_end,
          v_week_total_hours,
          v_week_total_hours * v_hourly_rates[v_worker_idx],
          v_hourly_rates[v_worker_idx],
          v_week_entry_count,
          'pending',
          NULL
        );
      END IF;

    END LOOP; -- workers
  END LOOP; -- weeks

  RAISE NOTICE 'Seed data inserted successfully';
END $$;
