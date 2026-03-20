import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  // Twilio sends form-encoded data
  const formData = await request.formData();
  const from = formData.get("From") as string;
  const body = formData.get("Body") as string;
  const messageSid = formData.get("MessageSid") as string;
  const numMedia = parseInt((formData.get("NumMedia") as string) || "0");

  // Collect media URLs
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = formData.get(`MediaUrl${i}`) as string;
    if (url) mediaUrls.push(url);
  }

  console.log(`Inbound SMS from ${from}: ${body}`);

  // Look up worker by phone number
  const { data: worker } = await supabase
    .from("workers")
    .select("*")
    .eq("phone", from)
    .single();

  // Store raw message
  const { data: rawMsg } = await supabase
    .from("raw_messages")
    .insert({
      twilio_sid: messageSid,
      from_number: from,
      body,
      media_urls: mediaUrls,
      worker_id: worker?.id ?? null,
      direction: "inbound",
    })
    .select()
    .single();

  if (!worker) {
    // Unknown number — respond asking who they are
    return twimlResponse(
      "We don't recognize this number. Please reply with your full name so we can set up your account.\n\nNo reconocemos este número. Responda con su nombre completo."
    );
  }

  // Check conversation state
  const { data: convState } = await supabase
    .from("conversation_state")
    .select("*")
    .eq("worker_id", worker.id)
    .single();

  const currentState = convState?.state ?? "idle";
  const upperMsg = body.trim().toUpperCase();

  // --- AWAITING CONFIRMATION ---
  if (currentState === "awaiting_confirmation") {
    if (["YES", "SÍ", "SI", "Y", "S"].includes(upperMsg)) {
      if (convState?.pending_entry_id) {
        await supabase
          .from("time_entries")
          .update({ status: "worker_confirmed" })
          .eq("id", convState.pending_entry_id);
      }
      await supabase
        .from("conversation_state")
        .update({ state: "idle", pending_entry_id: null, context: {} })
        .eq("worker_id", worker.id);

      const reply =
        worker.language === "es"
          ? "¡Confirmado! Tus horas han sido registradas."
          : "Confirmed! Your hours have been logged.";
      return twimlResponse(reply);
    }

    if (["NO", "N"].includes(upperMsg)) {
      if (convState?.pending_entry_id) {
        await supabase
          .from("time_entries")
          .update({ status: "rejected" })
          .eq("id", convState.pending_entry_id);
      }
      await supabase
        .from("conversation_state")
        .update({ state: "idle", pending_entry_id: null, context: {} })
        .eq("worker_id", worker.id);

      const reply =
        worker.language === "es"
          ? "Entrada rechazada. Envía tus horas de nuevo cuando estés listo."
          : "Entry rejected. Send your hours again when ready.";
      return twimlResponse(reply);
    }

    // Treat as correction — delete old draft and re-process
    if (convState?.pending_entry_id) {
      await supabase
        .from("time_entries")
        .delete()
        .eq("id", convState.pending_entry_id);
    }
  }

  // --- IDLE / NEW ENTRY: AI PARSING ---
  const parsed = await parseWithAI(body, worker);

  if (!parsed) {
    const reply =
      worker.language === "es"
        ? "No pude entender tu mensaje. Envía algo como: '8 horas poda bloque A'"
        : "I couldn't understand your message. Send something like: '8 hours pruning block A'";
    return twimlResponse(reply);
  }

  // Resolve block and task
  const blockId = parsed.block_name ? await resolveBlock(parsed.block_name) : null;
  const taskId = parsed.task_name ? await resolveTask(parsed.task_name) : null;
  const vineyardId = blockId ? await getVineyardForBlock(blockId) : null;

  // Insert draft time entry
  const { data: entry } = await supabase
    .from("time_entries")
    .insert({
      worker_id: worker.id,
      vineyard_id: vineyardId,
      block_id: blockId,
      task_id: taskId,
      date: parsed.date,
      hours: parsed.hours,
      status: "draft",
      source_message_id: rawMsg?.id ?? null,
      ai_confidence: parsed.confidence,
      notes: parsed.notes,
    })
    .select()
    .single();

  // Upsert conversation state
  await supabase.from("conversation_state").upsert(
    {
      worker_id: worker.id,
      state: "awaiting_confirmation",
      pending_entry_id: entry?.id ?? null,
      context: {},
    },
    { onConflict: "worker_id" }
  );

  const blockName = parsed.block_name ?? "unspecified";
  const taskName = parsed.task_name ?? "unspecified";
  const reply =
    worker.language === "es"
      ? `¡Recibido! ${parsed.hours}h en ${blockName} (${taskName}) el ${parsed.date}. Responde SÍ para confirmar o describe correcciones.`
      : `Got it! ${parsed.hours}h at ${blockName} (${taskName}) on ${parsed.date}. Reply YES to confirm or describe corrections.`;

  return twimlResponse(reply);
}

function twimlResponse(message: string) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function parseWithAI(
  message: string,
  worker: { language: string; crew_id: string | null }
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackParse(message);

  const [{ data: blocks }, { data: tasks }] = await Promise.all([
    supabase.from("blocks").select("name, aliases"),
    supabase.from("tasks").select("name, aliases"),
  ]);

  let crewDefaults = "";
  if (worker.crew_id) {
    const { data: crew } = await supabase
      .from("crews")
      .select("name, vineyards(name), blocks(name)")
      .eq("id", worker.crew_id)
      .single();
    if (crew) {
      crewDefaults = `Worker's crew: ${crew.name}. Default vineyard: ${(crew as any).vineyards?.name ?? "none"}. Default block: ${(crew as any).blocks?.name ?? "none"}.`;
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const blockList = (blocks ?? [])
    .map((b: any) => `${b.name} (aliases: ${b.aliases?.join(", ") ?? "none"})`)
    .join("\n");
  const taskList = (tasks ?? [])
    .map((t: any) => `${t.name} (aliases: ${t.aliases?.join(", ") ?? "none"})`)
    .join("\n");

  const systemPrompt = `You are a time entry parser for vineyard workers. Extract structured time entry data from informal messages in English or Spanish.

Available blocks:
${blockList || "None configured yet"}

Available tasks:
${taskList || "None configured yet"}

${crewDefaults}

Return ONLY valid JSON: { "date": "YYYY-MM-DD", "hours": number, "block_name": string|null, "task_name": string|null, "confidence": number (0-1), "notes": string|null }

Rules:
- If no date mentioned, use today: ${today}
- Hours can be expressed as "8 hours", "8h", "8", "8 horas"
- Block matching: try exact name first, then check aliases
- Task matching: try exact name first, then check aliases
- Confidence: 1.0 if all fields clear, 0.7 if using defaults, 0.5 if ambiguous, 0.3 if missing critical info
- If you can't extract hours at all, return null`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackParse(message);
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.hours || parsed.hours <= 0) return null;
    return parsed;
  } catch {
    return fallbackParse(message);
  }
}

function fallbackParse(message: string) {
  const hoursMatch = message.match(/(\d+\.?\d*)\s*(hours?|horas?|hrs?|h)\b/i);
  if (!hoursMatch) {
    const numMatch = message.match(/\b(\d+\.?\d*)\b/);
    if (!numMatch) return null;
    return {
      date: new Date().toISOString().split("T")[0],
      hours: parseFloat(numMatch[1]),
      block_name: null,
      task_name: null,
      confidence: 0.3,
      notes: "Parsed by fallback — only hours extracted",
    };
  }
  return {
    date: new Date().toISOString().split("T")[0],
    hours: parseFloat(hoursMatch[1]),
    block_name: null,
    task_name: null,
    confidence: 0.5,
    notes: "Parsed by fallback",
  };
}

async function resolveBlock(name: string): Promise<string | null> {
  const { data: exact } = await supabase
    .from("blocks")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .single();
  if (exact) return exact.id;

  const { data: blocks } = await supabase.from("blocks").select("id, aliases");
  const match = (blocks ?? []).find((b: any) =>
    b.aliases?.some((a: string) => a.toLowerCase() === name.toLowerCase())
  );
  return match?.id ?? null;
}

async function resolveTask(name: string): Promise<string | null> {
  const { data: exact } = await supabase
    .from("tasks")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .single();
  if (exact) return exact.id;

  const { data: tasks } = await supabase.from("tasks").select("id, aliases");
  const match = (tasks ?? []).find((t: any) =>
    t.aliases?.some((a: string) => a.toLowerCase() === name.toLowerCase())
  );
  return match?.id ?? null;
}

async function getVineyardForBlock(blockId: string): Promise<string | null> {
  const { data } = await supabase
    .from("blocks")
    .select("vineyard_id")
    .eq("id", blockId)
    .single();
  return data?.vineyard_id ?? null;
}
