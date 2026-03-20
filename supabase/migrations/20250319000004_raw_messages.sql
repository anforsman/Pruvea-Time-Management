-- 004: Raw inbound/outbound SMS messages from Twilio

CREATE TABLE raw_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_sid  text NOT NULL UNIQUE,
  from_number text NOT NULL,
  body        text,
  media_urls  text[] DEFAULT '{}',
  worker_id   uuid REFERENCES workers (id) ON DELETE SET NULL,
  direction   message_direction DEFAULT 'inbound',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_raw_messages_from_number ON raw_messages (from_number);
CREATE INDEX idx_raw_messages_worker_id   ON raw_messages (worker_id);
