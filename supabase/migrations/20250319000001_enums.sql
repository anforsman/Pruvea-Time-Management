-- 001: Custom ENUM types for Pruvea Time Management
-- These enums define the domain-specific value constraints used across all tables.

CREATE TYPE worker_type AS ENUM ('standard', 'elevated');

CREATE TYPE language_pref AS ENUM ('en', 'es');

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE entry_status AS ENUM (
  'draft',
  'worker_confirmed',
  'supervisor_approved',
  'rejected',
  'edited'
);

CREATE TYPE summary_status AS ENUM ('pending', 'approved', 'disputed');

CREATE TYPE conversation_state_type AS ENUM (
  'idle',
  'awaiting_confirmation',
  'awaiting_correction',
  'awaiting_identification'
);

CREATE TYPE approval_action AS ENUM ('approved', 'rejected', 'edited', 'disputed');
