"use client";

import { useRouter } from "next/navigation";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface Worker {
  id: string;
  full_name: string;
  phone: string | null;
  type: "standard" | "elevated";
  crew_id: string | null;
  hourly_rate: number | null;
  language: "en" | "es";
  is_active: boolean;
  crews: { name: string } | null;
  supervisor: { full_name: string } | null;
  [key: string]: unknown;
}

export function WorkersTable({ workers }: { workers: Worker[] }) {
  const router = useRouter();
  const { locale } = useLocale();

  const columns = [
    {
      key: "full_name",
      header: t("common.name", locale),
    },
    {
      key: "phone",
      header: t("workers.phone", locale),
    },
    {
      key: "crew",
      header: t("workers.crew", locale),
      render: (row: Worker) => row.crews?.name ?? "\u2014",
    },
    {
      key: "hourly_rate",
      header: t("workers.rate", locale),
      render: (row: Worker) =>
        row.hourly_rate != null ? `$${row.hourly_rate.toFixed(2)}` : "\u2014",
    },
    {
      key: "supervisor",
      header: t("workers.supervisor", locale),
      render: (row: Worker) => row.supervisor?.full_name ?? "\u2014",
    },
    {
      key: "language",
      header: t("workers.language", locale),
      render: (row: Worker) => (row.language === "en" ? "EN" : "ES"),
    },
    {
      key: "is_active",
      header: t("workers.status", locale),
      render: (row: Worker) => (
        <Badge variant={row.is_active ? "success" : "secondary"}>
          {row.is_active ? t("common.active", locale) : t("common.inactive", locale)}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={workers}
      onRowClick={(row) => router.push(`/workers/${row.id}`)}
      emptyMessage={t("workers.no_workers", locale)}
    />
  );
}
