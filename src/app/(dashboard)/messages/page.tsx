"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MessagesTable } from "./messages-table";
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

export default function MessagesPage() {
  const { locale } = useLocale();
  const [messages, setMessages] = useState<MessageRow[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("raw_messages")
        .select("*, worker:workers(full_name)")
        .order("created_at", { ascending: false })
        .limit(100);

      setMessages((data as MessageRow[] | null) ?? []);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("messages.title", locale)}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("messages.subtitle", locale)}
        </p>
      </div>

      <MessagesTable data={messages} />
    </div>
  );
}
