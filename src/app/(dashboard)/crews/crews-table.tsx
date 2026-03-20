"use client";

import { useRouter } from "next/navigation";
import { DataTable } from "@/components/data-table";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface Crew {
  id: string;
  name: string;
  default_vineyard_id: string | null;
  default_block_id: string | null;
  vineyards: { name: string } | null;
  blocks: { name: string } | null;
  workers: { id: string }[];
  [key: string]: unknown;
}

export function CrewsTable({ crews }: { crews: Crew[] }) {
  const router = useRouter();
  const { locale } = useLocale();

  const columns = [
    {
      key: "name",
      header: t("crews.name", locale),
    },
    {
      key: "vineyard",
      header: t("crews.default_vineyard", locale),
      render: (row: Crew) => row.vineyards?.name ?? "\u2014",
    },
    {
      key: "block",
      header: t("crews.default_block", locale),
      render: (row: Crew) => row.blocks?.name ?? "\u2014",
    },
    {
      key: "worker_count",
      header: t("crews.worker_count", locale),
      render: (row: Crew) => row.workers?.length ?? 0,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={crews}
      onRowClick={(row) => router.push(`/crews/${row.id}`)}
      emptyMessage={t("crews.no_crews", locale)}
    />
  );
}
