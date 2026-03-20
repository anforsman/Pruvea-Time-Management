-- 009: Configurable notification schedules for automated SMS reminders

CREATE TABLE notification_schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  cron_expression     text NOT NULL,
  message_template_en text NOT NULL,
  message_template_es text NOT NULL,
  is_active           boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);
