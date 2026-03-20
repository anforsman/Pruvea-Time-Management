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

interface Crew {
  id: string;
  name: string;
}

interface SupervisorOption {
  id: string;
  full_name: string;
}

export default function EditWorkerPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  const { locale } = useLocale();

  const [crews, setCrews] = useState<Crew[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [smsStatus, setSmsStatus] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<"standard" | "elevated">("standard");
  const [crewId, setCrewId] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [isActive, setIsActive] = useState(true);
  const [reportsTo, setReportsTo] = useState("");

  useEffect(() => {
    async function load() {
      const [workerRes, crewsRes, supervisorsRes] = await Promise.all([
        supabase.from("workers").select("*").eq("id", id).single(),
        supabase.from("crews").select("id, name").order("name"),
        supabase.from("workers").select("id, full_name").eq("type", "elevated").eq("is_active", true).neq("id", id).order("full_name"),
      ]);

      if (workerRes.error) {
        setError(t("workers.not_found", locale));
        setLoading(false);
        return;
      }

      const w = workerRes.data;
      setFullName(w.full_name);
      setPhone(w.phone ?? "");
      setType(w.type);
      setCrewId(w.crew_id ?? "");
      setHourlyRate(w.hourly_rate != null ? String(w.hourly_rate) : "");
      setLanguage(w.language);
      setIsActive(w.is_active);
      setReportsTo(w.reports_to ?? "");

      if (crewsRes.data) setCrews(crewsRes.data);
      if (supervisorsRes.data) setSupervisors(supervisorsRes.data);
      setLoading(false);
    }
    load();
  }, [id, supabase, locale]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { error: updateError } = await supabase
      .from("workers")
      .update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        type,
        crew_id: crewId || null,
        hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        language,
        is_active: isActive,
        reports_to: reportsTo || null,
      })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.push("/workers");
  }

  async function handleDelete() {
    setSaving(true);
    const { error: deleteError } = await supabase
      .from("workers")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      setConfirmDelete(false);
      return;
    }

    router.push("/workers");
  }

  async function handleSendReminder() {
    if (!phone) {
      setSmsStatus(t("workers.sms_no_phone", locale));
      return;
    }
    setSmsStatus(t("workers.sms_sending", locale));
    const body =
      language === "es"
        ? `Hola ${fullName}, ¿puedes registrar tus horas de hoy? Responde con tus horas, bloque y tarea.`
        : `Hi ${fullName}, can you log your hours for today? Reply with your hours, block, and task.`;
    try {
      const res = await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, body }),
      });
      const data = await res.json();
      if (res.ok) {
        setSmsStatus(`Sent! (ID: ${data.textId})`);
      } else {
        setSmsStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setSmsStatus(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("workers.loading", locale)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("workers.edit", locale)}</CardTitle>
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
              <Button type="submit" disabled={saving}>
                {saving ? t("common.saving", locale) : t("common.save_changes", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/workers")}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("workers.sms_title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Send an hours reminder to {fullName} {phone ? `(${phone})` : "(no phone)"}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleSendReminder}
            disabled={!phone}
          >
            {t("workers.sms_send", locale)}
          </Button>
          {smsStatus && (
            <p className="text-sm text-muted-foreground">{smsStatus}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogHeader>
          <DialogTitle>{t("workers.delete_title", locale)}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          {t("workers.delete_confirm", locale)} <strong>{fullName}</strong>? {t("workers.delete_warning", locale)}
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
