# Vineyard Workforce Time & Labor Management

## Project Description

### Problem

Vineyard field workers move between multiple plots and locations throughout the day. Time worked must be allocated to each plot/location for unit economics, COGS reporting, and cost-sharing via land lease agreements. The current process relies on workers reporting time via scattered calls, texts, and emails, which a vineyard owner (Emilio) manually enters into a spreadsheet before sending to payroll.

This process fails in several predictable ways:

- Workers forget to log entire days of work and don't discover the shortage until payday
- There is no structured way to capture which vineyard, block, or task the hours apply to
- Crew members may duplicate or contradict each other's reports
- Some workers have no smartphone and may not have a stable phone number
- The owner becomes a single bottleneck — all data flows through one person

Pay is never over-reported. The problem is under-reporting due to forgotten entries.

### Worker Personas

**Standard workers** report to a dedicated field boss, are often transient (sometimes only 2 weeks), may lack a smartphone or stable phone number, and perform general field labor (pruning, harvesting, etc.) in crews.

**Elevated workers** report to a de facto lead (senior crew member), have long-term relationships with the vineyard (years), are more likely to have a smartphone, and perform specialized tasks (spraying, tractor work, irrigation) in smaller self-directed crews.

Both classes may be difficult to get to report time consistently.

### Solution

An SMS-first intelligent time tracking system where workers report time via the method of their choosing — SMS, photo of a handwritten timesheet, voice message, or mobile web app. An AI processing layer normalizes all input into structured time entries stored in Supabase. The system understands crew composition and uses partial data from any crew member to fill gaps for the rest. Workers receive daily reminders, weekly pay summaries, and a multi-stage approval workflow routes confirmed time through field boss → owner → accounting.

### Core Capabilities

- **Multi-channel ingestion**: SMS (via Textbelt), photo OCR, voice transcription, mobile web app, manager proxy entry
- **AI-powered parsing**: Natural language time entry extraction in English and Spanish via Claude API, with support for multiple entries per message, relative date resolution, and start/end time extraction
- **Crew intelligence**: Cross-fill missing data (hours, vineyard, block, task) from crew member reports; auto-populate entries for unreported crew members; flag anomalies
- **Proactive reminders**: 5 PM daily reminder, 7 AM follow-up for missing entries, Friday weekly pay summary
- **Approval workflow**: Worker confirmation → Field boss/lead review → Owner approval → Payroll export
- **Cost allocation**: Labor hours tracked by vineyard + block + task for unit economics, COGS, and lease cost-sharing
- **Audit trail**: Every raw message, AI parse, inference, edit, and approval is logged immutably

---

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Database | Supabase (Postgres) | Real-time subscriptions, row-level security, auth, pg_cron |
| SMS Gateway | Textbelt | Simple REST API for sending SMS with reply webhook support; no number verification required |
| AI Processing | Claude API (Anthropic) | NLP extraction, OCR interpretation, bilingual support |
| Speech-to-Text | Whisper (OpenAI) or Deepgram | Multilingual transcription for voice MMS |
| Backend / API | Supabase Edge Functions (Deno) | Serverless, low-ops, native Supabase integration |
| Web Dashboard | Next.js 16 + React 19 (PWA) | Mobile-first responsive design; progressive web app, installable, offline-capable |
| UI Framework | Tailwind CSS v4 + shadcn/ui primitives | Utility-first, accessible components |
| Payroll Export | CSV / API integration | Flexible output for any payroll provider |

### SMS Architecture

Textbelt is used for both sending and receiving SMS:

- **Outbound**: `send-sms` edge function sends via Textbelt REST API with `replyWebhookUrl` parameter
- **Inbound**: When a worker replies, Textbelt POSTs to the `sms-webhook` edge function with JSON payload containing `{ textId, fromNumber, text }`
- **No Twilio dependency**: The system is fully operational with Textbelt alone. Twilio webhook endpoint exists but is not the primary path.

---

## Database Schema

### Supabase Project

- **Project ref**: `zwkmjaiiasdggvbxclhb`
- **Region**: East US (Ohio)
- **URL**: `https://zwkmjaiiasdggvbxclhb.supabase.co`

### Custom Types

```sql
CREATE TYPE worker_type AS ENUM ('standard', 'elevated');
CREATE TYPE language_pref AS ENUM ('en', 'es');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE entry_status AS ENUM ('draft', 'worker_confirmed', 'supervisor_approved', 'rejected', 'edited');
CREATE TYPE summary_status AS ENUM ('pending', 'approved', 'disputed');
CREATE TYPE conversation_state_type AS ENUM ('idle', 'awaiting_confirmation', 'awaiting_correction', 'awaiting_identification');
CREATE TYPE approval_action AS ENUM ('approved', 'rejected', 'edited', 'disputed');
```

### Tables

#### `vineyards`
Top-level location entity. A winery may operate multiple vineyards.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| region | text | e.g., "Calistoga, Napa Valley" |
| total_acres | numeric | |
| owner_name | text | |
| created_at | timestamptz | |

#### `blocks`
Subdivisions within a vineyard. Primary "where" dimension for cost allocation.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vineyard_id | uuid FK → vineyards | ON DELETE CASCADE |
| name | text NOT NULL | |
| aliases | text[] | For AI fuzzy matching |
| varietal | text | e.g., "Cabernet Sauvignon" |
| acreage | numeric | |
| row_range | text | e.g., "Rows 1-12" |
| created_at | timestamptz | |

#### `lease_agreements`
Cost-sharing arrangements between vineyard owner and lessees.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vineyard_id | uuid FK → vineyards | |
| lessee_name | text NOT NULL | |
| start_date | date NOT NULL | |
| end_date | date | |
| created_at | timestamptz | |

#### `tasks`
Normalized task reference table. 84 canonical tasks across 9 categories with bilingual aliases.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL UNIQUE | Canonical English name |
| aliases | text[] | EN + ES variations for AI matching |
| category | text | canopy, pruning, trellising, harvest, pest_management, irrigation, soil, planting, maintenance |
| created_at | timestamptz | |

Categories and counts: canopy (17), pruning (5), trellising (10), harvest (6), pest_management (12), irrigation (7), soil (13), planting (7), maintenance (7).

#### `crews`
Working groups. Crews are the unit for the intelligence engine.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| default_vineyard_id | uuid FK → vineyards | Updated as crew moves |
| default_block_id | uuid FK → blocks | Updated as crew moves |
| created_at | timestamptz | |

#### `workers`
Central identity table. Workers identified by phone number.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text NOT NULL | |
| phone | text UNIQUE | Primary lookup key for SMS |
| type | worker_type | standard or elevated |
| crew_id | uuid FK → crews | |
| hourly_rate | numeric | |
| language | language_pref | en or es (default es) |
| is_active | boolean | Soft delete |
| reports_to | uuid FK → workers | Self-referential, supervisor lookup |
| created_at | timestamptz | |

#### `raw_messages`
Immutable audit log of every SMS communication.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| twilio_sid | text UNIQUE | Textbelt text ID or Twilio SID |
| from_number | text NOT NULL | |
| body | text | |
| media_urls | text[] | |
| worker_id | uuid FK → workers | Set after phone lookup |
| direction | message_direction | inbound or outbound |
| created_at | timestamptz | |

#### `time_entries`
Core transactional table. Each row is one worker's time for one block/task on one day.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| worker_id | uuid FK → workers NOT NULL | |
| vineyard_id | uuid FK → vineyards | Denormalized for cost queries |
| block_id | uuid FK → blocks | |
| task_id | uuid FK → tasks | |
| date | date NOT NULL | |
| start_time | time | e.g., 08:00 |
| end_time | time | e.g., 16:00 |
| hours | numeric NOT NULL | CHECK > 0 AND <= 24 |
| status | entry_status | Default 'draft' |
| source_message_id | uuid FK → raw_messages | |
| ai_confidence | numeric | 0.0 to 1.0 |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Note**: No unique constraint — workers can have multiple entries per day for different blocks/tasks/shifts.

#### `weekly_summaries`
Aggregated view for approval workflow.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| worker_id | uuid FK → workers NOT NULL | |
| week_start | date NOT NULL | |
| total_hours | numeric NOT NULL | |
| status | summary_status | |
| created_at | timestamptz | |
| UNIQUE | (worker_id, week_start) | |

#### `approval_log`
Immutable audit trail for all actions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entry_id | uuid FK → time_entries | ON DELETE CASCADE |
| summary_id | uuid FK → weekly_summaries | ON DELETE CASCADE |
| action | approval_action NOT NULL | |
| performed_by | uuid FK → workers | |
| notes | text | |
| created_at | timestamptz | |
| CHECK | | At least one of entry_id or summary_id NOT NULL |

#### `conversation_state`
Tracks in-flight SMS conversations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| worker_id | uuid FK → workers UNIQUE | ON DELETE CASCADE |
| state | conversation_state_type | Default 'idle' |
| pending_entry_id | uuid FK → time_entries | |
| context | jsonb | Stores original_message for clarification flow |
| updated_at | timestamptz | |

#### `notification_schedule`
Configurable reminder schedule.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| cron_expression | text NOT NULL | |
| message_template_en | text NOT NULL | |
| message_template_es | text NOT NULL | |
| is_active | boolean | |
| created_at | timestamptz | |

### Row-Level Security

RLS is enabled on all tables. Current policies allow full access for both `authenticated` and `anon` roles (permissive, to be tightened when auth is implemented).

---

## Supabase Edge Functions

### `send-sms`
Sends outbound SMS via Textbelt with reply webhook.

- **Endpoint**: `POST /functions/v1/send-sms`
- **Auth**: Requires service role JWT
- **Input**: `{ to, body, worker_id? }`
- **Behavior**: Sends via Textbelt with `replyWebhookUrl` pointing to `sms-webhook`. Logs outbound message in `raw_messages`.
- **Returns**: `{ success, text_id }`

### `sms-webhook`
Receives inbound SMS replies via Textbelt webhook.

- **Endpoint**: `POST /functions/v1/sms-webhook`
- **Auth**: Public (no JWT verification)
- **Input**: Textbelt JSON `{ textId, fromNumber, text, data? }`
- **Behavior**:
  1. Looks up worker by phone number
  2. Stores raw message
  3. Checks conversation state and routes:
     - **idle**: Parses with Claude AI, creates draft entries, sends confirmation
     - **awaiting_confirmation**: YES/SI confirms all drafts, NO rejects, anything else treated as new entry
     - **awaiting_correction**: Combines with original message context and re-parses
  4. Sends reply via `send-sms` function

### `twilio-webhook`
Legacy Twilio webhook (kept for backward compatibility).

- **Endpoint**: `POST /functions/v1/twilio-webhook`
- **Auth**: Public (no JWT verification)
- **Input**: Twilio form-encoded POST
- **Behavior**: Same pipeline as `sms-webhook` but parses Twilio form data. Returns empty TwiML, sends replies via Textbelt.

### AI Parsing Behavior

The Claude API prompt is constructed dynamically with:
- Today's date and day of week
- All blocks with aliases and vineyard names
- All 84 tasks with aliases
- Worker's crew defaults

**Multi-entry support**: A single message can contain multiple entries (different days, blocks, tasks). "Mon 8h pruning block A, Tue 6h spraying merlot east" produces 2 entries.

**Date resolution**: Relative dates ("yesterday", "last Monday") are resolved to absolute dates. Ambiguous dates trigger a clarification question.

**Start/end times**: Extracted when provided ("8am-4pm"). When only hours are given, a tip suggests including times in future messages.

**Task normalization**: Free-text task descriptions are matched against the 84 canonical tasks using exact name match, then alias match. Unrecognized tasks are accepted with a note.

**Output format**:
```json
{
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM" | null,
      "end_time": "HH:MM" | null,
      "hours": number,
      "block_name": string | null,
      "task_name": string | null,
      "confidence": 0.0-1.0,
      "notes": string | null
    }
  ],
  "needs_clarification": boolean,
  "clarification_question_en": string | null,
  "clarification_question_es": string | null
}
```

---

## Web Dashboard

### Tech Stack
- Next.js 16 (App Router, `src/` directory)
- React 19
- Tailwind CSS v4
- shadcn/ui-style components (Button, Input, Label, Select, Badge, Card, Dialog)
- Supabase client via `@supabase/ssr`

### Routes

| Route | Type | Description |
|---|---|---|
| `/` | Server | Dashboard with stats cards (workers, entries today, pending, messages) + recent entries table |
| `/workers` | Server | Worker list with name, phone, type, crew, rate, supervisor, language, status |
| `/workers/new` | Client | New worker form with supervisor lookup (elevated workers) |
| `/workers/[id]` | Client | Edit worker + debug SMS send button |
| `/crews` | Server | Crew list with default vineyard/block and worker count |
| `/crews/new` | Client | New crew form with vineyard/block cascading selects |
| `/crews/[id]` | Client | Edit crew + crew member list |
| `/vineyards` | Server | Vineyard list with block count |
| `/vineyards/new` | Client | New vineyard form |
| `/vineyards/[id]` | Client | Edit vineyard + block management (add/edit/delete blocks) |
| `/time-entries` | Client | Filterable time entries with date range, worker, status, vineyard filters. Shows start/end times, source icon with message tooltip |
| `/messages` | Server | Raw message audit log (read-only, last 100) |

### Layout
- Desktop: Sidebar navigation (Dashboard, Workers, Crews, Vineyards, Time Entries, Messages)
- Mobile: Hamburger menu with slide-down navigation

### API Routes

| Route | Method | Description |
|---|---|---|
| `/api/send-sms` | POST | Send SMS via Textbelt with reply webhook |

---

## Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://zwkmjaiiasdggvbxclhb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Textbelt
TEXTBELT_API_KEY=...

# Anthropic
ANTHROPIC_API_KEY=...
```

Edge function secrets (set via `supabase secrets set`):
- `ANTHROPIC_API_KEY`
- `TEXTBELT_API_KEY`

---

## Development Phases

### Phase 1: Foundation & SMS Core (Weeks 1–4) ✅ COMPLETE
Supabase schema (14 migrations), Textbelt SMS pipeline, Claude API parsing (EN + ES, multi-entry, relative dates, start/end times), worker/crew/vineyard CRUD, admin dashboard, 84 normalized vineyard tasks.

### Phase 2: Crew Intelligence & Multi-Channel (Weeks 5–8)
Crew cross-fill engine, photo OCR pipeline, voice transcription pipeline, crew lead batch entry, historical pattern suggestions, anomaly detection.

### Phase 3: Approval Workflow & Pay Summaries (Weeks 9–12)
Weekly summary generation, worker pay confirmation SMS, field boss review dashboard, owner approval dashboard, escalation system, payroll export (CSV/API), approval audit log.

### Phase 4: Cost Allocation & Scale (Weeks 13–16)
Cost allocation engine (labor per vineyard/block/task/acre), COGS reporting, lease cost-sharing reports, analytics dashboard, mobile PWA, multi-vineyard support, third-party API integrations.
