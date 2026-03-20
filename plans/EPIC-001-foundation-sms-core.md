# Epic 001: Foundation & SMS Core

**Status**: Complete
**Phase**: 1
**Duration**: Weeks 1–4

## Summary

Stand up the full infrastructure: database schema, SMS ingestion pipeline, AI-powered time entry parsing, and basic admin dashboard. End state: a worker texts their hours, AI parses and creates entries, worker confirms via SMS reply, and an admin can view/manage everything in a web dashboard.

---

## Stories

### STORY-001: Project Scaffolding ✅

**As a** developer
**I want** the project initialized with Next.js, TypeScript, Tailwind, and Supabase
**So that** I have a working foundation to build on

**Acceptance Criteria:**
- [x] Next.js 16 with App Router, TypeScript, Tailwind CSS v4
- [x] `@supabase/supabase-js` and `@supabase/ssr` installed
- [x] Supabase client utilities for browser and server
- [x] shadcn/ui-style component primitives (Button, Input, Label, Select, Badge, Card, Dialog)
- [x] `.env.local` configured with Supabase, Textbelt, and Anthropic keys
- [x] Project builds clean with `next build`

---

### STORY-002: Database Schema ✅

**As a** system
**I want** all tables, enums, indexes, and seed data created in Supabase
**So that** the application has a structured data layer

**Acceptance Criteria:**
- [x] 14 migrations applied in order
- [x] 7 custom ENUM types
- [x] 12 tables: vineyards, blocks, lease_agreements, tasks, crews, workers, raw_messages, time_entries, weekly_summaries, approval_log, conversation_state, notification_schedule
- [x] `start_time` and `end_time` columns on time_entries
- [x] No unique constraint on time_entries (allows multiple entries per worker/day/block/task)
- [x] RLS enabled with permissive policies for anon and authenticated roles
- [x] 84 vineyard tasks seeded across 9 categories with bilingual aliases
- [x] 2 notification schedules seeded (evening reminder, morning follow-up)

---

### STORY-003: SMS Send Pipeline (Textbelt) ✅

**As a** system
**I want** to send SMS messages to workers via Textbelt
**So that** workers receive reminders and confirmations

**Acceptance Criteria:**
- [x] `send-sms` edge function deployed to Supabase
- [x] Sends via Textbelt REST API with `replyWebhookUrl` for receiving replies
- [x] Logs outbound messages in `raw_messages` table
- [x] Next.js API route at `/api/send-sms` for dashboard-triggered sends
- [x] Worker edit page has a "Send Hours Reminder" debug button

---

### STORY-004: SMS Receive Pipeline (Textbelt Webhook) ✅

**As a** worker
**I want** to text my hours and get a response
**So that** my time is logged without opening an app

**Acceptance Criteria:**
- [x] `sms-webhook` edge function deployed (public, no JWT)
- [x] Receives Textbelt reply webhook JSON (`{ textId, fromNumber, text }`)
- [x] Looks up worker by phone number
- [x] Stores inbound message in `raw_messages`
- [x] Unknown numbers get a registration prompt
- [x] Routes to AI parsing for new entries

---

### STORY-005: AI-Powered Time Entry Parsing ✅

**As a** system
**I want** to parse natural language SMS into structured time entries
**So that** workers can report hours informally in English or Spanish

**Acceptance Criteria:**
- [x] Claude API (claude-sonnet-4-20250514) called with dynamic context prompt
- [x] Prompt includes all blocks with aliases/vineyard names, all 84 tasks with aliases, crew defaults
- [x] Extracts: date, start_time, end_time, hours, block_name, task_name, confidence, notes
- [x] **Multi-entry support**: Single message can produce multiple entries (different days, blocks, tasks)
- [x] **Relative date resolution**: "yesterday", "last Monday" resolved to absolute dates
- [x] **Ambiguous date handling**: Asks clarification question when dates are unclear
- [x] **Start/end time extraction**: "8am-4pm" → start_time=08:00, end_time=16:00, hours=8
- [x] **Task normalization**: Free-text matched against canonical task list
- [x] Fallback regex parser when AI is unavailable
- [x] Entries created with status 'draft'

---

### STORY-006: SMS Conversation State Machine ✅

**As a** system
**I want** to track conversation state per worker
**So that** replies are routed correctly (confirmation, clarification, new entry)

**Acceptance Criteria:**
- [x] Conversation state tracked in `conversation_state` table (one row per worker)
- [x] States: idle, awaiting_confirmation, awaiting_correction
- [x] **idle**: New messages go to AI parsing
- [x] **awaiting_confirmation**: YES/SI confirms all draft entries, NO rejects, anything else treated as new entry (old drafts preserved)
- [x] **awaiting_correction**: User is answering a clarification question; original message + response combined and re-parsed
- [x] Confirmation message includes summary of all entries with tip about start/end times

---

### STORY-007: Admin Dashboard — Layout & Navigation ✅

**As an** admin
**I want** a responsive dashboard with sidebar navigation
**So that** I can manage the system from desktop or mobile

**Acceptance Criteria:**
- [x] Dashboard layout with sidebar (desktop) and hamburger menu (mobile)
- [x] Navigation: Dashboard, Workers, Crews, Vineyards, Time Entries, Messages
- [x] Active route highlighting
- [x] Consistent card-based UI with shadcn/ui components

---

### STORY-008: Workers CRUD ✅

**As an** admin
**I want** to manage workers (create, edit, delete)
**So that** the system knows who is reporting time

**Acceptance Criteria:**
- [x] Worker list page with sortable table (name, phone, type, crew, rate, supervisor, language, status)
- [x] Type shown as badge (standard/elevated), status as badge (active/inactive)
- [x] New worker form: name, phone, type, crew, hourly rate, language, supervisor, active
- [x] Edit worker form: same fields, pre-populated
- [x] Supervisor field: dropdown of active elevated workers (self excluded on edit)
- [x] Delete with confirmation dialog
- [x] Debug "Send Hours Reminder" button on edit page

---

### STORY-009: Crews CRUD ✅

**As an** admin
**I want** to manage crews with default vineyard/block assignments
**So that** the AI can use crew context for parsing

**Acceptance Criteria:**
- [x] Crew list page with name, default vineyard, default block, worker count
- [x] New crew form: name, default vineyard (select), default block (cascading select filtered by vineyard)
- [x] Edit crew form: same + read-only crew member list
- [x] Delete with confirmation dialog

---

### STORY-010: Vineyards & Blocks CRUD ✅

**As an** admin
**I want** to manage vineyards and their blocks
**So that** the system knows the physical locations for cost allocation

**Acceptance Criteria:**
- [x] Vineyard list page with name, region, acres, owner, block count
- [x] New vineyard form: name, region, total_acres, owner_name
- [x] Edit vineyard page: edit details + manage blocks
- [x] Block management: add/edit/delete blocks with name, aliases, varietal, acreage, row_range
- [x] Blocks scoped to their vineyard

---

### STORY-011: Time Entries View ✅

**As an** admin
**I want** to view and filter time entries
**So that** I can see what hours have been reported

**Acceptance Criteria:**
- [x] Filterable table: date range, worker, status, vineyard
- [x] Columns: date, worker, vineyard, block, task, start time, end time, hours, status (badge), confidence (%), source (icon)
- [x] Source icon: message icon (blue) for SMS with hover tooltip showing original message, pen icon (gray) for manual
- [x] Status badges: draft=warning, worker_confirmed=success, supervisor_approved=default, rejected=destructive, edited=secondary
- [x] Default: today's entries

---

### STORY-012: Messages Audit Log ✅

**As an** admin
**I want** to see all raw SMS messages
**So that** I have a complete audit trail

**Acceptance Criteria:**
- [x] Read-only table: time, direction (badge), from number, worker name, body (truncated), media count
- [x] Last 100 messages, newest first

---

### STORY-013: Dashboard Home ✅

**As an** admin
**I want** an overview dashboard
**So that** I can quickly see today's status

**Acceptance Criteria:**
- [x] Stats cards: Total Workers (active), Time Entries Today, Pending Confirmations (draft), Messages Today
- [x] Recent Time Entries table (last 10)

---

### STORY-014: Vineyard & Task Seed Data ✅

**As a** system
**I want** realistic vineyard data and comprehensive task list
**So that** the AI can match worker reports accurately

**Acceptance Criteria:**
- [x] 3 vineyards: Tedeschi Estate (1.5ac, Cab Sauv + Cab Franc), Stargazer (Merlot), Calandrelli (Pinot Noir)
- [x] 8 blocks across vineyards with aliases, varietals, row ranges
- [x] 84 canonical vineyard tasks across 9 categories
- [x] All tasks have bilingual aliases (EN + ES) for AI matching

---

## Out of Scope (Deferred to Later Phases)

- Crew intelligence engine (cross-fill, inference)
- Photo OCR pipeline
- Voice transcription pipeline
- Weekly summary generation and approval workflow
- Payroll export
- Cost allocation reports
- PWA / offline support
- Auth / login (currently using anon key)
- Daily reminder cron jobs (templates exist, cron not wired)
