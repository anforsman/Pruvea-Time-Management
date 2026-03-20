"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

const severityVariant: Record<string, "destructive" | "warning" | "secondary"> = {
  critical: "destructive",
  warning: "warning",
  info: "secondary",
};

interface AnomalyRow {
  id: string;
  date: string;
  type: string;
  severity: string;
  description: string;
  resolved: boolean;
  crew: { name: string } | null;
  worker: { full_name: string } | null;
  context: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
}

export default function AnomaliesPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [showResolved, setShowResolved] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const typeLabels: Record<string, string> = {
    hours_variance: t("anomalies.hours_variance", locale),
    block_mismatch: t("anomalies.block_mismatch", locale),
    excessive_hours: t("anomalies.excessive_hours", locale),
  };

  const columns = [
    {
      key: "date",
      header: t("common.date", locale),
    },
    {
      key: "severity",
      header: t("anomalies.severity", locale),
      render: (row: AnomalyRow) => (
        <Badge variant={severityVariant[row.severity] ?? "secondary"}>
          {row.severity}
        </Badge>
      ),
    },
    {
      key: "type",
      header: t("anomalies.type", locale),
      render: (row: AnomalyRow) => typeLabels[row.type] ?? row.type,
    },
    {
      key: "crew",
      header: t("anomalies.crew", locale),
      render: (row: AnomalyRow) => row.crew?.name ?? "-",
    },
    {
      key: "worker",
      header: t("anomalies.worker", locale),
      render: (row: AnomalyRow) => row.worker?.full_name ?? "-",
    },
    {
      key: "description",
      header: t("anomalies.description", locale),
    },
    {
      key: "resolved",
      header: t("common.status", locale),
      render: (row: AnomalyRow) => (
        <Badge variant={row.resolved ? "success" : "warning"}>
          {row.resolved ? t("common.resolved", locale) : t("common.open", locale)}
        </Badge>
      ),
    },
  ];

  const fetchAnomalies = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("anomalies")
      .select("*, crew:crews(name), worker:workers(full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!showResolved) {
      query = query.eq("resolved", false);
    }
    if (typeFilter) {
      query = query.eq("type", typeFilter);
    }
    if (startDate) {
      query = query.gte("date", startDate);
    }
    if (endDate) {
      query = query.lte("date", endDate);
    }

    const { data } = await query;
    setAnomalies((data ?? []) as AnomalyRow[]);
    setLoading(false);
  }, [supabase, showResolved, typeFilter, startDate, endDate]);

  useEffect(() => {
    fetchAnomalies();
  }, [fetchAnomalies]);

  async function resolveAnomaly(id: string) {
    await supabase
      .from("anomalies")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", id);
    fetchAnomalies();
  }

  const columnsWithActions = [
    ...columns,
    {
      key: "actions",
      header: "",
      render: (row: AnomalyRow) =>
        !row.resolved ? (
          <Button size="sm" variant="outline" onClick={() => resolveAnomaly(row.id)}>
            {t("common.resolve", locale)}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("anomalies.title", locale)}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("anomalies.subtitle", locale)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="type">{t("anomalies.type", locale)}</Label>
          <Select id="type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{t("anomalies.all_types", locale)}</option>
            <option value="hours_variance">{t("anomalies.hours_variance", locale)}</option>
            <option value="block_mismatch">{t("anomalies.block_mismatch", locale)}</option>
            <option value="excessive_hours">{t("anomalies.excessive_hours", locale)}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="start">{t("common.start_date", locale)}</Label>
          <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end">{t("common.end_date", locale)}</Label>
          <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>&nbsp;</Label>
          <div className="flex items-center gap-2 h-9">
            <input
              type="checkbox"
              id="show_resolved"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="show_resolved">{t("anomalies.show_resolved", locale)}</Label>
          </div>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t("common.loading", locale)}</p>}

      <DataTable
        columns={columnsWithActions}
        data={anomalies}
        emptyMessage={t("anomalies.no_anomalies", locale)}
      />
    </div>
  );
}
