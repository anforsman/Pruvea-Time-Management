"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  CheckCircle,
  Download,
  RefreshCw,
  Send,
  ChevronDown,
  ChevronRight,
  Pencil,
  Save,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the Monday (ISO date string) of the week containing the given date. */
function getMonday(d: Date): string {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  dt.setDate(dt.getDate() + diff);
  return dt.toISOString().split("T")[0];
}

function getWeekEnd(mondayStr: string): string {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

function formatTime(tm: string | null): string {
  if (!tm) return "-";
  const [h, m] = tm.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m}${ampm}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const summaryStatusVariant: Record<string, "warning" | "success" | "default" | "secondary"> = {
  pending: "warning",
  worker_confirmed: "success",
  boss_approved: "default",
  owner_approved: "default",
  payroll_sent: "secondary",
};

interface SummaryRow {
  id: string;
  worker_id: string;
  week_start: string;
  week_end: string;
  total_hours: number;
  total_pay: number;
  entry_count: number;
  unconfirmed_count: number;
  inferred_count: number;
  status: string;
  confirmed_at: string | null;
  worker: { full_name: string; hourly_rate: number | null } | null;
  [key: string]: unknown;
}

interface TimeEntry {
  id: string;
  date: string;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  status: string;
  worker_id: string;
  block: { name: string } | null;
  task: { name: string } | null;
  worker: { full_name: string; crew_id: string | null } | null;
  [key: string]: unknown;
}

interface CrewGroup {
  crewId: string | null;
  crewName: string;
  entries: TimeEntry[];
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = "confirmation" | "supervisor" | "owner" | "payroll";

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ApprovalsPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("confirmation");
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));

  const tabs: { key: Tab; label: string }[] = [
    { key: "confirmation", label: t("approvals.worker_confirmation_tab", locale) },
    { key: "supervisor", label: t("approvals.supervisor_review_tab", locale) },
    { key: "owner", label: t("approvals.owner_approval_tab", locale) },
    { key: "payroll", label: t("approvals.payroll_export_tab", locale) },
  ];

  // Data
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [crews, setCrews] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sendingSummary, setSendingSummary] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const weekEnd = getWeekEnd(weekStart);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchSummaries = useCallback(async () => {
    const { data } = await supabase
      .from("weekly_summaries")
      .select("*, worker:workers(full_name, hourly_rate)")
      .eq("week_start", weekStart)
      .order("status");
    setSummaries((data as SummaryRow[] | null) ?? []);
  }, [supabase, weekStart]);

  const fetchEntries = useCallback(async () => {
    const { data } = await supabase
      .from("time_entries")
      .select(
        "id, date, hours, start_time, end_time, status, worker_id, block:blocks(name), task:tasks(name), worker:workers(full_name, crew_id)"
      )
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date");
    setEntries((data as TimeEntry[] | null) ?? []);
  }, [supabase, weekStart, weekEnd]);

  const fetchCrews = useCallback(async () => {
    const { data } = await supabase.from("crews").select("id, name").order("name");
    setCrews((data as { id: string; name: string }[] | null) ?? []);
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSummaries(), fetchEntries(), fetchCrews()]);
    setLoading(false);
  }, [fetchSummaries, fetchEntries, fetchCrews]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // -----------------------------------------------------------------------
  // Week selector handler — snap to Monday
  // -----------------------------------------------------------------------

  function handleWeekChange(value: string) {
    if (!value) return;
    setWeekStart(getMonday(new Date(value + "T00:00:00")));
  }

  // -----------------------------------------------------------------------
  // Generate summaries
  // -----------------------------------------------------------------------

  async function generateSummaries() {
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_start: weekStart }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to generate summaries");
      }
    } catch {
      alert("Network error generating summaries");
    }
    await fetchSummaries();
    setGenerating(false);
  }

  // -----------------------------------------------------------------------
  // Send week-end summary SMS to all workers with pending summaries
  // -----------------------------------------------------------------------

  async function sendWeekEndSummary() {
    setSendingSummary(true);
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_start: weekStart }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(
          locale === "es"
            ? `Resumen enviado a ${data.sms_sent} trabajador(es).`
            : `Summary sent to ${data.sms_sent} worker(s).`
        );
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || "Failed to send summaries");
      }
    } catch {
      alert("Network error sending summaries");
    }
    await fetchSummaries();
    setSendingSummary(false);
  }

  // -----------------------------------------------------------------------
  // Approval log helper
  // -----------------------------------------------------------------------

  async function logApproval(
    action: string,
    opts: {
      entry_id?: string;
      summary_id?: string;
      notes?: string;
      actor_role?: string;
    }
  ) {
    await supabase.from("approval_log").insert({
      action,
      entry_id: opts.entry_id ?? null,
      summary_id: opts.summary_id ?? null,
      notes: opts.notes ?? null,
      actor_role: opts.actor_role ?? "supervisor",
      created_at: new Date().toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // Supervisor actions
  // -----------------------------------------------------------------------

  async function approveEntry(entryId: string) {
    setActionLoading(entryId);
    await supabase
      .from("time_entries")
      .update({ status: "boss_approved" })
      .eq("id", entryId);
    await logApproval("approved", { entry_id: entryId, actor_role: "supervisor" });
    await fetchEntries();
    setActionLoading(null);
  }

  async function approveAllForCrew(crewEntries: TimeEntry[]) {
    setActionLoading("crew-all");
    const ids = crewEntries.map((e) => e.id);
    await supabase
      .from("time_entries")
      .update({ status: "boss_approved" })
      .in("id", ids);
    for (const id of ids) {
      await logApproval("approved", { entry_id: id, actor_role: "supervisor" });
    }
    await fetchEntries();
    setActionLoading(null);
  }

  // -----------------------------------------------------------------------
  // Owner actions
  // -----------------------------------------------------------------------

  async function ownerApproveSummary(summaryId: string) {
    setActionLoading(summaryId);
    await supabase
      .from("weekly_summaries")
      .update({ status: "owner_approved" })
      .eq("id", summaryId);
    await logApproval("approved", { summary_id: summaryId, actor_role: "owner" });
    await fetchSummaries();
    setActionLoading(null);
  }

  async function ownerApproveAll() {
    setActionLoading("owner-all");
    const ids = summaries
      .filter((s) => s.status === "boss_approved")
      .map((s) => s.id);
    if (ids.length === 0) return;
    await supabase
      .from("weekly_summaries")
      .update({ status: "owner_approved" })
      .in("id", ids);
    for (const id of ids) {
      await logApproval("approved", { summary_id: id, actor_role: "owner" });
    }
    await fetchSummaries();
    setActionLoading(null);
  }

  // -----------------------------------------------------------------------
  // Payroll
  // -----------------------------------------------------------------------

  function exportCSV() {
    const payrollSummaries = summaries.filter((s) => s.status === "owner_approved");
    if (payrollSummaries.length === 0) return;

    const header = "Worker Name,Week Start,Week End,Total Hours,Hourly Rate,Total Pay,Entry Count";
    const rows = payrollSummaries.map((s) => {
      const name = (s.worker?.full_name ?? "Unknown").replace(/,/g, " ");
      const rate = s.worker?.hourly_rate ?? 0;
      return `${name},${s.week_start},${s.week_end},${s.total_hours},${rate},${s.total_pay},${s.entry_count}`;
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${weekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function markAsSent() {
    setActionLoading("payroll-sent");
    const ids = summaries
      .filter((s) => s.status === "owner_approved")
      .map((s) => s.id);
    if (ids.length === 0) return;
    await supabase
      .from("weekly_summaries")
      .update({ status: "payroll_sent" })
      .in("id", ids);
    for (const id of ids) {
      await logApproval("payroll_sent", { summary_id: id, actor_role: "owner" });
    }
    await fetchSummaries();
    setActionLoading(null);
  }

  // -----------------------------------------------------------------------
  // Crew grouping for supervisor review
  // -----------------------------------------------------------------------

  const crewGroups: CrewGroup[] = (() => {
    const map = new Map<string | null, TimeEntry[]>();
    for (const entry of entries) {
      const crewId = entry.worker?.crew_id ?? null;
      if (!map.has(crewId)) map.set(crewId, []);
      map.get(crewId)!.push(entry);
    }
    const groups: CrewGroup[] = [];
    for (const [crewId, crewEntries] of map) {
      const crew = crews.find((c) => c.id === crewId);
      groups.push({
        crewId,
        crewName: crew?.name ?? "Unassigned",
        entries: crewEntries,
      });
    }
    groups.sort((a, b) => a.crewName.localeCompare(b.crewName));
    return groups;
  })();

  // -----------------------------------------------------------------------
  // Summary columns for Section 1
  // -----------------------------------------------------------------------

  const confirmationColumns = [
    {
      key: "worker",
      header: t("approvals.worker_col", locale),
      render: (row: SummaryRow) => row.worker?.full_name ?? "Unknown",
    },
    { key: "total_hours", header: t("approvals.total_hours", locale) },
    {
      key: "total_pay",
      header: t("approvals.total_pay", locale),
      render: (row: SummaryRow) => `$${row.total_pay.toFixed(2)}`,
    },
    { key: "entry_count", header: t("approvals.entries", locale) },
    { key: "unconfirmed_count", header: t("approvals.unconfirmed", locale) },
    { key: "inferred_count", header: t("approvals.inferred", locale) },
    {
      key: "status",
      header: t("common.status", locale),
      render: (row: SummaryRow) => (
        <Badge variant={summaryStatusVariant[row.status] ?? "secondary"}>
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "confirmed_at",
      header: t("approvals.confirmed_at", locale),
      render: (row: SummaryRow) =>
        row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "-",
    },
  ];

  // -----------------------------------------------------------------------
  // Owner review columns
  // -----------------------------------------------------------------------

  const ownerColumns = [
    {
      key: "worker",
      header: t("approvals.worker_col", locale),
      render: (row: SummaryRow) => row.worker?.full_name ?? "Unknown",
    },
    { key: "total_hours", header: t("approvals.total_hours", locale) },
    {
      key: "total_pay",
      header: t("approvals.total_pay", locale),
      render: (row: SummaryRow) => `$${row.total_pay.toFixed(2)}`,
    },
    { key: "entry_count", header: t("approvals.entries", locale) },
    {
      key: "status",
      header: t("common.status", locale),
      render: (row: SummaryRow) => (
        <Badge variant={summaryStatusVariant[row.status] ?? "secondary"}>
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row: SummaryRow) =>
        row.status === "boss_approved" ? (
          <Button
            size="sm"
            onClick={() => ownerApproveSummary(row.id)}
            disabled={actionLoading === row.id}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t("approvals.approve_payroll", locale)}
          </Button>
        ) : null,
    },
  ];

  // -----------------------------------------------------------------------
  // Payroll columns
  // -----------------------------------------------------------------------

  const payrollColumns = [
    {
      key: "worker",
      header: t("approvals.worker_col", locale),
      render: (row: SummaryRow) => row.worker?.full_name ?? "Unknown",
    },
    { key: "total_hours", header: t("approvals.total_hours", locale) },
    {
      key: "hourly_rate",
      header: t("approvals.hourly_rate", locale),
      render: (row: SummaryRow) => `$${(row.worker?.hourly_rate ?? 0).toFixed(2)}`,
    },
    {
      key: "total_pay",
      header: t("approvals.total_pay", locale),
      render: (row: SummaryRow) => `$${row.total_pay.toFixed(2)}`,
    },
    { key: "entry_count", header: t("approvals.entries", locale) },
    {
      key: "status",
      header: t("common.status", locale),
      render: (row: SummaryRow) => (
        <Badge variant={summaryStatusVariant[row.status] ?? "secondary"}>
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
  ];

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const bossApprovedSummaries = summaries.filter((s) => s.status === "boss_approved");
  const ownerApprovedSummaries = summaries.filter((s) => s.status === "owner_approved");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("approvals.title", locale)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("approvals.subtitle", locale)}
          </p>
        </div>
        <Link href="/approvals/audit-log">
          <Button variant="outline" size="sm">
            {t("approvals.audit_log", locale)}
          </Button>
        </Link>
      </div>

      {/* Week selector */}
      <div className="flex items-end gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="week">{t("approvals.week_of", locale)}</Label>
          <Input
            id="week"
            type="date"
            value={weekStart}
            onChange={(e) => handleWeekChange(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground pb-1.5">
          {weekStart} &mdash; {weekEnd}
        </p>
        {loading && (
          <span className="text-sm text-muted-foreground pb-1.5">{t("common.loading", locale)}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================================== */}
      {/* Section 1: Worker Confirmation Status */}
      {/* ============================================================== */}
      {activeTab === "confirmation" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t("approvals.worker_confirmation", locale)}</CardTitle>
            <div className="flex gap-2">
              <Button onClick={generateSummaries} disabled={generating} size="sm">
                <RefreshCw className={`h-4 w-4 mr-1 ${generating ? "animate-spin" : ""}`} />
                {generating ? t("approvals.generating", locale) : t("approvals.generate_summaries", locale)}
              </Button>
              <Button onClick={sendWeekEndSummary} disabled={sendingSummary} size="sm" variant="outline">
                <Send className={`h-4 w-4 mr-1 ${sendingSummary ? "animate-pulse" : ""}`} />
                {sendingSummary
                  ? (locale === "es" ? "Enviando..." : "Sending...")
                  : (locale === "es" ? "Enviar Resumen Semanal" : "Send Week-End Summary")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={confirmationColumns}
              data={summaries}
              emptyMessage={t("approvals.no_summaries_generate", locale)}
            />
          </CardContent>
        </Card>
      )}

      {/* ============================================================== */}
      {/* Section 2: Supervisor Review */}
      {/* ============================================================== */}
      {activeTab === "supervisor" && (
        <div className="space-y-6">
          {crewGroups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("approvals.no_time_entries_week", locale)}
            </p>
          )}
          {crewGroups.map((group) => (
            <CrewReviewCard
              key={group.crewId ?? "unassigned"}
              group={group}
              onApproveEntry={approveEntry}
              onApproveAll={approveAllForCrew}
              actionLoading={actionLoading}
              supabase={supabase}
              onRefresh={fetchEntries}
              logApproval={logApproval}
              locale={locale}
            />
          ))}
        </div>
      )}

      {/* ============================================================== */}
      {/* Section 3: Owner Final Approval */}
      {/* ============================================================== */}
      {activeTab === "owner" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t("approvals.owner_approval", locale)}</CardTitle>
            {bossApprovedSummaries.length > 0 && (
              <Button
                onClick={ownerApproveAll}
                disabled={actionLoading === "owner-all"}
                size="sm"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                {t("approvals.approve_all", locale)} ({bossApprovedSummaries.length})
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable
              columns={ownerColumns}
              data={bossApprovedSummaries}
              emptyMessage={t("approvals.no_owner_pending", locale)}
            />
          </CardContent>
        </Card>
      )}

      {/* ============================================================== */}
      {/* Section 4: Payroll Export */}
      {/* ============================================================== */}
      {activeTab === "payroll" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t("approvals.payroll_export", locale)}</CardTitle>
            <div className="flex gap-2">
              {ownerApprovedSummaries.length > 0 && (
                <>
                  <Button onClick={exportCSV} size="sm" variant="outline">
                    <Download className="h-4 w-4 mr-1" />
                    {t("common.export_csv", locale)}
                  </Button>
                  <Button
                    onClick={markAsSent}
                    disabled={actionLoading === "payroll-sent"}
                    size="sm"
                  >
                    <Send className="h-4 w-4 mr-1" />
                    {t("approvals.mark_sent", locale)}
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={payrollColumns}
              data={ownerApprovedSummaries}
              emptyMessage={t("approvals.no_payroll_ready", locale)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crew Review Card (Supervisor Section)
// ---------------------------------------------------------------------------

function CrewReviewCard({
  group,
  onApproveEntry,
  onApproveAll,
  actionLoading,
  supabase,
  onRefresh,
  logApproval: logApprovalFn,
  locale,
}: {
  group: CrewGroup;
  onApproveEntry: (id: string) => Promise<void>;
  onApproveAll: (entries: TimeEntry[]) => Promise<void>;
  actionLoading: string | null;
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => Promise<void>;
  logApproval: (
    action: string,
    opts: { entry_id?: string; summary_id?: string; notes?: string; actor_role?: string }
  ) => Promise<void>;
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    hours: number;
    start_time: string;
    end_time: string;
  }>({ hours: 0, start_time: "", end_time: "" });

  function startEdit(entry: TimeEntry) {
    setEditingId(entry.id);
    setEditValues({
      hours: entry.hours,
      start_time: entry.start_time ?? "",
      end_time: entry.end_time ?? "",
    });
  }

  async function saveEdit(entryId: string) {
    await supabase
      .from("time_entries")
      .update({
        hours: editValues.hours,
        start_time: editValues.start_time || null,
        end_time: editValues.end_time || null,
      })
      .eq("id", entryId);
    await logApprovalFn("edited", {
      entry_id: entryId,
      actor_role: "supervisor",
      notes: `Hours: ${editValues.hours}, Start: ${editValues.start_time || "none"}, End: ${editValues.end_time || "none"}`,
    });
    setEditingId(null);
    await onRefresh();
  }

  const pendingEntries = group.entries.filter(
    (e) => e.status !== "boss_approved" && e.status !== "owner_approved" && e.status !== "payroll_sent"
  );

  return (
    <Card>
      <CardHeader
        className="flex-row items-center justify-between space-y-0 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <CardTitle>
            {group.crewName}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({group.entries.length} {t("approvals.entries_count", locale)})
            </span>
          </CardTitle>
        </div>
        {pendingEntries.length > 0 && (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onApproveAll(pendingEntries);
            }}
            disabled={actionLoading === "crew-all"}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t("approvals.approve_all", locale)} ({pendingEntries.length})
          </Button>
        )}
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.worker_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.date_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.hours_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.start_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.end_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.block_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.task_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("approvals.status_col", locale)}</th>
                  <th className="h-10 px-4 text-left font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="p-4">{entry.worker?.full_name ?? "Unknown"}</td>
                    <td className="p-4">{entry.date}</td>

                    {editingId === entry.id ? (
                      <>
                        <td className="p-4">
                          <Input
                            type="number"
                            step="0.25"
                            value={editValues.hours}
                            onChange={(e) =>
                              setEditValues({ ...editValues, hours: parseFloat(e.target.value) || 0 })
                            }
                            className="w-20"
                          />
                        </td>
                        <td className="p-4">
                          <Input
                            type="time"
                            value={editValues.start_time}
                            onChange={(e) =>
                              setEditValues({ ...editValues, start_time: e.target.value })
                            }
                            className="w-28"
                          />
                        </td>
                        <td className="p-4">
                          <Input
                            type="time"
                            value={editValues.end_time}
                            onChange={(e) =>
                              setEditValues({ ...editValues, end_time: e.target.value })
                            }
                            className="w-28"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-4">{entry.hours}</td>
                        <td className="p-4">{formatTime(entry.start_time)}</td>
                        <td className="p-4">{formatTime(entry.end_time)}</td>
                      </>
                    )}

                    <td className="p-4">{entry.block?.name ?? "-"}</td>
                    <td className="p-4">{entry.task?.name ?? "-"}</td>
                    <td className="p-4">
                      <Badge
                        variant={
                          entry.status === "boss_approved" || entry.status === "owner_approved"
                            ? "success"
                            : entry.status === "draft"
                            ? "warning"
                            : "secondary"
                        }
                      >
                        {entry.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        {editingId === entry.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveEdit(entry.id)}
                            >
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(entry)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {entry.status !== "boss_approved" &&
                              entry.status !== "owner_approved" &&
                              entry.status !== "payroll_sent" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onApproveEntry(entry.id)}
                                  disabled={actionLoading === entry.id}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  {t("approvals.approve", locale)}
                                </Button>
                              )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
