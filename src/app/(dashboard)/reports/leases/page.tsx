"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaseAgreement {
  id: string;
  lessee_name: string;
  vineyard_id: string;
  cost_share_formula: {
    type: string;
    lessee_share?: number;
    owner_share?: number;
    per_acre_hour_rate?: number;
  } | null;
  vineyard: { name: string }[] | { name: string } | null;
}

interface Block {
  id: string;
  name: string;
  acreage: number | null;
  lease_agreement_id: string | null;
}

interface TimeEntry {
  id: string;
  hours: number;
  block_id: string | null;
  worker: { hourly_rate: number | null } | null;
}

interface BlockDetail {
  blockName: string;
  acreage: number;
  hours: number;
  cost: number;
  lesseeShare: number;
  ownerShare: number;
}

interface LeaseRow {
  leaseId: string;
  leaseName: string;
  lessee: string;
  blocks: string;
  totalHours: number;
  totalCost: number;
  lesseeShare: number;
  ownerShare: number;
  blockDetails: BlockDetail[];
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function LeaseCostSharingPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [leaseRows, setLeaseRows] = useState<LeaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLeases, setExpandedLeases] = useState<Set<string>>(new Set());

  // Filters
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  // -----------------------------------------------------------------------
  // Toggle expand
  // -----------------------------------------------------------------------

  function toggleExpand(leaseId: string) {
    setExpandedLeases((prev) => {
      const next = new Set(prev);
      if (next.has(leaseId)) {
        next.delete(leaseId);
      } else {
        next.add(leaseId);
      }
      return next;
    });
  }

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);

    // 1. Fetch all lease agreements
    const { data: leases } = await supabase
      .from("lease_agreements")
      .select("id, lessee_name, vineyard_id, cost_share_formula, vineyard:vineyards(name)")
      .order("lessee_name");

    if (!leases || leases.length === 0) {
      setLeaseRows([]);
      setLoading(false);
      return;
    }

    // 2. Fetch blocks linked to leases
    const leaseIds = (leases as unknown as LeaseAgreement[]).map((l) => l.id);
    const { data: blocks } = await supabase
      .from("blocks")
      .select("id, name, acreage, lease_agreement_id")
      .in("lease_agreement_id", leaseIds);

    const blocksByLease = new Map<string, Block[]>();
    for (const b of (blocks ?? []) as Block[]) {
      if (!b.lease_agreement_id) continue;
      if (!blocksByLease.has(b.lease_agreement_id)) {
        blocksByLease.set(b.lease_agreement_id, []);
      }
      blocksByLease.get(b.lease_agreement_id)!.push(b);
    }

    // 3. Get all block IDs that belong to any lease
    const allBlockIds = (blocks ?? []).map((b: Block) => b.id);

    // 4. Fetch time entries for those blocks within the date range
    let entriesData: TimeEntry[] = [];
    if (allBlockIds.length > 0) {
      let query = supabase
        .from("time_entries")
        .select("id, hours, block_id, worker:workers(hourly_rate)")
        .in("block_id", allBlockIds);

      if (startDate) query = query.gte("date", startDate);
      if (endDate) query = query.lte("date", endDate);

      const { data } = await query;
      entriesData = (data as TimeEntry[] | null) ?? [];
    }

    // Group time entries by block_id
    const entriesByBlock = new Map<string, TimeEntry[]>();
    for (const e of entriesData) {
      if (!e.block_id) continue;
      if (!entriesByBlock.has(e.block_id)) entriesByBlock.set(e.block_id, []);
      entriesByBlock.get(e.block_id)!.push(e);
    }

    // 5. Build lease rows
    const rows: LeaseRow[] = [];

    for (const lease of leases as unknown as LeaseAgreement[]) {
      const leaseBlocks = blocksByLease.get(lease.id) ?? [];
      if (leaseBlocks.length === 0) continue;

      const formula = lease.cost_share_formula ?? {
        type: "percentage",
        lessee_share: 0.5,
        owner_share: 0.5,
      };

      let totalHours = 0;
      let totalCost = 0;
      const blockDetails: BlockDetail[] = [];

      for (const block of leaseBlocks) {
        const blockEntries = entriesByBlock.get(block.id) ?? [];
        let blockHours = 0;
        let blockCost = 0;

        for (const e of blockEntries) {
          const rate = e.worker?.hourly_rate ?? 0;
          blockHours += e.hours;
          blockCost += e.hours * rate;
        }

        let lesseeShare = 0;
        let ownerShare = 0;

        if (formula.type === "percentage") {
          lesseeShare = blockCost * (formula.lessee_share ?? 0.5);
          ownerShare = blockCost * (formula.owner_share ?? 0.5);
        } else if (formula.type === "per_acre_hour") {
          const acreHourCost = (formula.per_acre_hour_rate ?? 0) * (block.acreage ?? 0) * blockHours;
          lesseeShare = acreHourCost;
          ownerShare = blockCost - acreHourCost;
          if (ownerShare < 0) ownerShare = 0;
        }

        blockDetails.push({
          blockName: block.name,
          acreage: block.acreage ?? 0,
          hours: Math.round(blockHours * 100) / 100,
          cost: Math.round(blockCost * 100) / 100,
          lesseeShare: Math.round(lesseeShare * 100) / 100,
          ownerShare: Math.round(ownerShare * 100) / 100,
        });

        totalHours += blockHours;
        totalCost += blockCost;
      }

      let totalLesseeShare = 0;
      let totalOwnerShare = 0;

      if (formula.type === "percentage") {
        totalLesseeShare = totalCost * (formula.lessee_share ?? 0.5);
        totalOwnerShare = totalCost * (formula.owner_share ?? 0.5);
      } else if (formula.type === "per_acre_hour") {
        totalLesseeShare = blockDetails.reduce((sum, b) => sum + b.lesseeShare, 0);
        totalOwnerShare = blockDetails.reduce((sum, b) => sum + b.ownerShare, 0);
      }

      const vineyardRaw = lease.vineyard;
      const vineyardName = vineyardRaw
        ? Array.isArray(vineyardRaw)
          ? vineyardRaw[0]?.name ?? "Unknown Vineyard"
          : vineyardRaw.name
        : "Unknown Vineyard";

      rows.push({
        leaseId: lease.id,
        leaseName: `${vineyardName} - ${lease.lessee_name}`,
        lessee: lease.lessee_name,
        blocks: leaseBlocks.map((b) => b.name).join(", "),
        totalHours: Math.round(totalHours * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        lesseeShare: Math.round(totalLesseeShare * 100) / 100,
        ownerShare: Math.round(totalOwnerShare * 100) / 100,
        blockDetails,
      });
    }

    setLeaseRows(rows);
    setLoading(false);
  }, [supabase, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -----------------------------------------------------------------------
  // CSV export
  // -----------------------------------------------------------------------

  function exportInvoiceCSV() {
    const header = "Lease Name,Lessee,Block,Hours,Cost,Lessee Share";
    const rows: string[] = [];

    for (const lease of leaseRows) {
      for (const block of lease.blockDetails) {
        rows.push(
          `"${lease.leaseName}","${lease.lessee}","${block.blockName}",${block.hours},${block.cost},${block.lesseeShare}`
        );
      }
    }

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lease-invoice-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("reports.leases_title", locale)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("reports.leases_subtitle", locale)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/reports">
            <Button variant="outline" size="sm">
              {t("reports.cost_allocation", locale)}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={exportInvoiceCSV}
            disabled={leaseRows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {t("reports.export_invoice", locale)}
          </Button>
        </div>
      </div>

      {/* Date range filter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="space-y-1.5">
          <Label htmlFor="start_date">{t("common.start_date", locale)}</Label>
          <Input
            id="start_date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end_date">{t("common.end_date", locale)}</Label>
          <Input
            id="end_date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t("common.loading", locale)}</p>}

      {/* Lease table */}
      {!loading && leaseRows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("reports.no_leases_linked", locale)}
        </p>
      )}

      {!loading && leaseRows.length > 0 && (
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium text-muted-foreground w-8"></th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                  {t("reports.lease_name", locale)}
                </th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("reports.lessee", locale)}</th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">{t("reports.blocks_col", locale)}</th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                  {t("reports.total_hours", locale)}
                </th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                  {t("reports.total_cost", locale)}
                </th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                  {t("reports.lessee_share", locale)}
                </th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">
                  {t("reports.owner_share", locale)}
                </th>
              </tr>
            </thead>
            <tbody>
              {leaseRows.map((lease) => (
                <LeaseTableRow
                  key={lease.leaseId}
                  lease={lease}
                  expanded={expandedLeases.has(lease.leaseId)}
                  onToggle={() => toggleExpand(lease.leaseId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lease row with expandable block details
// ---------------------------------------------------------------------------

function LeaseTableRow({
  lease,
  expanded,
  onToggle,
}: {
  lease: LeaseRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="p-4">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="p-4 font-medium">{lease.leaseName}</td>
        <td className="p-4">{lease.lessee}</td>
        <td className="p-4">{lease.blocks}</td>
        <td className="p-4">{lease.totalHours}</td>
        <td className="p-4">${lease.totalCost.toFixed(2)}</td>
        <td className="p-4">${lease.lesseeShare.toFixed(2)}</td>
        <td className="p-4">${lease.ownerShare.toFixed(2)}</td>
      </tr>
      {expanded &&
        lease.blockDetails.map((block) => (
          <tr key={block.blockName} className="border-b bg-muted/20">
            <td className="p-4"></td>
            <td className="p-4 pl-8 text-muted-foreground">{block.blockName}</td>
            <td className="p-4 text-muted-foreground">
              {block.acreage > 0 ? `${block.acreage} ac` : "-"}
            </td>
            <td className="p-4"></td>
            <td className="p-4 text-muted-foreground">{block.hours}</td>
            <td className="p-4 text-muted-foreground">${block.cost.toFixed(2)}</td>
            <td className="p-4 text-muted-foreground">${block.lesseeShare.toFixed(2)}</td>
            <td className="p-4 text-muted-foreground">${block.ownerShare.toFixed(2)}</td>
          </tr>
        ))}
    </>
  );
}
