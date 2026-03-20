"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MessageSquare, PenLine } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

const statusVariant: Record<string, "warning" | "success" | "default" | "destructive" | "secondary"> = {
  draft: "warning",
  worker_confirmed: "success",
  supervisor_approved: "default",
  rejected: "destructive",
  edited: "secondary",
};

interface Worker {
  id: string;
  full_name: string;
}

interface VineyardOption {
  id: string;
  name: string;
}

interface EntryRow {
  id: string;
  date: string;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  status: string;
  ai_confidence: number | null;
  notes: string | null;
  source_message_id: string | null;
  source_message: { body: string | null } | null;
  worker: { full_name: string } | null;
  vineyard: { name: string } | null;
  block: { name: string } | null;
  task: { name: string } | null;
  [key: string]: unknown;
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "-";
  // timeStr is "HH:MM:SS", display as "H:MMam/pm"
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m}${ampm}`;
}

export default function TimeEntriesPage() {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const { locale } = useLocale();

  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [vineyards, setVineyards] = useState<VineyardOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [workerId, setWorkerId] = useState("");
  const [status, setStatus] = useState("");
  const [vineyardId, setVineyardId] = useState("");

  const statusOptions = [
    { value: "", label: t("time_entries.all_statuses", locale) },
    { value: "draft", label: t("status.draft", locale) },
    { value: "worker_confirmed", label: t("status.worker_confirmed", locale) },
    { value: "supervisor_approved", label: t("status.supervisor_approved", locale) },
    { value: "rejected", label: t("status.rejected", locale) },
    { value: "edited", label: t("status.edited", locale) },
  ];

  const columns = [
    {
      key: "date",
      header: t("common.date", locale),
    },
    {
      key: "worker",
      header: t("time_entries.worker", locale),
      render: (row: EntryRow) => row.worker?.full_name ?? "Unknown",
    },
    {
      key: "vineyard",
      header: t("time_entries.vineyard", locale),
      render: (row: EntryRow) => row.vineyard?.name ?? "-",
    },
    {
      key: "block",
      header: t("time_entries.block", locale),
      render: (row: EntryRow) => row.block?.name ?? "-",
    },
    {
      key: "task",
      header: t("time_entries.task", locale),
      render: (row: EntryRow) => row.task?.name ?? "-",
    },
    {
      key: "start_time",
      header: t("common.start", locale),
      render: (row: EntryRow) => formatTime(row.start_time),
    },
    {
      key: "end_time",
      header: t("common.end", locale),
      render: (row: EntryRow) => formatTime(row.end_time),
    },
    {
      key: "hours",
      header: t("common.hours", locale),
    },
    {
      key: "status",
      header: t("common.status", locale),
      render: (row: EntryRow) => {
        const statusKey = `status.${row.status}` as string;
        return (
          <Badge variant={statusVariant[row.status] ?? "default"}>
            {t(statusKey, locale)}
          </Badge>
        );
      },
    },
    {
      key: "ai_confidence",
      header: t("common.confidence", locale),
      render: (row: EntryRow) =>
        row.ai_confidence != null ? `${Math.round(row.ai_confidence * 100)}%` : "-",
    },
    {
      key: "source",
      header: t("common.source", locale),
      className: "text-center",
      render: (row: EntryRow) => {
        if (!row.source_message_id) {
          return (
            <span title={t("common.manual_entry", locale)}>
              <PenLine className="h-4 w-4 text-muted-foreground mx-auto" />
            </span>
          );
        }
        const messageBody = row.source_message?.body ?? "SMS";
        return (
          <span title={messageBody} className="cursor-help">
            <MessageSquare className="h-4 w-4 text-primary mx-auto" />
          </span>
        );
      },
    },
  ];

  const fetchEntries = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("time_entries")
      .select("id, date, hours, start_time, end_time, status, ai_confidence, notes, source_message_id, source_message:raw_messages(body), worker:workers(full_name), vineyard:vineyards(name), block:blocks(name), task:tasks(name)")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (startDate) {
      query = query.gte("date", startDate);
    }
    if (endDate) {
      query = query.lte("date", endDate);
    }
    if (workerId) {
      query = query.eq("worker_id", workerId);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (vineyardId) {
      query = query.eq("vineyard_id", vineyardId);
    }

    const { data } = await query;
    setEntries((data as EntryRow[] | null) ?? []);
    setLoading(false);
  }, [supabase, startDate, endDate, workerId, status, vineyardId]);

  useEffect(() => {
    async function loadFilterOptions() {
      const [{ data: w }, { data: v }] = await Promise.all([
        supabase.from("workers").select("id, full_name").eq("is_active", true).order("full_name"),
        supabase.from("vineyards").select("id, name").order("name"),
      ]);
      setWorkers((w as Worker[] | null) ?? []);
      setVineyards((v as VineyardOption[] | null) ?? []);
    }
    loadFilterOptions();
  }, [supabase]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("time_entries.title", locale)}</h1>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="start_date">{t("common.start_date", locale)}</Label>
          <Input
            id="start_date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="end_date">{t("common.end_date", locale)}</Label>
          <Input
            id="end_date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="worker">{t("time_entries.worker", locale)}</Label>
          <Select
            id="worker"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
          >
            <option value="">{t("time_entries.all_workers", locale)}</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">{t("common.status", locale)}</Label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vineyard">{t("time_entries.vineyard", locale)}</Label>
          <Select
            id="vineyard"
            value={vineyardId}
            onChange={(e) => setVineyardId(e.target.value)}
          >
            <option value="">{t("time_entries.all_vineyards", locale)}</option>
            {vineyards.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartDate(today);
            setEndDate(today);
            setWorkerId("");
            setStatus("");
            setVineyardId("");
          }}
        >
          {t("common.reset_filters", locale)}
        </Button>
        {loading && <span className="text-sm text-muted-foreground">{t("common.loading", locale)}</span>}
      </div>

      <DataTable
        columns={columns}
        data={entries}
        emptyMessage={t("time_entries.no_entries", locale)}
      />
    </div>
  );
}
