"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeEntry {
  id: string;
  date: string;
  hours: number;
  worker: { id: string; full_name: string } | null;
  vineyard: { name: string } | null;
  task: { name: string; category: string | null } | null;
}

interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

interface WorkerUtilRow {
  name: string;
  weeksActive: number;
  totalHours: number;
  avgHoursPerWeek: number;
  daysWorked: number;
}

// ---------------------------------------------------------------------------
// Reusable BarChart component (pure CSS)
// ---------------------------------------------------------------------------

function BarChart({
  data,
  color,
  emptyMessage,
}: {
  data: BarChartItem[];
  color?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-32 text-sm text-right truncate" title={d.label}>
            {d.label}
          </span>
          <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
            <div
              className={`h-full rounded-full ${d.color ?? color ?? "bg-primary"}`}
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <span className="w-16 text-sm text-muted-foreground">
            {d.value.toFixed(1)}h
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the ISO week Monday date string for a given date. */
function getISOWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

function formatMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CATEGORY_COLORS: Record<string, string> = {
  canopy: "bg-green-500",
  pruning: "bg-amber-500",
  harvest: "bg-purple-500",
  irrigation: "bg-blue-500",
  spraying: "bg-red-500",
  mowing: "bg-lime-500",
  planting: "bg-teal-500",
  general: "bg-gray-500",
};

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] ?? "bg-primary";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const { locale } = useLocale();
  const supabase = createClient();

  // Default date range: last 4 weeks
  const defaultEnd = new Date().toISOString().split("T")[0];
  const defaultStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 27); // 4 weeks = 28 days, inclusive
    return d.toISOString().split("T")[0];
  })();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // -----------------------------------------------------------------------
  // Fetch time entries for the selected date range
  // -----------------------------------------------------------------------

  const fetchEntries = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("time_entries")
      .select(
        "id, date, hours, worker:workers(id, full_name), vineyard:vineyards(name), task:tasks(name, category)"
      )
      .order("date", { ascending: true });

    if (startDate) {
      query = query.gte("date", startDate);
    }
    if (endDate) {
      query = query.lte("date", endDate);
    }

    const { data } = await query;
    setEntries((data as TimeEntry[] | null) ?? []);
    setLoading(false);
  }, [supabase, startDate, endDate]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // -----------------------------------------------------------------------
  // Derived data for charts
  // -----------------------------------------------------------------------

  // Chart 1: Hours by Week
  const hoursByWeek: BarChartItem[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const monday = getISOWeekMonday(e.date);
      map.set(monday, (map.get(monday) ?? 0) + (e.hours ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monday, hours]) => ({
        label: `Wk of ${formatMonday(monday)}`,
        value: hours,
      }));
  }, [entries]);

  // Chart 2: Hours by Vineyard
  const hoursByVineyard: BarChartItem[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const name = e.vineyard?.name ?? "Unknown";
      map.set(name, (map.get(name) ?? 0) + (e.hours ?? 0));
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, hours]) => ({ label: name, value: hours }));
  }, [entries]);

  // Chart 3: Hours by Task Category
  const hoursByCategory: BarChartItem[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const cat = e.task?.category ?? "uncategorized";
      map.set(cat, (map.get(cat) ?? 0) + (e.hours ?? 0));
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([cat, hours]) => ({
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
        value: hours,
        color: categoryColor(cat),
      }));
  }, [entries]);

  // Chart 4: Worker Utilization
  const workerUtilization: WorkerUtilRow[] = useMemo(() => {
    const map = new Map<
      string,
      { name: string; weekSet: Set<string>; totalHours: number; daySet: Set<string> }
    >();
    for (const e of entries) {
      const wId = e.worker?.id ?? "unknown";
      const wName = e.worker?.full_name ?? "Unknown";
      if (!map.has(wId)) {
        map.set(wId, { name: wName, weekSet: new Set(), totalHours: 0, daySet: new Set() });
      }
      const rec = map.get(wId)!;
      rec.totalHours += e.hours ?? 0;
      rec.weekSet.add(getISOWeekMonday(e.date));
      rec.daySet.add(e.date);
    }
    return Array.from(map.values())
      .map((r) => ({
        name: r.name,
        weeksActive: r.weekSet.size,
        totalHours: r.totalHours,
        avgHoursPerWeek: r.weekSet.size > 0 ? r.totalHours / r.weekSet.size : 0,
        daysWorked: r.daySet.size,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [entries]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("analytics.title", locale)}</h1>

      {/* Date range filter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="analytics_start">{t("common.start_date", locale)}</Label>
          <Input
            id="analytics_start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="analytics_end">{t("common.end_date", locale)}</Label>
          <Input
            id="analytics_end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStartDate(defaultStart);
              setEndDate(defaultEnd);
            }}
          >
            {t("analytics.last_4_weeks", locale)}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t("analytics.loading", locale)}</p>
      )}

      {/* Chart 1: Hours by Week */}
      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.hours_by_week", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={hoursByWeek} color="bg-primary" emptyMessage={t("analytics.no_data_range", locale)} />
        </CardContent>
      </Card>

      {/* Chart 2: Hours by Vineyard */}
      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.hours_by_vineyard", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={hoursByVineyard} color="bg-primary" emptyMessage={t("analytics.no_data_range", locale)} />
        </CardContent>
      </Card>

      {/* Chart 3: Hours by Task Category */}
      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.hours_by_task", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={hoursByCategory} emptyMessage={t("analytics.no_data_range", locale)} />
          {/* Legend */}
          {hoursByCategory.length > 0 && (
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
              {hoursByCategory.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${item.color ?? "bg-primary"}`}
                  />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chart 4: Worker Utilization */}
      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.worker_utilization", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {workerUtilization.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("analytics.no_data_range", locale)}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium">{t("analytics.worker_col", locale)}</th>
                    <th className="pb-2 pr-4 font-medium text-right">{t("analytics.weeks_active", locale)}</th>
                    <th className="pb-2 pr-4 font-medium text-right">{t("analytics.total_hours", locale)}</th>
                    <th className="pb-2 pr-4 font-medium text-right">{t("analytics.avg_hours_week", locale)}</th>
                    <th className="pb-2 font-medium text-right">{t("analytics.days_worked", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {workerUtilization.map((row) => (
                    <tr key={row.name} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.name}</td>
                      <td className="py-2 pr-4 text-right">{row.weeksActive}</td>
                      <td className="py-2 pr-4 text-right">{row.totalHours.toFixed(1)}</td>
                      <td className="py-2 pr-4 text-right">{row.avgHoursPerWeek.toFixed(1)}</td>
                      <td className="py-2 text-right">{row.daysWorked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
