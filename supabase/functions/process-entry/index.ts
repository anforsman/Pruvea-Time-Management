import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParsedEntry {
  date: string;
  hours: number;
  block_name: string | null;
  task_name: string | null;
  confidence: number;
  notes: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { worker_id, message_body, message_id, worker_name, crew_defaults } =
      await req.json();

    if (!worker_id || !message_body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch blocks with aliases
    const { data: blocks, error: blocksErr } = await supabase
      .from("blocks")
      .select("id, name, aliases, vineyard_id");
    if (blocksErr) {
      console.error("Error fetching blocks:", blocksErr);
    }

    // Fetch tasks with aliases
    const { data: tasks, error: tasksErr } = await supabase
      .from("tasks")
      .select("id, name, aliases");
    if (tasksErr) {
      console.error("Error fetching tasks:", tasksErr);
    }

    // Fetch worker language preference
    const { data: worker } = await supabase
      .from("workers")
      .select("language, phone")
      .eq("id", worker_id)
      .single();

    const workerLang = worker?.language || "es";
    const workerPhone = worker?.phone;

    // Build block list for the prompt
    const blockList = (blocks || [])
      .map(
        (b: { name: string; aliases: string[] }) =>
          `- ${b.name} (aliases: ${(b.aliases || []).join(", ") || "none"})`,
      )
      .join("\n");

    // Build task list for the prompt
    const taskList = (tasks || [])
      .map(
        (t: { name: string; aliases: string[] }) =>
          `- ${t.name} (aliases: ${(t.aliases || []).join(", ") || "none"})`,
      )
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    // Build defaults description
    const defaultsDesc = crew_defaults
      ? `Worker's crew defaults — block: ${crew_defaults.block_name || "none"}, vineyard: ${crew_defaults.vineyard_name || "none"}`
      : "No crew defaults available.";

    const systemPrompt = `You are a time entry parser for vineyard workers. Extract structured time entry data from informal messages in English or Spanish.

Available blocks:
${blockList || "None configured yet."}

Available tasks:
${taskList || "None configured yet."}

${defaultsDesc}

Return JSON only (no markdown, no explanation): { "date": "YYYY-MM-DD", "hours": number, "block_name": string|null, "task_name": string|null, "confidence": number (0-1), "notes": string|null }

Rules:
- If no date mentioned, use today: ${today}
- Hours can be expressed as "8 hours", "8h", "8", "8 horas"
- Block matching: try exact name first, then check aliases (case-insensitive)
- Task matching: try exact name first, then check aliases (case-insensitive)
- Confidence: 1.0 if all fields clear, 0.7 if using defaults, 0.5 if ambiguous, 0.3 if missing critical info (like hours)
- If hours cannot be determined at all, set hours to 0 and confidence to 0.2
- notes: include any extra context from the message that doesn't map to fields`;

    // Call Claude API
    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 512,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Parse this time entry message from worker "${worker_name}":\n\n"${message_body}"`,
            },
          ],
        }),
      },
    );

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
      return new Response(
        JSON.stringify({ error: "AI parsing failed", details: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const claudeResult = await claudeResponse.json();
    const assistantText =
      claudeResult.content?.[0]?.text || "{}";

    let parsed: ParsedEntry;
    try {
      parsed = JSON.parse(assistantText);
    } catch {
      console.error("Failed to parse Claude response as JSON:", assistantText);
      return new Response(
        JSON.stringify({
          error: "AI returned invalid JSON",
          raw: assistantText,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve block name to ID
    let blockId: string | null = null;
    let vineyardId: string | null = null;
    if (parsed.block_name && blocks) {
      const matchedBlock = blocks.find(
        (b: { name: string; aliases: string[] }) =>
          b.name.toLowerCase() === parsed.block_name!.toLowerCase() ||
          (b.aliases || []).some(
            (a: string) =>
              a.toLowerCase() === parsed.block_name!.toLowerCase(),
          ),
      );
      if (matchedBlock) {
        blockId = matchedBlock.id;
        vineyardId = matchedBlock.vineyard_id;
      }
    }

    // Fall back to crew defaults for block/vineyard
    if (!blockId && crew_defaults?.block_id) {
      blockId = crew_defaults.block_id;
      vineyardId = crew_defaults.vineyard_id || null;
    }

    // Resolve task name to ID
    let taskId: string | null = null;
    if (parsed.task_name && tasks) {
      const matchedTask = tasks.find(
        (t: { name: string; aliases: string[] }) =>
          t.name.toLowerCase() === parsed.task_name!.toLowerCase() ||
          (t.aliases || []).some(
            (a: string) =>
              a.toLowerCase() === parsed.task_name!.toLowerCase(),
          ),
      );
      if (matchedTask) {
        taskId = matchedTask.id;
      }
    }

    // Insert time entry as draft
    const entryDate = parsed.date || today;
    const entryHours = parsed.hours || 0;

    const { data: timeEntry, error: entryError } = await supabase
      .from("time_entries")
      .insert({
        worker_id,
        vineyard_id: vineyardId,
        block_id: blockId,
        task_id: taskId,
        date: entryDate,
        hours: entryHours,
        status: "draft",
        source_message_id: message_id || null,
        ai_confidence: parsed.confidence,
        notes: parsed.notes,
      })
      .select()
      .single();

    if (entryError) {
      console.error("Error inserting time entry:", entryError);
      return new Response(
        JSON.stringify({ error: "Failed to create time entry", details: entryError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upsert conversation_state to awaiting_confirmation
    const { error: stateError } = await supabase
      .from("conversation_state")
      .upsert(
        {
          worker_id,
          state: "awaiting_confirmation",
          pending_entry_id: timeEntry.id,
          context: {
            parsed,
            block_name: parsed.block_name,
            task_name: parsed.task_name,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "worker_id" },
      );

    if (stateError) {
      console.error("Error upserting conversation state:", stateError);
    }

    // Build confirmation message
    const displayBlock = parsed.block_name || "N/A";
    const displayTask = parsed.task_name || "N/A";
    const displayDate = entryDate;
    const displayHours = entryHours;

    let confirmationBody: string;
    if (workerLang === "en") {
      confirmationBody =
        `Got it! ${displayHours}h at ${displayBlock} (${displayTask}) on ${displayDate}. Reply YES to confirm or describe corrections.`;
    } else {
      confirmationBody =
        `\u00a1Recibido! ${displayHours}h en ${displayBlock} (${displayTask}) el ${displayDate}. Responde S\u00cd para confirmar o describe correcciones.`;
    }

    // Invoke send-sms function
    if (workerPhone) {
      const sendSmsUrl = `${supabaseUrl}/functions/v1/send-sms`;
      const smsResponse = await fetch(sendSmsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          to: workerPhone,
          body: confirmationBody,
          worker_id,
        }),
      });

      if (!smsResponse.ok) {
        const smsErr = await smsResponse.text();
        console.error("Failed to send confirmation SMS:", smsErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, time_entry: timeEntry, parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("process-entry error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
