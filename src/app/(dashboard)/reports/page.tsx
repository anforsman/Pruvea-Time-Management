"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable } from "@/components/data-table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeEntryRow {
  id: string;
  date: string;
  hours: number;
  worker_id: string;
  vineyard_id: string | null;
  block_id: string | null;
  task_id: string | null;
  worker: { full_name: string; hourly_rate: number | null; type: string } | null;
  vineyard: { name: string } | null;
  block: { name: string; acreage: number | null; varietal: string | null } | null;
  task: { name: string; category: string | null } | null;
  [key: string]: unknown;
}

interface VineyardOption {
  id: string;
  name: string;
}

type GroupBy = "vineyard" | "block" | "task" | "worker";

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

interface AggRow extends Record<string, unknown> {
  label: string;
  label2?: string;
  label3?: string;
  acreage?: number;
  hours: number;
  cost: number;
  costPerAcre?: number;
  avgHoursPerDay?: number;
  type?: string;
  vineyardId?: string;
}

function aggregate(entries: TimeEntryRow[], groupBy: GroupBy): AggRow[] {
  const map = new Map<
    string,
    {
      label: string;
      label2: string;
      label3: string;
      hours: number;
      cost: number;
      acreage: number;
      type: string;
      vineyardId: string;
      days: Set<string>;
    }
  >();

  for (const e of entries) {
    const rate = e.worker?.hourly_rate ?? 0;
    const cost = e.hours * rate;
    let key: string;
    let label = "";
    let label2 = "";
    let label3 = "";
    let acreage = 0;
    let type = "";
    let vineyardId = "";

    switch (groupBy) {
      case "vineyard":
        key = e.vineyard_id ?? "unknown";
        label = e.vineyard?.name ?? "Unknown";
        acreage = e.block?.acreage ?? 0;
        vineyardId = e.vineyard_id ?? "";
        break;
      case "block":
        key = e.block_id ?? "unknown";
        label = e.vineyard?.name ?? "Unknown";
        label2 = e.block?.name ?? "Unknown";
        label3 = e.block?.varietal ?? "-";
        acreage = e.block?.acreage ?? 0;
        vineyardId = e.vineyard_id ?? "";
        break;
      case "task":
        key = e.task_id ?? "unknown";
        label = e.task?.name ?? "Unknown";
        label2 = e.task?.category ?? "-";
        break;
      case "worker":
        key = e.worker_id;
        label = e.worker?.full_name ?? "Unknown";
        type = e.worker?.type ?? "standard";
        break;
    }

    const existing = map.get(key);
    if (existing) {
      existing.hours += e.hours;
      existing.cost += cost;
      // For vineyard grouping, accumulate unique block acreages
      if (groupBy === "vineyard") {
        // We track acreage per block separately below
      }
      existing.days.add(e.date);
    } else {
      map.set(key, {
        label,
        label2,
        label3,
        hours: e.hours,
        cost,
        acreage,
        type,
        vineyardId,
        days: new Set([e.date]),
      });
    }
  }

  // For vineyard grouping, compute acreage as sum of unique block acreages
  if (groupBy === "vineyard") {
    const vineyardBlockAcreage = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const vid = e.vineyard_id ?? "unknown";
      const bid = e.block_id ?? "unknown";
      if (!vineyardBlockAcreage.has(vid)) vineyardBlockAcreage.set(vid, new Map());
      const blockMap = vineyardBlockAcreage.get(vid)!;
      if (!blockMap.has(bid)) {
        blockMap.set(bid, e.block?.acreage ?? 0);
      }
    }
    for (const [vid, entry] of map) {
      if (groupBy === "vineyard") {
        const blockMap = vineyardBlockAcreage.get(vid);
        if (blockMap) {
          let totalAcreage = 0;
          for (const a of blockMap.values()) totalAcreage += a;
          entry.acreage = totalAcreage;
        }
      }
    }
  }

  const rows: AggRow[] = [];
  for (const [, v] of map) {
    const row: AggRow = {
      label: v.label,
      hours: Math.round(v.hours * 100) / 100,
      cost: Math.round(v.cost * 100) / 100,
    };
    if (groupBy === "block") {
      row.label2 = v.label2;
      row.label3 = v.label3;
      row.acreage = v.acreage;
      row.costPerAcre = v.acreage > 0 ? Math.round((v.cost / v.acreage) * 100) / 100 : 0;
    }
    if (groupBy === "vineyard") {
      row.acreage = v.acreage;
      row.costPerAcre = v.acreage > 0 ? Math.round((v.cost / v.acreage) * 100) / 100 : 0;
      row.vineyardId = v.vineyardId;
    }
    if (groupBy === "task") {
      row.label2 = v.label2;
    }
    if (groupBy === "worker") {
      row.type = v.type;
      row.avgHoursPerDay = v.days.size > 0 ? Math.round((v.hours / v.days.size) * 100) / 100 : 0;
    }
    rows.push(row);
  }

  rows.sort((a, b) => b.cost - a.cost);
  return rows;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: AggRow[], groupBy: GroupBy) {
  let header: string;
  let rowMapper: (r: AggRow) => string;

  switch (groupBy) {
    case "vineyard":
      header = "Vineyard,Hours,Cost,Cost/Acre";
      rowMapper = (r) => `"${r.label}",${r.hours},${r.cost},${r.costPerAcre ?? 0}`;
      break;
    case "block":
      header = "Vineyard,Block,Varietal,Acreage,Hours,Cost,Cost/Acre";
      rowMapper = (r) =>
        `"${r.label}","${r.label2 ?? ""}","${r.label3 ?? ""}",${r.acreage ?? 0},${r.hours},${r.cost},${r.costPerAcre ?? 0}`;
      break;
    case "task":
      header = "Task,Category,Hours,Cost";
      rowMapper = (r) => `"${r.label}","${r.label2 ?? ""}",${r.hours},${r.cost}`;
      break;
    case "worker":
      header = "Worker,Type,Hours,Cost,Avg Hours/Day";
      rowMapper = (r) =>
        `"${r.label}","${r.type ?? ""}",${r.hours},${r.cost},${r.avgHoursPerDay ?? 0}`;
      break;
  }

  const csv = [header, ...rows.map(rowMapper)].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cost-allocation-${groupBy}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function CostAllocationReportPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [entries, setEntries] = useState<TimeEntryRow[]>([]);
  const [vineyards, setVineyards] = useState<VineyardOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [vineyardId, setVineyardId] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("vineyard");

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchEntries = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("time_entries")
      .select(
        "id, date, hours, worker_id, vineyard_id, block_id, task_id, worker:workers(full_name, hourly_rate, type), vineyard:vineyards(name), block:blocks(name, acreage, varietal), task:tasks(name, category)"
      )
      .order("date", { ascending: false });

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);
    if (vineyardId) query = query.eq("vineyard_id", vineyardId);

    const { data } = await query;
    setEntries((data as TimeEntryRow[] | null) ?? []);
    setLoading(false);
  }, [supabase, startDate, endDate, vineyardId]);

  useEffect(() => {
    async function loadVineyards() {
      const { data } = await supabase.from("vineyards").select("id, name").order("name");
      setVineyards((data as VineyardOption[] | null) ?? []);
    }
    loadVineyards();
  }, [supabase]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // -----------------------------------------------------------------------
  // Aggregated data
  // -----------------------------------------------------------------------

  const aggRows = useMemo(() => aggregate(entries, groupBy), [entries, groupBy]);

  const totalHours = useMemo(
    () => Math.round(entries.reduce((sum, e) => sum + e.hours, 0) * 100) / 100,
    [entries]
  );

  const totalCost = useMemo(
    () =>
      Math.round(
        entries.reduce((sum, e) => sum + e.hours * (e.worker?.hourly_rate ?? 0), 0) * 100
      ) / 100,
    [entries]
  );

  const avgCostPerHour = useMemo(
    () => (totalHours > 0 ? Math.round((totalCost / totalHours) * 100) / 100 : 0),
    [totalCost, totalHours]
  );

  // -----------------------------------------------------------------------
  // Columns per group-by dimension
  // -----------------------------------------------------------------------

  const columns = useMemo(() => {
    switch (groupBy) {
      case "vineyard":
        return [
          { key: "label", header: t("reports.vineyard_col", locale) },
          { key: "hours", header: t("reports.hours_col", locale) },
          {
            key: "cost",
            header: t("reports.cost", locale),
            render: (r: AggRow) => `$${r.cost.toFixed(2)}`,
          },
          {
            key: "costPerAcre",
            header: t("reports.cost_per_acre", locale),
            render: (r: AggRow) => (r.costPerAcre != null ? `$${r.costPerAcre.toFixed(2)}` : "-"),
          },
        ];
      case "block":
        return [
          { key: "label", header: t("reports.vineyard_col", locale) },
          { key: "label2", header: t("reports.block_col", locale) },
          { key: "label3", header: t("reports.varietal_col", locale) },
          { key: "acreage", header: t("reports.acreage_col", locale) },
          { key: "hours", header: t("reports.hours_col", locale) },
          {
            key: "cost",
            header: t("reports.cost", locale),
            render: (r: AggRow) => `$${r.cost.toFixed(2)}`,
          },
          {
            key: "costPerAcre",
            header: t("reports.cost_per_acre", locale),
            render: (r: AggRow) => (r.costPerAcre != null ? `$${r.costPerAcre.toFixed(2)}` : "-"),
          },
        ];
      case "task":
        return [
          { key: "label", header: t("reports.task_col", locale) },
          { key: "label2", header: t("reports.category", locale) },
          { key: "hours", header: t("reports.hours_col", locale) },
          {
            key: "cost",
            header: t("reports.cost", locale),
            render: (r: AggRow) => `$${r.cost.toFixed(2)}`,
          },
        ];
      case "worker":
        return [
          { key: "label", header: t("reports.worker_col", locale) },
          { key: "type", header: t("reports.type_col", locale) },
          { key: "hours", header: t("reports.hours_col", locale) },
          {
            key: "cost",
            header: t("reports.cost", locale),
            render: (r: AggRow) => `$${r.cost.toFixed(2)}`,
          },
          { key: "avgHoursPerDay", header: t("reports.avg_hours_day", locale) },
        ];
    }
  }, [groupBy, locale]);

  // -----------------------------------------------------------------------
  // Click handler: vineyard row -> set vineyard filter
  // -----------------------------------------------------------------------

  function handleRowClick(row: AggRow) {
    if (groupBy === "vineyard" && row.vineyardId) {
      setVineyardId(row.vineyardId as string);
      setGroupBy("block");
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("reports.title", locale)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("reports.subtitle", locale)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/reports/leases">
            <Button variant="outline" size="sm">
              {t("reports.lease_cost_sharing", locale)}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCSV(aggRows, groupBy)}
            disabled={aggRows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {t("common.export_csv", locale)}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-lg border bg-muted/30">
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

        <div className="space-y-1.5">
          <Label htmlFor="group_by">{t("reports.group_by", locale)}</Label>
          <Select
            id="group_by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="vineyard">{t("reports.vineyard_option", locale)}</option>
            <option value="block">{t("reports.block_option", locale)}</option>
            <option value="task">{t("reports.task_option", locale)}</option>
            <option value="worker">{t("reports.worker_option", locale)}</option>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartDate(thirtyDaysAgo);
            setEndDate(today);
            setVineyardId("");
            setGroupBy("vineyard");
          }}
        >
          {t("common.reset_filters", locale)}
        </Button>
        {loading && <span className="text-sm text-muted-foreground">{t("common.loading", locale)}</span>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("reports.total_hours", locale)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalHours}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("reports.total_cost", locale)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalCost.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("reports.avg_cost_hour", locale)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${avgCostPerHour.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Data table */}
      <DataTable
        columns={columns}
        data={aggRows}
        onRowClick={groupBy === "vineyard" ? handleRowClick : undefined}
        emptyMessage={t("reports.no_data", locale)}
      />
    </div>
  );
}
