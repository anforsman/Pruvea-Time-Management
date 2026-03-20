# Epic 004: Cost Allocation & Scale

**Status**: Complete
**Phase**: 4
**Duration**: Weeks 13–16

## Summary

Build cost allocation reporting, COGS analysis, lease cost-sharing calculations, analytics dashboard, PWA for mobile field use, bilingual UI, and multi-tenant foundation.

---

## Stories

### STORY-029: Cost Allocation Engine ✅

**As the** vineyard owner
**I want** labor costs broken down by vineyard, block, and task
**So that** I can calculate unit economics and COGS per varietal

**Acceptance Criteria:**
- [x] Query total labor hours and cost per vineyard, block, task for any date range
- [x] Cost = hours × worker hourly_rate
- [x] Cost per acre = total cost / block acreage
- [x] Drilldown: vineyard → blocks (clicking vineyard row filters to block view)
- [x] Export to CSV (client-side Blob URL)
- [x] Group by: vineyard, block, task, or worker
- [x] Summary cards: Total Hours, Total Cost, Avg Cost/Hour

**Implementation:** `/reports` page with dynamic grouping, filtering, and CSV export.

---

### STORY-030: Lease Cost-Sharing Reports ✅

**As the** vineyard owner
**I want** labor costs allocated to lease agreements
**So that** I can bill lessees accurately

**Acceptance Criteria:**
- [x] Blocks linked to lease agreements via `blocks.lease_agreement_id`
- [x] Calculate labor cost per lease based on `cost_share_formula` (percentage or per_acre_hour)
- [x] Table: Lease Name, Lessee, Blocks, Total Hours, Total Cost, Lessee Share, Owner Share
- [x] Expandable rows showing block-level detail
- [x] Export Invoice CSV with per-block line items

**Implementation:** `/reports/leases` page. Schema: added `cost_share_formula` (jsonb) to lease_agreements, `lease_agreement_id` to blocks.

---

### STORY-031: Analytics Dashboard ✅

**As the** vineyard owner
**I want** visual analytics on labor trends
**So that** I can make staffing and operational decisions

**Acceptance Criteria:**
- [x] Hours by week (horizontal bar chart, pure CSS)
- [x] Hours by vineyard (horizontal bar chart)
- [x] Hours by task category (colored bars with legend — canopy=green, pruning=amber, harvest=purple, etc.)
- [x] Worker utilization table (name, weeks active, total hours, avg hours/week, days worked)
- [x] Responsive (mobile-friendly), no charting library dependency
- [x] Date range filter (default: last 4 weeks)

**Implementation:** `/analytics` page with reusable `BarChart` component using Tailwind CSS divs.

---

### STORY-032: Progressive Web App (PWA) ✅

**As a** field boss
**I want** to install the dashboard on my phone
**So that** it works like a native app with offline support

**Acceptance Criteria:**
- [x] Web app manifest (`public/manifest.json`) with name, icons, standalone display
- [x] Service worker (`public/sw.js`) with network-first caching and offline fallback
- [x] "Add to Home Screen" supported via manifest
- [x] App shell routes cached: `/`, `/workers`, `/time-entries`, `/approvals`
- [x] SVG icon at `public/icon.svg`
- [x] Meta tags: theme-color, apple-mobile-web-app-capable
- [x] Service worker registered in root layout

**Implementation:** Static PWA files in `public/`, registration in `src/app/layout.tsx`.

---

### STORY-033: Authentication & Role-Based Access ✅ (Foundation)

**As an** admin
**I want** proper authentication and role-based permissions
**So that** workers/bosses/owners see only what they should

**Acceptance Criteria:**
- [x] `organizations` table for multi-tenant support
- [x] `user_accounts` table linking Supabase Auth UIDs to workers with roles (worker, field_boss, owner, admin)
- [x] `org_id` added to vineyards, crews, workers for data isolation
- [x] Default organization seeded ("Tedeschi Family Vineyards")
- [ ] Supabase Auth login flow (deferred — currently using anon key)
- [ ] Role-based RLS policies (deferred — currently permissive)

**Implementation:** Schema migration with organizations, user_accounts tables. Full auth flow deferred to production hardening.

---

### STORY-034: Bilingual UI ✅

**As a** Spanish-speaking field boss
**I want** the dashboard in Spanish
**So that** I can use it comfortably

**Acceptance Criteria:**
- [x] `src/lib/i18n.ts` — Translation dictionary with ~45 keys (nav, common actions, statuses, workers, dashboard)
- [x] `src/lib/i18n-context.tsx` — React context with `LocaleProvider` and `useLocale` hook
- [x] Locale persisted in localStorage
- [x] Language toggle (EN/ES) in sidebar with Globe icon
- [x] Sidebar navigation labels translated
- [x] Dashboard layout wrapped with `LocaleProvider`

**Implementation:** Lightweight i18n system without external library. Progressive adoption — sidebar translated, other pages can consume `useLocale()` + `t()` as needed.

---

### STORY-035: Multi-Vineyard / Multi-Owner Support ✅ (Foundation)

**As the** system
**I want** to support multiple vineyard operations
**So that** the platform can scale beyond a single owner

**Acceptance Criteria:**
- [x] `organizations` table with slug, timezone, pay_period, approval_deadline_hours
- [x] `org_id` foreign keys on vineyards, crews, workers
- [x] Default org seeded
- [ ] Org-based data filtering in queries (deferred — single-org for now)
- [ ] Org switcher in UI (deferred)

**Implementation:** Schema foundation in place. Full multi-org query filtering deferred to production.

---

## Schema Changes

- `lease_agreements.cost_share_formula` (jsonb) — percentage or per-acre-hour formulas
- `blocks.lease_agreement_id` (uuid FK → lease_agreements)
- `organizations` table — multi-tenant foundation (name, slug, timezone, pay_period)
- `user_accounts` table — auth UID → worker → role → org mapping
- `vineyards.org_id`, `crews.org_id`, `workers.org_id` (uuid FK → organizations)

## Dashboard Pages

| Route | Description |
|---|---|
| `/reports` | Cost allocation by vineyard/block/task/worker with CSV export |
| `/reports/leases` | Lease cost-sharing with per-block detail and invoice CSV |
| `/analytics` | Visual analytics — hours by week/vineyard/task, worker utilization |

## PWA Assets

| File | Description |
|---|---|
| `public/manifest.json` | Web app manifest |
| `public/sw.js` | Service worker (network-first + offline fallback) |
| `public/icon.svg` | App icon |

## i18n System

| File | Description |
|---|---|
| `src/lib/i18n.ts` | Translation dictionary + `t()` function |
| `src/lib/i18n-context.tsx` | `LocaleProvider` + `useLocale()` hook |
