"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecentEntriesTable } from "./recent-entries-table";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface EntryRow {
  id: string;
  date: string;
  hours: number;
  status: string;
  worker: { full_name: string } | null;
  vineyard: { name: string } | null;
  block: { name: string } | null;
  task: { name: string } | null;
  [key: string]: unknown;
}

interface UnconfirmedSummary {
  id: string;
  week_start: string;
  total_hours: number;
  total_pay: number;
  status: string;
  worker: { full_name: string } | null;
}

export default function DashboardPage() {
  const { locale } = useLocale();
  const supabase = createClient();

  const [totalWorkers, setTotalWorkers] = useState(0);
  const [todayEntries, setTodayEntries] = useState(0);
  const [pendingConfirmations, setPendingConfirmations] = useState(0);
  const [todayMessages, setTodayMessages] = useState(0);
  const [recentEntries, setRecentEntries] = useState<EntryRow[]>([]);
  const [unconfirmedSummaries, setUnconfirmedSummaries] = useState<UnconfirmedSummary[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      const today = new Date().toISOString().split("T")[0];

      const [
        { count: workersCount },
        { count: entriesCount },
        { count: pendingCount },
        { count: messagesCount },
        { data: entries },
      ] = await Promise.all([
        supabase
          .from("workers")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("time_entries")
          .select("*", { count: "exact", head: true })
          .eq("date", today),
        supabase
          .from("time_entries")
          .select("*", { count: "exact", head: true })
          .eq("status", "draft"),
        supabase
          .from("raw_messages")
          .select("*", { count: "exact", head: true })
          .gte("created_at", `${today}T00:00:00`)
          .lte("created_at", `${today}T23:59:59`),
        supabase
          .from("time_entries")
          .select("*, worker:workers(full_name), vineyard:vineyards(name), block:blocks(name), task:tasks(name)")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      // Fetch unconfirmed weekly summaries (pending or any non-confirmed status)
      const { data: unconfirmed } = await supabase
        .from("weekly_summaries")
        .select("id, week_start, total_hours, total_pay, status, worker:workers(full_name)")
        .in("status", ["pending"])
        .order("week_start", { ascending: false });

      setTotalWorkers(workersCount ?? 0);
      setTodayEntries(entriesCount ?? 0);
      setPendingConfirmations(pendingCount ?? 0);
      setTodayMessages(messagesCount ?? 0);
      setRecentEntries(entries ?? []);
      setUnconfirmedSummaries((unconfirmed ?? []) as unknown as UnconfirmedSummary[]);
    }
    loadDashboard();
  }, [supabase]);

  const cards = [
    { label: t("dashboard.total_workers", locale), value: totalWorkers },
    { label: t("dashboard.entries_today", locale), value: todayEntries },
    { label: t("dashboard.pending", locale), value: pendingConfirmations },
    { label: t("dashboard.messages_today", locale), value: todayMessages },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("dashboard.title", locale)}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {unconfirmedSummaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {locale === "es" ? "Resúmenes sin confirmar" : "Unconfirmed Summaries"}
              <Badge variant="warning" className="ml-2">{unconfirmedSummaries.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                      {t("time_entries.worker", locale)}
                    </th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                      {locale === "es" ? "Semana" : "Week"}
                    </th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                      {t("common.hours", locale)}
                    </th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                      {locale === "es" ? "Pago" : "Pay"}
                    </th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                      {t("common.status", locale)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unconfirmedSummaries.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-4 font-medium">{s.worker?.full_name ?? "-"}</td>
                      <td className="p-4">{s.week_start}</td>
                      <td className="p-4">{s.total_hours}h</td>
                      <td className="p-4">${s.total_pay?.toFixed(2) ?? "0.00"}</td>
                      <td className="p-4">
                        <Badge variant="warning">
                          {t(`status.${s.status}`, locale)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">{t("dashboard.recent_entries", locale)}</h2>
        <RecentEntriesTable data={recentEntries} />
      </div>
    </div>
  );
}
