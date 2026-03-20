"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const actionVariant: Record<string, "secondary" | "success" | "warning" | "default" | "destructive"> = {
  created: "secondary",
  confirmed: "success",
  edited: "warning",
  approved: "default",
  rejected: "destructive",
  auto_approved: "secondary",
  payroll_sent: "default",
};

interface AuditLogRow {
  id: string;
  action: string;
  entry_id: string | null;
  summary_id: string | null;
  actor_role: string | null;
  notes: string | null;
  created_at: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const actionOptions = [
    { value: "", label: t("approvals.all_actions", locale) },
    { value: "created", label: t("approvals.action_created", locale) },
    { value: "confirmed", label: t("approvals.action_confirmed", locale) },
    { value: "edited", label: t("approvals.action_edited", locale) },
    { value: "approved", label: t("approvals.action_approved", locale) },
    { value: "rejected", label: t("approvals.action_rejected", locale) },
    { value: "auto_approved", label: t("approvals.action_auto_approved", locale) },
    { value: "payroll_sent", label: t("approvals.action_payroll_sent", locale) },
  ];

  const columns = [
    {
      key: "created_at",
      header: t("approvals.time_col", locale),
      render: (row: AuditLogRow) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: "action",
      header: t("approvals.action", locale),
      render: (row: AuditLogRow) => (
        <Badge variant={actionVariant[row.action] ?? "secondary"}>
          {row.action.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "entry_summary",
      header: t("approvals.entry_summary", locale),
      render: (row: AuditLogRow) => {
        if (row.entry_id) return `Entry: ${row.entry_id.slice(0, 8)}...`;
        if (row.summary_id) return `Summary: ${row.summary_id.slice(0, 8)}...`;
        return "-";
      },
    },
    {
      key: "actor_role",
      header: t("approvals.role", locale),
      render: (row: AuditLogRow) => row.actor_role ?? "-",
    },
    {
      key: "notes",
      header: t("common.notes", locale),
      render: (row: AuditLogRow) => row.notes ?? "-",
    },
  ];

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("approval_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (actionFilter) {
      query = query.eq("action", actionFilter);
    }
    if (startDate) {
      query = query.gte("created_at", startDate + "T00:00:00");
    }
    if (endDate) {
      query = query.lte("created_at", endDate + "T23:59:59");
    }

    const { data } = await query;
    setLogs((data as AuditLogRow[] | null) ?? []);
    setLoading(false);
  }, [supabase, actionFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/approvals">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("approvals.audit_log_title", locale)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("approvals.audit_log_subtitle", locale)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="action">{t("approvals.action", locale)}</Label>
          <Select
            id="action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="start">{t("common.start_date", locale)}</Label>
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end">{t("common.end_date", locale)}</Label>
          <Input
            id="end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setActionFilter("");
            setStartDate("");
            setEndDate("");
          }}
        >
          {t("common.reset_filters", locale)}
        </Button>
        {loading && (
          <span className="text-sm text-muted-foreground">{t("common.loading", locale)}</span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={logs}
        emptyMessage={t("approvals.no_audit_logs", locale)}
      />
    </div>
  );
}
