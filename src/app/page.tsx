"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

export default function Home() {
  const { locale } = useLocale();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">{t("landing.title", locale)}</h1>
        <p className="text-muted-foreground mb-8">
          {t("landing.description", locale)}
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("common.open_dashboard", locale)}
        </Link>
      </div>
    </div>
  );
}
