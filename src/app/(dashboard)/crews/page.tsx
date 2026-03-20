"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CrewsTable } from "./crews-table";
import { Button } from "@/components/ui/button";
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

export default function CrewsPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCrews() {
      const { data, error: fetchError } = await supabase
        .from("crews")
        .select("*, vineyards(name), blocks(name), workers(id)")
        .order("name");

      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setCrews(data ?? []);
    }
    loadCrews();
  }, [supabase]);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("crews.title", locale)}</h1>
        <p className="text-destructive">Failed to load crews: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("crews.title", locale)}</h1>
        <Link href="/crews/new">
          <Button>{t("crews.add", locale)}</Button>
        </Link>
      </div>
      <CrewsTable crews={crews} />
    </div>
  );
}
