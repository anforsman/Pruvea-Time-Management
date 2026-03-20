"use client";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface MessageRow {
  id: string;
  twilio_sid: string;
  from_number: string;
  body: string | null;
  media_urls: string[];
  direction: "inbound" | "outbound";
  created_at: string;
  worker: { full_name: string } | null;
  [key: string]: unknown;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "-";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export function MessagesTable({ data }: { data: MessageRow[] }) {
  const { locale } = useLocale();

  const columns = [
    {
      key: "created_at",
      header: t("messages.time", locale),
      render: (row: MessageRow) => formatTime(row.created_at),
    },
    {
      key: "direction",
      header: t("messages.direction", locale),
      render: (row: MessageRow) => (
        <Badge variant={row.direction === "inbound" ? "default" : "secondary"}>
          {t(`messages.direction.${row.direction}`, locale)}
        </Badge>
      ),
    },
    {
      key: "from_number",
      header: t("messages.from_number", locale),
    },
    {
      key: "worker",
      header: t("messages.worker", locale),
      render: (row: MessageRow) => row.worker?.full_name ?? "-",
    },
    {
      key: "body",
      header: t("messages.body", locale),
      render: (row: MessageRow) => (
        <span className="text-muted-foreground">{truncate(row.body, 100)}</span>
      ),
    },
    {
      key: "media_urls",
      header: t("messages.media", locale),
      render: (row: MessageRow) => {
        const count = row.media_urls?.length ?? 0;
        return count > 0 ? String(count) : "-";
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      emptyMessage={t("messages.no_messages", locale)}
    />
  );
}
