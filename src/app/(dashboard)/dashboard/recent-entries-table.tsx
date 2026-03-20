"use client";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
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

const statusVariant: Record<string, "warning" | "success" | "default" | "destructive" | "secondary"> = {
  draft: "warning",
  worker_confirmed: "success",
  supervisor_approved: "default",
  rejected: "destructive",
  edited: "secondary",
};

export function RecentEntriesTable({ data }: { data: EntryRow[] }) {
  const { locale } = useLocale();

  const columns = [
    { key: "date", header: t("common.date", locale) },
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
    { key: "hours", header: t("common.hours", locale) },
    {
      key: "status",
      header: t("common.status", locale),
      render: (row: EntryRow) => (
        <Badge variant={statusVariant[row.status] ?? "default"}>
          {row.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      emptyMessage={t("dashboard.no_entries", locale)}
    />
  );
}
