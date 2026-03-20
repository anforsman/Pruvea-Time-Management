"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface Vineyard {
  id: string;
  name: string;
}

interface Block {
  id: string;
  vineyard_id: string;
  name: string;
}

export default function NewCrewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { locale } = useLocale();

  const [vineyards, setVineyards] = useState<Vineyard[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [vineyardId, setVineyardId] = useState("");
  const [blockId, setBlockId] = useState("");

  useEffect(() => {
    async function loadVineyards() {
      const { data } = await supabase.from("vineyards").select("id, name").order("name");
      if (data) setVineyards(data);
    }
    loadVineyards();
  }, [supabase]);

  useEffect(() => {
    async function loadBlocks() {
      if (!vineyardId) {
        setBlocks([]);
        setBlockId("");
        return;
      }
      const { data } = await supabase
        .from("blocks")
        .select("id, vineyard_id, name")
        .eq("vineyard_id", vineyardId)
        .order("name");
      if (data) setBlocks(data);
      setBlockId("");
    }
    loadBlocks();
  }, [vineyardId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: insertError } = await supabase.from("crews").insert({
      name: name.trim(),
      default_vineyard_id: vineyardId || null,
      default_block_id: blockId || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.push("/crews");
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("crews.add", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">{t("crews.name", locale)} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Enter crew name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vineyard_id">{t("crews.default_vineyard", locale)}</Label>
              <Select
                id="vineyard_id"
                value={vineyardId}
                onChange={(e) => setVineyardId(e.target.value)}
              >
                <option value="">{t("common.none", locale)}</option>
                {vineyards.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="block_id">{t("crews.default_block", locale)}</Label>
              <Select
                id="block_id"
                value={blockId}
                onChange={(e) => setBlockId(e.target.value)}
                disabled={!vineyardId}
              >
                <option value="">{t("common.none", locale)}</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              {!vineyardId && (
                <p className="text-xs text-muted-foreground">
                  {t("crews.select_vineyard", locale)}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading}>
                {loading ? t("common.saving", locale) : t("crews.create", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/crews")}
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
