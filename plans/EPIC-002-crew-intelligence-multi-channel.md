# Epic 002: Crew Intelligence & Multi-Channel

**Status**: Complete
**Phase**: 2
**Duration**: Weeks 5–8

## Summary

Build the crew intelligence engine that cross-fills missing data from crew member reports and auto-generates entries for unreported workers. Add photo OCR and voice transcription channels.

---

## Stories

### STORY-015: Crew Cross-Fill Engine ✅

**As a** system
**I want** to fill in missing block/task data from crew context
**So that** partial reports become complete entries

**Acceptance Criteria:**
- [x] When a worker submits hours without a block, use majority block from crew entries that day
- [x] When a worker submits hours without a task, use majority task from crew entries that day
- [x] Fall back to crew defaults (default_vineyard_id, default_block_id) when no majority exists
- [x] Cross-filled data marked with lower confidence score (reduced by 0.2, min 0.3)
- [x] Audit trail: notes field indicates data was inferred from crew context

**Implementation:** `crew-intelligence` edge function, cross-fill logic runs on every entry creation for workers in a crew.

---

### STORY-016: Auto-Generate Entries for Unreported Workers ✅

**As a** system
**I want** to create draft entries for crew members who haven't reported
**So that** missing entries are caught proactively

**Acceptance Criteria:**
- [x] After processing a crew member's entry, check for unreported crew members that day
- [x] Generate draft entries with median hours and majority block/task from reported members
- [x] Set source_type = 'inferred', confidence = 0.4, inferred_from = triggering entry ID
- [x] Send bilingual SMS to unreported workers: "Your crew logged X hours at [block]. Did you work the same? Reply YES or send your actual hours."
- [x] Do not auto-generate if fewer than 2 crew members have reported
- [x] Idempotent: won't duplicate inferred entries on re-runs

**Implementation:** `crew-intelligence` edge function, called fire-and-forget from `sms-webhook` after entry creation.

---

### STORY-017: Anomaly Detection ✅

**As an** admin
**I want** to be alerted when crew data doesn't add up
**So that** I can investigate discrepancies

**Acceptance Criteria:**
- [x] Flag when hours variance within a crew exceeds 1.5 std dev (type: `hours_variance`, severity: warning)
- [x] Flag when a crew member reports a different vineyard/block than the rest (type: `block_mismatch`, severity: warning)
- [x] Flag when total daily hours exceed 12 for any worker (type: `excessive_hours`, severity: critical)
- [x] Anomalies visible in dashboard at `/anomalies` with filters (type, date range, resolved/unresolved) and resolve button

**Implementation:** `crew-intelligence` edge function runs anomaly checks after cross-fill and auto-generate. `anomalies` table with dashboard page.

---

### STORY-018: Photo OCR Pipeline ✅

**As a** worker
**I want** to take a photo of a handwritten timesheet
**So that** I can submit hours without typing

**Acceptance Criteria:**
- [x] Detect MMS with image attachment (via Twilio webhook MediaContentType fields)
- [x] Fetch image from Twilio media URL (with auth fallback)
- [x] Send to Claude Vision API (claude-sonnet-4-20250514) for OCR extraction
- [x] Parse extracted text through same AI pipeline and entry creation
- [x] Handle multi-worker timesheets (crew lead submitting for entire crew — matches names to crew members)

**Implementation:** `twilio-webhook` edge function, `processImageOCR()` function. Requires MMS via Twilio (Textbelt is SMS-only).

---

### STORY-019: Voice Transcription Pipeline ✅

**As a** worker
**I want** to send a voice message with my hours
**So that** I can report while driving or working

**Acceptance Criteria:**
- [x] Detect MMS with audio attachment (audio/mpeg, audio/ogg, audio/amr, audio/wav, audio/mp4)
- [x] Fetch audio from Twilio media URL
- [x] Transcribe via OpenAI Whisper API (whisper-1 model, EN + ES language hint)
- [x] Parse transcription through same AI pipeline
- [x] Graceful fallback: "Voice messages are not yet supported" if OPENAI_API_KEY not set

**Implementation:** `twilio-webhook` edge function, `processVoiceTranscription()` function. Requires `OPENAI_API_KEY` secret.

---

### STORY-020: Crew Lead Batch Entry ✅

**As a** crew lead
**I want** to submit hours for my entire crew in one message
**So that** I don't have to wait for each member to report individually

**Acceptance Criteria:**
- [x] AI recognizes batch entry format: "Team today: Maria 8h, Juan 7h, Carlos 8h pruning block A"
- [x] Creates individual entries for each named worker
- [x] Matches names to workers in the crew lead's crew (3-tier fuzzy match: exact, first name, partial)
- [x] Validates sender is elevated type with a crew
- [x] Confirmation includes all workers' entries; warnings for unmatched names

**Implementation:** `sms-webhook` edge function, `handleBatchEntries()` function with `fuzzyNameMatch()` helper. AI prompt updated with batch entry JSON format.

---

### STORY-021: Historical Pattern Suggestions ✅

**As a** system
**I want** to suggest likely entries based on past patterns
**So that** workers can confirm instead of typing from scratch

**Acceptance Criteria:**
- [x] Detects short messages (just a number or "Xh") from idle workers
- [x] Queries last 2 weeks of confirmed entries for most common block+task combination (min 2 occurrences)
- [x] Sends suggestion: "Same as yesterday? Xh [task] at [block]. Reply YES or send details."
- [x] YES creates the entry from the stored suggestion; anything else falls through to normal AI parsing
- [x] New conversation state `awaiting_suggestion` added to enum

**Implementation:** `sms-webhook` edge function, `getHistoricalSuggestion()` function. Migration `20250320000002_add_awaiting_suggestion_state.sql`.

---

## Schema Changes

- `time_entries.inferred_from` (uuid FK → time_entries) — audit trail for crew intelligence
- `time_entries.source_type` (text) — 'sms', 'inferred', 'photo', 'voice', etc.
- `anomalies` table — crew discrepancy flags with type, severity, resolution tracking
- `conversation_state_type` enum — added 'awaiting_suggestion' value

## Edge Functions Deployed

| Function | Auth | Purpose |
|---|---|---|
| `crew-intelligence` | Service role JWT | Cross-fill, auto-generate, anomaly detection |
| `sms-webhook` | Public | Textbelt reply handler (updated with batch, history, crew-intel integration) |
| `twilio-webhook` | Public | Twilio MMS handler (updated with photo OCR, voice transcription) |
| `send-sms` | Service role JWT | Textbelt outbound with reply webhook |
