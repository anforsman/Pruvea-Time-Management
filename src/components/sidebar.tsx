"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Users, UserCog, MapPin, Clock, MessageSquare, Home, Menu, X, AlertTriangle, ClipboardCheck, TrendingUp, Globe, BarChart3, Settings } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

const navItems = [
  { href: "/dashboard", i18nKey: "nav.dashboard", icon: Home },
  { href: "/workers", i18nKey: "nav.workers", icon: Users },
  { href: "/crews", i18nKey: "nav.crews", icon: UserCog },
  { href: "/vineyards", i18nKey: "nav.vineyards", icon: MapPin },
  { href: "/time-entries", i18nKey: "nav.time_entries", icon: Clock },
  { href: "/messages", i18nKey: "nav.messages", icon: MessageSquare },
  { href: "/anomalies", i18nKey: "nav.anomalies", icon: AlertTriangle },
  { href: "/approvals", i18nKey: "nav.approvals", icon: ClipboardCheck },
  { href: "/reports", i18nKey: "nav.reports", icon: BarChart3 },
  { href: "/analytics", i18nKey: "nav.analytics", icon: TrendingUp },
  { href: "/settings", i18nKey: "nav.settings", icon: Settings },
];

export function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { locale, setLocale } = useLocale();

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-muted/30">
        <div className="p-6 border-b">
          <h1 className="text-lg font-bold">Pruvea</h1>
          <p className="text-xs text-muted-foreground">Time Management</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {t(item.i18nKey, locale)}
              </Link>
            );
          })}
        </nav>
        {/* Language toggle */}
        <div className="p-4 border-t">
          <button
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
          >
            <Globe className="h-4 w-4" />
            {locale === "en" ? "Espa\u00f1ol" : "English"}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col">
        <header className="md:hidden flex items-center justify-between border-b p-4">
          <h1 className="text-lg font-bold">Pruvea</h1>
          <button onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {/* Mobile nav dropdown */}
        {mobileOpen && (
          <nav className="md:hidden border-b p-4 space-y-1 bg-background">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(item.i18nKey, locale)}
                </Link>
              );
            })}
            {/* Mobile language toggle */}
            <button
              onClick={() => setLocale(locale === "en" ? "es" : "en")}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
            >
              <Globe className="h-4 w-4" />
              {locale === "en" ? "Espa\u00f1ol" : "English"}
            </button>
          </nav>
        )}

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
