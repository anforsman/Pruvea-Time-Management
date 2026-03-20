"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";
import type { Database } from "@/types/database";

type Vineyard = Database["public"]["Tables"]["vineyards"]["Row"];
type Block = Database["public"]["Tables"]["blocks"]["Row"];
type BlockInsert = Database["public"]["Tables"]["blocks"]["Insert"];
type BlockUpdate = Database["public"]["Tables"]["blocks"]["Update"];
type VineyardUpdate = Database["public"]["Tables"]["vineyards"]["Update"];

interface BlockRow extends Block {
  [key: string]: unknown;
}

export default function VineyardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const vineyardId = params.id as string;
  const { locale } = useLocale();

  // Vineyard state
  const [vineyard, setVineyard] = useState<Vineyard | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [totalAcres, setTotalAcres] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Blocks state
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [blockName, setBlockName] = useState("");
  const [blockAliases, setBlockAliases] = useState("");
  const [blockVarietal, setBlockVarietal] = useState("");
  const [blockAcreage, setBlockAcreage] = useState("");
  const [blockRowRange, setBlockRowRange] = useState("");
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const fetchVineyard = useCallback(async () => {
    const { data } = await supabase
      .from("vineyards")
      .select("*")
      .eq("id", vineyardId)
      .single();

    const v = data as Vineyard | null;
    if (v) {
      setVineyard(v);
      setName(v.name);
      setRegion(v.region ?? "");
      setTotalAcres(v.total_acres != null ? String(v.total_acres) : "");
      setOwnerName(v.owner_name ?? "");
    }
  }, [supabase, vineyardId]);

  const fetchBlocks = useCallback(async () => {
    const { data } = await supabase
      .from("blocks")
      .select("*")
      .eq("vineyard_id", vineyardId)
      .order("name");

    setBlocks((data as Block[] | null) ?? []);
  }, [supabase, vineyardId]);

  useEffect(() => {
    async function load() {
      await Promise.all([fetchVineyard(), fetchBlocks()]);
      setLoading(false);
    }
    load();
  }, [fetchVineyard, fetchBlocks]);

  async function handleSaveVineyard(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("vineyards.name_required", locale));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const update: VineyardUpdate = {
      name: name.trim(),
      region: region.trim() || null,
      total_acres: totalAcres ? parseFloat(totalAcres) : null,
      owner_name: ownerName.trim() || null,
    };

    const { error: updateError } = await supabase
      .from("vineyards")
      .update(update as never)
      .eq("id", vineyardId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(t("vineyards.updated", locale));
      setTimeout(() => setSuccess(null), 3000);
    }
  }

  function openAddBlock() {
    setEditingBlock(null);
    setBlockName("");
    setBlockAliases("");
    setBlockVarietal("");
    setBlockAcreage("");
    setBlockRowRange("");
    setBlockError(null);
    setBlockDialogOpen(true);
  }

  function openEditBlock(block: Block) {
    setEditingBlock(block);
    setBlockName(block.name);
    setBlockAliases(block.aliases?.join(", ") ?? "");
    setBlockVarietal(block.varietal ?? "");
    setBlockAcreage(block.acreage != null ? String(block.acreage) : "");
    setBlockRowRange(block.row_range ?? "");
    setBlockError(null);
    setBlockDialogOpen(true);
  }

  async function handleSaveBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!blockName.trim()) {
      setBlockError(t("vineyards.block_name_required", locale));
      return;
    }

    setBlockSaving(true);
    setBlockError(null);

    const aliases = blockAliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (editingBlock) {
      const update: BlockUpdate = {
        vineyard_id: vineyardId,
        name: blockName.trim(),
        aliases,
        varietal: blockVarietal.trim() || null,
        acreage: blockAcreage ? parseFloat(blockAcreage) : null,
        row_range: blockRowRange.trim() || null,
      };

      const { error } = await supabase
        .from("blocks")
        .update(update as never)
        .eq("id", editingBlock.id);

      if (error) {
        setBlockError(error.message);
        setBlockSaving(false);
        return;
      }
    } else {
      const insert: BlockInsert = {
        vineyard_id: vineyardId,
        name: blockName.trim(),
        aliases,
        varietal: blockVarietal.trim() || null,
        acreage: blockAcreage ? parseFloat(blockAcreage) : null,
        row_range: blockRowRange.trim() || null,
      };

      const { error } = await supabase.from("blocks").insert(insert as never);

      if (error) {
        setBlockError(error.message);
        setBlockSaving(false);
        return;
      }
    }

    setBlockSaving(false);
    setBlockDialogOpen(false);
    fetchBlocks();
  }

  async function handleDeleteBlock(blockId: string) {
    if (!confirm(t("vineyards.delete_block_confirm", locale))) return;

    await supabase.from("blocks").delete().eq("id", blockId);
    fetchBlocks();
  }

  if (loading) {
    return <div className="text-muted-foreground">{t("common.loading", locale)}</div>;
  }

  if (!vineyard) {
    return <div className="text-muted-foreground">{t("vineyards.not_found", locale)}</div>;
  }

  const blockColumns = [
    {
      key: "name",
      header: t("vineyards.name", locale),
    },
    {
      key: "aliases",
      header: t("vineyards.aliases", locale),
      render: (row: BlockRow) =>
        row.aliases?.length ? (
          <div className="flex flex-wrap gap-1">
            {row.aliases.map((alias) => (
              <Badge key={alias} variant="secondary">
                {alias}
              </Badge>
            ))}
          </div>
        ) : (
          "-"
        ),
    },
    {
      key: "varietal",
      header: t("vineyards.varietal", locale),
      render: (row: BlockRow) => row.varietal ?? "-",
    },
    {
      key: "acreage",
      header: t("vineyards.acreage", locale),
      render: (row: BlockRow) => (row.acreage != null ? String(row.acreage) : "-"),
    },
    {
      key: "row_range",
      header: t("vineyards.row_range", locale),
      render: (row: BlockRow) => row.row_range ?? "-",
    },
    {
      key: "actions",
      header: "",
      className: "w-[120px]",
      render: (row: BlockRow) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEditBlock(row)}>
            {t("common.edit", locale)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => handleDeleteBlock(row.id)}
          >
            {t("common.delete", locale)}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/vineyards")}>
          &larr; {t("common.back", locale)}
        </Button>
        <h1 className="text-2xl font-bold">{t("vineyards.edit", locale)}</h1>
      </div>

      {/* Vineyard Details */}
      <Card>
        <CardHeader>
          <CardTitle>{t("vineyards.details", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveVineyard} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("common.name_required", locale)}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="region">{t("vineyards.region", locale)}</Label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
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
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner_name">{t("vineyards.owner", locale)}</Label>
              <Input
                id="owner_name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}

            <Button type="submit" disabled={saving}>
              {saving ? t("common.saving", locale) : t("common.save_changes", locale)}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Blocks */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("vineyards.blocks_title", locale)}</CardTitle>
          <Button size="sm" onClick={openAddBlock}>
            {t("vineyards.add_block", locale)}
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={blockColumns}
            data={blocks as BlockRow[]}
            emptyMessage={t("vineyards.no_blocks", locale)}
          />
        </CardContent>
      </Card>

      {/* Block Dialog */}
      <Dialog open={blockDialogOpen} onClose={() => setBlockDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>{editingBlock ? t("vineyards.edit_block", locale) : t("vineyards.add_block", locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSaveBlock} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="block_name">{t("common.name_required", locale)}</Label>
            <Input
              id="block_name"
              value={blockName}
              onChange={(e) => setBlockName(e.target.value)}
              placeholder="e.g. Block A"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="block_aliases">{t("vineyards.aliases_comma", locale)}</Label>
            <Input
              id="block_aliases"
              value={blockAliases}
              onChange={(e) => setBlockAliases(e.target.value)}
              placeholder="e.g. North Block, A1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="block_varietal">{t("vineyards.varietal", locale)}</Label>
            <Input
              id="block_varietal"
              value={blockVarietal}
              onChange={(e) => setBlockVarietal(e.target.value)}
              placeholder="e.g. Cabernet Sauvignon"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="block_acreage">{t("vineyards.acreage", locale)}</Label>
              <Input
                id="block_acreage"
                type="number"
                step="0.01"
                min="0"
                value={blockAcreage}
                onChange={(e) => setBlockAcreage(e.target.value)}
                placeholder="e.g. 15.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="block_row_range">{t("vineyards.row_range", locale)}</Label>
              <Input
                id="block_row_range"
                value={blockRowRange}
                onChange={(e) => setBlockRowRange(e.target.value)}
                placeholder="e.g. 1-50"
              />
            </div>
          </div>

          {blockError && <p className="text-sm text-destructive">{blockError}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={blockSaving}>
              {blockSaving ? t("common.saving", locale) : editingBlock ? t("vineyards.update_block", locale) : t("vineyards.add_block", locale)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockDialogOpen(false)}
            >
              {t("common.cancel", locale)}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
