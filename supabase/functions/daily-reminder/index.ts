import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Returns today's date as an ISO string (YYYY-MM-DD). */
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

/** Returns yesterday's date as an ISO string (YYYY-MM-DD). */
function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const reminderType: string = body.type;

    if (reminderType !== "evening" && reminderType !== "morning") {
      return new Response(
        JSON.stringify({ error: "Invalid type. Must be 'evening' or 'morning'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine the target date based on reminder type
    const targetDate = reminderType === "evening" ? getToday() : getYesterday();

    // Fetch active workers with phone numbers
    const { data: workers, error: workersErr } = await supabase
      .from("workers")
      .select("id, full_name, phone, language")
      .eq("is_active", true)
      .not("phone", "is", null);

    if (workersErr) {
      console.error("Error fetching workers:", workersErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch workers", details: workersErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let remindersSent = 0;

    for (const worker of workers || []) {
      // Check if worker has any time_entries for the target date
      const { count, error: countErr } = await supabase
        .from("time_entries")
        .select("id", { count: "exact", head: true })
        .eq("worker_id", worker.id)
        .eq("date", targetDate);

      if (countErr) {
        console.error(`Error checking entries for worker ${worker.id}:`, countErr);
        continue;
      }

      // Skip workers who already have entries
      if (count && count > 0) continue;

      const lang = worker.language || "es";
      const name = worker.full_name;
      let message: string;

      if (reminderType === "evening") {
        if (lang === "en") {
          message =
            `Hi ${name}, don't forget to log your hours for today! Text your hours, block, and task. e.g. '8am-4pm pruning block A'`;
        } else {
          message =
            `Hola ${name}, \u00a1no olvides registrar tus horas de hoy! Env\u00eda tus horas, bloque y tarea. ej: '8am-4pm poda bloque A'`;
        }
      } else {
        // morning follow-up
        if (lang === "en") {
          message =
            `Hi ${name}, you didn't log hours yesterday. Reply with your hours to catch up!`;
        } else {
          message =
            `Hola ${name}, no registraste horas ayer. \u00a1Responde con tus horas para ponerte al d\u00eda!`;
        }
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

      if (smsResponse.ok) {
        remindersSent++;
      } else {
        const smsErr = await smsResponse.text();
        console.error(`Failed to send reminder to worker ${worker.id}:`, smsErr);
      }
    }

    return new Response(
      JSON.stringify({ reminders_sent: remindersSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("daily-reminder error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
