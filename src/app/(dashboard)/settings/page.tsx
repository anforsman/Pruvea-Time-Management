"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n-context";
import { t } from "@/lib/i18n";

interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  pay_period: string;
  approval_deadline_hours: number;
}

const timezones = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "Pacific/Honolulu",
];

export default function SettingsPage() {
  const { locale } = useLocale();
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [payPeriod, setPayPeriod] = useState("weekly");
  const [approvalDeadline, setApprovalDeadline] = useState("48");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("organizations")
        .select("*")
        .limit(1)
        .single();

      if (data) {
        setOrg(data);
        setName(data.name);
        setSlug(data.slug);
        setTimezone(data.timezone ?? "America/Los_Angeles");
        setPayPeriod(data.pay_period ?? "weekly");
        setApprovalDeadline(String(data.approval_deadline_hours ?? 48));
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setError(null);
    setSuccess(false);
    setSaving(true);

    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        name: name.trim(),
        slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        timezone,
        pay_period: payPeriod,
        approval_deadline_hours: parseInt(approvalDeadline) || 48,
        updated_at: new Date().toISOString(),
      })
      .eq("id", org.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("settings.loading", locale)}
      </div>
    );
  }

  if (!org) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("settings.title_short", locale)}</h1>
        <p className="text-muted-foreground">{t("settings.no_org", locale)}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{t("settings.title", locale)}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general", locale)}</CardTitle>
          <CardDescription>{t("settings.general_desc", locale)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
                {t("settings.saved", locale)}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">{t("settings.org_name", locale)}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">{t("settings.slug", locale)}</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                placeholder="my-vineyard"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.slug_hint", locale)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">{t("settings.timezone", locale)}</Label>
              <Select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settings.timezone_hint", locale)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay_period">{t("settings.pay_period", locale)}</Label>
              <Select
                id="pay_period"
                value={payPeriod}
                onChange={(e) => setPayPeriod(e.target.value)}
              >
                <option value="weekly">{t("settings.pay_period.weekly", locale)}</option>
                <option value="biweekly">{t("settings.pay_period.biweekly", locale)}</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="approval_deadline">{t("settings.approval_deadline", locale)}</Label>
              <Input
                id="approval_deadline"
                type="number"
                min="1"
                max="168"
                value={approvalDeadline}
                onChange={(e) => setApprovalDeadline(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.approval_deadline_hint", locale)}
              </p>
            </div>

            <div className="pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? t("common.saving", locale) : t("settings.save", locale)}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
