import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Returns the most recent Monday (ISO date string). */
function getMostRecentMonday(from: Date = new Date()): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().split("T")[0];
}

/** Returns the Sunday following a given Monday (ISO date string). */
function getSundayFromMonday(monday: string): string {
  const d = new Date(monday + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

/** Day-of-week abbreviations keyed by JS getDay() index. */
const DAY_ABBR_EN: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};
const DAY_ABBR_ES: Record<number, string> = {
  0: "Dom", 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const weekStart = body.week_start ?? getMostRecentMonday();
    const weekEnd = getSundayFromMonday(weekStart);

    // Fetch all active workers
    const { data: workers, error: workersErr } = await supabase
      .from("workers")
      .select("id, full_name, phone, hourly_rate, language")
      .eq("is_active", true);

    if (workersErr) {
      console.error("Error fetching workers:", workersErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch workers", details: workersErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let summariesCreated = 0;
    let smsSent = 0;
    const smsErrors: string[] = [];

    for (const worker of workers || []) {
      // Fetch time entries for this worker in the week range
      const { data: entries, error: entriesErr } = await supabase
        .from("time_entries")
        .select("id, date, hours, status, source_type")
        .eq("worker_id", worker.id)
        .gte("date", weekStart)
        .lte("date", weekEnd);

      if (entriesErr) {
        console.error(`Error fetching entries for worker ${worker.id}:`, entriesErr);
        continue;
      }

      const entryList = entries || [];
      if (entryList.length === 0) continue;

      // Compute aggregates
      const totalHours = entryList.reduce(
        (sum: number, e: { hours: number }) => sum + Number(e.hours),
        0,
      );
      const hourlyRate = Number(worker.hourly_rate) || 0;
      const totalPay = totalHours * hourlyRate;
      const entryCount = entryList.length;
      const unconfirmedCount = entryList.filter(
        (e: { status: string }) => e.status !== "worker_confirmed",
      ).length;
      const inferredCount = entryList.filter(
        (e: { source_type: string | null }) => e.source_type === "inferred",
      ).length;

      // UPSERT into weekly_summaries
      const { data: summary, error: upsertErr } = await supabase
        .from("weekly_summaries")
        .upsert(
          {
            worker_id: worker.id,
            week_start: weekStart,
            week_end: weekEnd,
            total_hours: totalHours,
            total_pay: totalPay,
            hourly_rate_used: hourlyRate,
            entry_count: entryCount,
            unconfirmed_count: unconfirmedCount,
            inferred_count: inferredCount,
            status: "pending",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "worker_id,week_start" },
        )
        .select()
        .single();

      if (upsertErr) {
        console.error(`Error upserting summary for worker ${worker.id}:`, upsertErr);
        continue;
      }

      summariesCreated++;

      // Log 'created' action in approval_log
      const { error: logErr } = await supabase.from("approval_log").insert({
        summary_id: summary.id,
        action: "created",
        performed_by: worker.id,
        actor_role: "system",
        notes: `Weekly summary generated for ${weekStart} to ${weekEnd}`,
      });

      if (logErr) {
        console.error(`Error logging approval for worker ${worker.id}:`, logErr);
      }

      // Build daily breakdown using worker's language
      const lang = worker.language || "es";
      const dayAbbr = lang === "es" ? DAY_ABBR_ES : DAY_ABBR_EN;
      const hoursByDay: Record<string, number> = {};
      for (const entry of entryList) {
        const entryDate = new Date(entry.date + "T00:00:00");
        const abbr = dayAbbr[entryDate.getDay()];
        hoursByDay[abbr] = (hoursByDay[abbr] || 0) + Number(entry.hours);
      }

      const orderedDays = lang === "es"
        ? ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const dailyBreakdown = orderedDays
        .filter((d) => hoursByDay[d] !== undefined)
        .map((d) => `${d} ${hoursByDay[d]}h`)
        .join(", ");

      const payFormatted = totalPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // Send SMS (skip test/fake numbers like +1555*)
      const isRealPhone = worker.phone && !worker.phone.startsWith("+1555");
      if (isRealPhone) {
        let message: string;

        if (lang === "en") {
          message = `Weekly summary: You logged ${totalHours}h this week for $${payFormatted}.\n${dailyBreakdown}\nReply with C if this is correct. Otherwise reply with your changes.`;
        } else {
          message = `Resumen semanal: Registraste ${totalHours}h esta semana por $${payFormatted}.\n${dailyBreakdown}\nResponde con C si es correcto. De lo contrario, responde con tus cambios.`;
        }

        const smsResponse = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            to: worker.phone,
            body: message,
            worker_id: worker.id,
          }),
        });

        const smsResult = await smsResponse.json().catch(() => null);
        if (smsResponse.ok) {
          smsSent++;
        } else {
          smsErrors.push(`worker=${worker.id} status=${smsResponse.status} result=${JSON.stringify(smsResult)}`);
        }
      }

      // Set conversation_state to 'awaiting_confirmation'
      const { error: stateErr } = await supabase
        .from("conversation_state")
        .upsert(
          {
            worker_id: worker.id,
            state: "awaiting_confirmation",
            pending_entry_id: null,
            context: {
              type: "weekly_summary",
              summary_id: summary.id,
              week_start: weekStart,
              week_end: weekEnd,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "worker_id" },
        );

      if (stateErr) {
        console.error(`Error setting conversation state for worker ${worker.id}:`, stateErr);
      }
    }

    return new Response(
      JSON.stringify({ summaries_created: summariesCreated, sms_sent: smsSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("generate-weekly-summary error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
