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

interface Crew {
  id: string;
  name: string;
}

interface SupervisorOption {
  id: string;
  full_name: string;
}

export default function NewWorkerPage() {
  const router = useRouter();
  const supabase = createClient();
  const { locale } = useLocale();

  const [crews, setCrews] = useState<Crew[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<"standard" | "elevated">("standard");
  const [crewId, setCrewId] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [isActive, setIsActive] = useState(true);
  const [reportsTo, setReportsTo] = useState("");

  useEffect(() => {
    async function loadOptions() {
      const [{ data: crewData }, { data: supData }] = await Promise.all([
        supabase.from("crews").select("id, name").order("name"),
        supabase.from("workers").select("id, full_name").eq("type", "elevated").eq("is_active", true).order("full_name"),
      ]);
      if (crewData) setCrews(crewData);
      if (supData) setSupervisors(supData);
    }
    loadOptions();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: insertError } = await supabase.from("workers").insert({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      type,
      crew_id: crewId || null,
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
      language,
      is_active: isActive,
      reports_to: reportsTo || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.push("/workers");
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("workers.add", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="full_name">{t("workers.name", locale)} *</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Enter full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">{t("workers.phone", locale)}</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">{t("workers.type", locale)}</Label>
              <Select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as "standard" | "elevated")}
              >
                <option value="standard">{t("workers.type.standard", locale)}</option>
                <option value="elevated">{t("workers.type.elevated", locale)}</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="crew_id">{t("workers.crew", locale)}</Label>
              <Select
                id="crew_id"
                value={crewId}
                onChange={(e) => setCrewId(e.target.value)}
              >
                <option value="">{t("workers.no_crew", locale)}</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hourly_rate">{t("workers.rate", locale)}</Label>
              <Input
                id="hourly_rate"
                type="number"
                step="0.01"
                min="0"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">{t("workers.language", locale)}</Label>
              <Select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "en" | "es")}
              >
                <option value="en">{t("workers.language.en", locale)}</option>
                <option value="es">{t("workers.language.es", locale)}</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reports_to">{t("workers.supervisor", locale)}</Label>
              <Select
                id="reports_to"
                value={reportsTo}
                onChange={(e) => setReportsTo(e.target.value)}
              >
                <option value="">{t("common.none", locale)}</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="is_active">{t("common.active", locale)}</Label>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading}>
                {loading ? t("common.saving", locale) : t("workers.create", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/workers")}
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
