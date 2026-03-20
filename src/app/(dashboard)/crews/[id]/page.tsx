"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

interface CrewWorker {
  id: string;
  full_name: string;
  phone: string | null;
  type: "standard" | "elevated";
  is_active: boolean;
}

export default function EditCrewPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  const { locale } = useLocale();

  const [vineyards, setVineyards] = useState<Vineyard[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [workers, setWorkers] = useState<CrewWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState("");
  const [vineyardId, setVineyardId] = useState("");
  const [blockId, setBlockId] = useState("");

  useEffect(() => {
    async function load() {
      const [crewRes, vineyardsRes, workersRes] = await Promise.all([
        supabase.from("crews").select("*").eq("id", id).single(),
        supabase.from("vineyards").select("id, name").order("name"),
        supabase
          .from("workers")
          .select("id, full_name, phone, type, is_active")
          .eq("crew_id", id)
          .order("full_name"),
      ]);

      if (crewRes.error) {
        setError(t("crews.not_found", locale));
        setLoading(false);
        return;
      }

      const c = crewRes.data;
      setName(c.name);
      setVineyardId(c.default_vineyard_id ?? "");
      setBlockId(c.default_block_id ?? "");

      if (vineyardsRes.data) setVineyards(vineyardsRes.data);
      if (workersRes.data) setWorkers(workersRes.data);

      // Load blocks for the current vineyard
      if (c.default_vineyard_id) {
        const { data: blocksData } = await supabase
          .from("blocks")
          .select("id, vineyard_id, name")
          .eq("vineyard_id", c.default_vineyard_id)
          .order("name");
        if (blocksData) setBlocks(blocksData);
      }

      setLoading(false);
    }
    load();
  }, [id, supabase, locale]);

  useEffect(() => {
    // Reload blocks when vineyard changes (but skip the initial load)
    if (loading) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vineyardId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { error: updateError } = await supabase
      .from("crews")
      .update({
        name: name.trim(),
        default_vineyard_id: vineyardId || null,
        default_block_id: blockId || null,
      })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.push("/crews");
  }

  async function handleDelete() {
    setSaving(true);
    const { error: deleteError } = await supabase
      .from("crews")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      setConfirmDelete(false);
      return;
    }

    router.push("/crews");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("crews.loading", locale)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("crews.edit", locale)}</CardTitle>
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
              <Button type="submit" disabled={saving}>
                {saving ? t("common.saving", locale) : t("common.save_changes", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/crews")}
              >
                {t("common.cancel", locale)}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                className="ml-auto"
              >
                {t("common.delete", locale)}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Workers in this crew */}
      <Card>
        <CardHeader>
          <CardTitle>{t("crews.members", locale)} ({workers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("crews.no_members", locale)}</p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("common.name", locale)}</th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("workers.phone", locale)}</th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("workers.type", locale)}</th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("common.status", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-b">
                      <td className="p-4">{w.full_name}</td>
                      <td className="p-4">{w.phone ?? "\u2014"}</td>
                      <td className="p-4 capitalize">{w.type === "elevated" ? t("workers.type.elevated", locale) : t("workers.type.standard", locale)}</td>
                      <td className="p-4">{w.is_active ? t("common.active", locale) : t("common.inactive", locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogHeader>
          <DialogTitle>{t("crews.delete_title", locale)}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          {t("crews.delete_confirm", locale)} <strong>{name}</strong>? {t("crews.delete_warning", locale)}
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            {t("common.cancel", locale)}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={saving}>
            {saving ? t("common.deleting", locale) : t("common.delete", locale)}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
