"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface VineyardRow {
  id: string;
  name: string;
  region: string | null;
  total_acres: number | null;
  owner_name: string | null;
  blocks: { id: string }[] | null;
  [key: string]: unknown;
}

export function VineyardsTable({ data }: { data: VineyardRow[] }) {
  const { locale } = useLocale();

  const columns = [
    {
      key: "name",
      header: t("vineyards.name", locale),
      render: (row: VineyardRow) => (
        <Link href={`/vineyards/${row.id}`} className="text-primary hover:underline font-medium">
          {row.name}
        </Link>
      ),
    },
    {
      key: "region",
      header: t("vineyards.region", locale),
      render: (row: VineyardRow) => row.region ?? "-",
    },
    {
      key: "total_acres",
      header: t("vineyards.total_acres", locale),
      render: (row: VineyardRow) => row.total_acres != null ? String(row.total_acres) : "-",
    },
    {
      key: "owner_name",
      header: t("vineyards.owner", locale),
      render: (row: VineyardRow) => row.owner_name ?? "-",
    },
    {
      key: "blocks",
      header: t("vineyards.blocks", locale),
      render: (row: VineyardRow) => String(row.blocks?.length ?? 0),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      emptyMessage={t("vineyards.no_vineyards", locale)}
    />
  );
}
