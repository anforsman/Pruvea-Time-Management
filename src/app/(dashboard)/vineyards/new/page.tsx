"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";
import type { Database } from "@/types/database";

type VineyardInsert = Database["public"]["Tables"]["vineyards"]["Insert"];

export default function NewVineyardPage() {
  const router = useRouter();
  const supabase = createClient();
  const { locale } = useLocale();

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [totalAcres, setTotalAcres] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("vineyards.name_required", locale));
      return;
    }

    setSaving(true);
    setError(null);

    const row: VineyardInsert = {
      name: name.trim(),
      region: region.trim() || null,
      total_acres: totalAcres ? parseFloat(totalAcres) : null,
      owner_name: ownerName.trim() || null,
    };

    const { data, error: insertError } = await supabase
      .from("vineyards")
      .insert(row as never)
      .select()
      .single();

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const result = data as { id: string } | null;
    if (result) {
      router.push(`/vineyards/${result.id}`);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t("vineyards.new", locale)}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("vineyards.details", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("common.name_required", locale)}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Silverado Ranch"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">{t("vineyards.region", locale)}</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. Napa Valley"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="total_acres">{t("vineyards.total_acres", locale)}</Label>
              <Input
                id="total_acres"
                type="number"
                step="0.01"
                min="0"
                value={totalAcres}
                onChange={(e) => setTotalAcres(e.target.value)}
                placeholder="e.g. 120.5"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner_name">{t("vineyards.owner", locale)}</Label>
              <Input
                id="owner_name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? t("vineyards.creating", locale) : t("vineyards.create", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/vineyards")}
              >
                {t("common.cancel", locale)}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
