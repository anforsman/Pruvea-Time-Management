"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { VineyardsTable } from "./vineyards-table";
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

export default function VineyardsPage() {
  const { locale } = useLocale();
  const [vineyards, setVineyards] = useState<VineyardRow[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("vineyards")
        .select("*, blocks(id)")
        .order("name");

      setVineyards((data as VineyardRow[] | null) ?? []);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("vineyards.title", locale)}</h1>
        <Link href="/vineyards/new">
          <Button>{t("vineyards.add", locale)}</Button>
        </Link>
      </div>

      <VineyardsTable data={vineyards} />
    </div>
  );
}
