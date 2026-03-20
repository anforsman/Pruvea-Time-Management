"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { WorkersTable } from "./workers-table";
import { Button } from "@/components/ui/button";
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

export default function WorkersPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadWorkers() {
      const { data, error: fetchError } = await supabase
        .from("workers")
        .select("*, crews(name), supervisor:workers!reports_to(full_name)")
        .order("full_name");

      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setWorkers(data ?? []);
    }
    loadWorkers();
  }, [supabase]);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("workers.title", locale)}</h1>
        <p className="text-destructive">Failed to load workers: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("workers.title", locale)}</h1>
        <Link href="/workers/new">
          <Button>{t("workers.add", locale)}</Button>
        </Link>
      </div>
      <WorkersTable workers={workers} />
    </div>
  );
}
