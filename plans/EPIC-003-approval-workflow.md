# Epic 003: Approval Workflow & Pay Summaries

**Status**: Complete
**Phase**: 3
**Duration**: Weeks 9–12

## Summary

Implement the multi-stage approval pipeline: weekly summary generation, worker pay confirmation, field boss review, owner approval, and payroll export.

---

## Stories

### STORY-022: Weekly Summary Generation ✅

**As a** system
**I want** to generate weekly summaries every Friday
**So that** workers and supervisors can review the week's hours

**Acceptance Criteria:**
- [x] Edge function `generate-weekly-summary` generates summaries on demand (triggerable via API or cron)
- [x] For each active worker: sum hours, compute pay (hours × hourly_rate), count entries, unconfirmed, inferred
- [x] Upsert into `weekly_summaries` with status 'pending', snapshot hourly_rate
- [x] Daily breakdown computed (Mon 8h, Tue 6h...) and included in SMS
- [x] Log 'created' action in approval_log

**Implementation:** `generate-weekly-summary` edge function + `/api/generate-summary` Next.js route.

---

### STORY-023: Worker Weekly Pay Confirmation SMS ✅

**As a** worker
**I want** to receive my weekly pay summary via SMS
**So that** I can verify my hours before payroll

**Acceptance Criteria:**
- [x] Bilingual SMS sent (EN/ES) with total hours, total pay, and daily breakdown
- [x] Format includes "Reply CHANGE by Saturday noon if anything is wrong"
- [x] Conversation state set to awaiting_confirmation with summary context
- [x] CHANGE reply triggers correction flow

**Implementation:** Integrated into `generate-weekly-summary` edge function. SMS sent via `send-sms`.

---

### STORY-024: Field Boss Review Dashboard ✅

**As a** field boss
**I want** to review and approve my crew's weekly hours
**So that** accurate data flows to the owner

**Acceptance Criteria:**
- [x] Dashboard view: Supervisor Review tab on `/approvals` page
- [x] Entries grouped by crew with daily breakdown
- [x] Inline edit capability for hours, start_time, end_time
- [x] Approve individual entries (→ boss_approved) or "Approve All" per crew
- [x] All changes logged to approval_log with previous/new values

**Implementation:** Supervisor Review section in approvals page.

---

### STORY-025: Owner Approval Dashboard ✅

**As the** vineyard owner
**I want** to see all approved timesheets and give final sign-off
**So that** payroll can be processed

**Acceptance Criteria:**
- [x] Owner Final Approval tab shows summaries with status 'boss_approved'
- [x] "Approve for Payroll" per summary or "Approve All"
- [x] Status updated to 'owner_approved'
- [x] All actions logged to approval_log

**Implementation:** Owner Final Approval section in approvals page.

---

### STORY-026: Payroll Export ✅

**As the** vineyard owner
**I want** to export approved time data for payroll
**So that** workers get paid accurately

**Acceptance Criteria:**
- [x] CSV export with: Worker Name, Week Start, Week End, Total Hours, Hourly Rate, Total Pay, Entry Count
- [x] Client-side CSV generation via Blob URL download
- [x] Shows only 'owner_approved' summaries
- [x] "Mark as Sent" button updates status to 'payroll_sent'
- [x] Export and mark actions logged to approval_log

**Implementation:** Payroll Export section in approvals page.

---

### STORY-027: Approval Audit Log ✅

**As an** admin
**I want** every approval action logged immutably
**So that** there is a complete audit trail

**Acceptance Criteria:**
- [x] All status changes logged in `approval_log`: created, confirmed, edited, approved, rejected, auto_approved, payroll_sent
- [x] previous_value and new_value stored as JSON for edits
- [x] Actor role recorded
- [x] Viewable at `/approvals/audit-log` with action type and date range filters
- [x] Action badges color-coded by type

**Implementation:** Audit log page at `/approvals/audit-log`. Approval actions insert into `approval_log` from the approvals dashboard.

---

### STORY-028: Daily Reminder Cron Jobs ✅

**As a** system
**I want** to send automated daily reminders
**So that** workers don't forget to log hours

**Acceptance Criteria:**
- [x] Evening reminder: active workers with phone numbers who haven't logged today
- [x] Morning follow-up: workers missing yesterday's entry
- [x] Bilingual SMS (EN/ES) with example format
- [x] Sent via Textbelt with reply webhook
- [x] Skip workers who have already logged for the relevant day
- [x] API route at `/api/daily-reminder` to trigger manually or via external cron

**Implementation:** `daily-reminder` edge function + `/api/daily-reminder` Next.js route. Can be wired to pg_cron or external scheduler.

---

## Schema Changes

- `weekly_summaries`: Added week_end, total_pay, hourly_rate_used, entry_count, unconfirmed_count, inferred_count, worker_confirmed_at, boss_approved_at, owner_approved_at, payroll_sent_at, updated_at
- `approval_log`: Added actor_role, previous_value (jsonb), new_value (jsonb); relaxed check constraint
- `summary_status` enum: Added worker_confirmed, boss_approved, owner_approved, payroll_sent
- `approval_action` enum: Added created, confirmed, auto_approved, escalated, payroll_sent
- `entry_status` enum: Added boss_approved, owner_approved, payroll_sent

## Edge Functions Deployed

| Function | Auth | Purpose |
|---|---|---|
| `generate-weekly-summary` | Service role JWT | Generate weekly summaries + send pay confirmation SMS |
| `daily-reminder` | Service role JWT | Evening/morning reminders for workers missing entries |

## Dashboard Pages

| Route | Description |
|---|---|
| `/approvals` | Combined approval workflow: worker status, supervisor review (inline edit), owner approval, payroll export (CSV) |
| `/approvals/audit-log` | Filterable audit trail of all approval actions |
