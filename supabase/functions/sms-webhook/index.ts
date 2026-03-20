import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Textbelt reply webhook receives JSON: { textId, fromNumber, text, data? }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    const fromNumber = payload.fromNumber ?? "";
    const body = payload.text ?? "";
    const textId = payload.textId ?? "";
    const workerIdHint = payload.data ?? "";

    console.log(`Textbelt reply from ${fromNumber}: ${body}`);

    // Look up worker by phone number (include type for crew lead check)
    const { data: worker } = await supabase
      .from("workers")
      .select("id, full_name, language, crew_id, phone, type")
      .eq("phone", fromNumber)
      .eq("is_active", true)
      .single();

    // Store raw inbound message
    const { data: rawMsg } = await supabase
      .from("raw_messages")
      .insert({
        twilio_sid: `TB_IN_${textId}`,
        from_number: fromNumber,
        body,
        media_urls: [],
        worker_id: worker?.id ?? (workerIdHint || null),
        direction: "inbound",
      })
      .select()
      .single();

    if (!worker) {
      await sendReply(
        supabaseUrl, supabaseServiceKey, fromNumber,
        "This number is not registered. Please contact your supervisor. / Este número no está registrado. Contacta a tu supervisor.",
        null,
      );
      return jsonOk();
    }

    // Check conversation state
    const { data: convState } = await supabase
      .from("conversation_state")
      .select("state, pending_entry_id, context")
      .eq("worker_id", worker.id)
      .single();

    const currentState = convState?.state ?? "idle";
    const upperMsg = body.trim().toUpperCase();
    const lang = worker.language ?? "es";

    // --- AWAITING CONFIRMATION ---
    if (currentState === "awaiting_confirmation") {
      const ctx = convState?.context as Record<string, unknown> | null;
      const isWeeklySummary = ctx?.type === "weekly_summary";
      const summaryWeekStart = (ctx?.week_start as string) ?? null;
      const summaryWeekEnd = (ctx?.week_end as string) ?? null;

      // "C", "YES", "SI" etc. all confirm
      if (["YES", "SÍ", "SI", "Y", "S", "C"].includes(upperMsg)) {
        await supabase
          .from("time_entries")
          .update({ status: "worker_confirmed" })
          .eq("worker_id", worker.id)
          .eq("status", "draft");

        // Also update the weekly summary status if this is a weekly confirmation
        if (isWeeklySummary && summaryWeekStart) {
          await supabase
            .from("weekly_summaries")
            .update({ status: "worker_confirmed", worker_confirmed_at: new Date().toISOString() })
            .eq("worker_id", worker.id)
            .eq("week_start", summaryWeekStart);
        }

        await resetState(supabase, worker.id);

        const reply = lang === "es"
          ? "¡Confirmado! Tus horas han sido registradas."
          : "Confirmed! Your hours have been logged.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk();
      }

      if (["NO", "N"].includes(upperMsg)) {
        await supabase
          .from("time_entries")
          .update({ status: "rejected" })
          .eq("worker_id", worker.id)
          .eq("status", "draft");

        await resetState(supabase, worker.id);

        const reply = lang === "es"
          ? "Entradas rechazadas. Envía tus horas de nuevo cuando estés listo."
          : "Entries rejected. Send your hours again when ready.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk();
      }

      // Not C/YES/NO — treat as changes (corrections)
      // If this is a weekly summary confirmation, parse changes and upsert entries
      if (isWeeklySummary && summaryWeekStart && summaryWeekEnd) {
        const result = await parseWeeklyChanges(
          supabase, body, worker, rawMsg?.id ?? null, summaryWeekStart, summaryWeekEnd,
        );
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);

        if (result.needsConfirmation) {
          // Keep in awaiting_confirmation with same context so they can confirm again
          await supabase.from("conversation_state").upsert(
            { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: ctx ?? {} },
            { onConflict: "worker_id" },
          );
        } else {
          await resetState(supabase, worker.id);
        }
        return jsonOk();
      }

      // Regular (non-weekly) — fall through to AI parsing as new entry
      await resetState(supabase, worker.id);
      // Fall through to AI parsing
    }

    // --- AWAITING CLARIFICATION ---
    if (currentState === "awaiting_correction") {
      const ctx = convState?.context as Record<string, string> | null;
      const originalMsg = ctx?.original_message ?? "";
      const combinedMsg = `Original: ${originalMsg}\nClarification response: ${body}`;

      await resetState(supabase, worker.id);

      const result = await parseAndCreateEntries(supabase, combinedMsg, worker, rawMsg?.id ?? null);
      await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);

      if (result.needsConfirmation) {
        await supabase.from("conversation_state").upsert(
          { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
          { onConflict: "worker_id" },
        );
      }
      return jsonOk();
    }

    // --- AWAITING SUGGESTION CONFIRMATION (STORY-021) ---
    if (currentState === "awaiting_suggestion") {
      const ctx = convState?.context as Record<string, unknown> | null;
      const suggestedEntry = ctx?.suggested_entry as ParsedEntry | null;

      if (["YES", "SÍ", "SI", "Y", "S"].includes(upperMsg) && suggestedEntry) {
        // Create the entry from the stored suggestion
        await resetState(supabase, worker.id);
        const result = await createEntriesAndConfirm(supabase, [suggestedEntry], worker, rawMsg?.id ?? null, lang);

        // Set to awaiting_confirmation for the standard confirm flow
        if (result.needsConfirmation) {
          await supabase.from("conversation_state").upsert(
            { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
            { onConflict: "worker_id" },
          );
        }
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);
        return jsonOk();
      }

      // Not YES — treat as a new message, reset and fall through to AI parsing
      await resetState(supabase, worker.id);
      // Fall through to handle as new entry
    }

    // --- HISTORICAL PATTERN SUGGESTION CHECK (STORY-021) ---
    // If the message is very short (just a number like "8" or "8h"), check for patterns
    const shortHoursMatch = body.trim().match(/^(\d+\.?\d*)\s*(hours?|horas?|hrs?|h)?$/i);
    if (shortHoursMatch && currentState === "idle") {
      const hours = parseFloat(shortHoursMatch[1]);
      if (hours > 0 && hours <= 24) {
        const suggestion = await getHistoricalSuggestion(supabase, worker.id, hours);
        if (suggestion) {
          // Store suggestion in conversation state and ask for confirmation
          await supabase.from("conversation_state").upsert(
            {
              worker_id: worker.id,
              state: "awaiting_suggestion",
              pending_entry_id: null,
              context: { suggested_entry: suggestion },
            },
            { onConflict: "worker_id" },
          );

          const blockLabel = suggestion.block_name ?? "?";
          const taskLabel = suggestion.task_name ?? "?";
          const reply = lang === "es"
            ? `¿Igual que ayer? ${hours}h ${taskLabel} en ${blockLabel}. Responde SÍ o envía los detalles.`
            : `Same as yesterday? ${hours}h ${taskLabel} at ${blockLabel}. Reply YES or send details.`;
          await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
          return jsonOk();
        }
      }
      // No pattern found — fall through to normal AI parsing
    }

    // --- IDLE / NEW ENTRY ---
    const result = await parseAndCreateEntries(supabase, body, worker, rawMsg?.id ?? null);

    if (result.needsClarification) {
      await supabase.from("conversation_state").upsert(
        {
          worker_id: worker.id,
          state: "awaiting_correction",
          pending_entry_id: null,
          context: { original_message: body },
        },
        { onConflict: "worker_id" },
      );
      await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);
      return jsonOk();
    }

    if (result.needsConfirmation) {
      await supabase.from("conversation_state").upsert(
        { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
        { onConflict: "worker_id" },
      );
    }

    await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);
    return jsonOk();
  } catch (err) {
    console.error("sms-webhook error:", err);
    return jsonOk();
  }
});

// --- Helpers ---

function jsonOk(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resetState(
  supabase: ReturnType<typeof createClient>,
  workerId: string,
) {
  await supabase
    .from("conversation_state")
    .update({ state: "idle", pending_entry_id: null, context: {} })
    .eq("worker_id", workerId);
}

async function sendReply(
  supabaseUrl: string,
  supabaseServiceKey: string,
  phone: string,
  message: string,
  workerId: string | null,
) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ to: phone, body: message, worker_id: workerId }),
    });
    if (!res.ok) {
      console.error("send-sms error:", await res.text());
    }
  } catch (err) {
    console.error("Failed to send reply:", err);
  }
}

// --- Historical Pattern Suggestion (STORY-021) ---

async function getHistoricalSuggestion(
  supabase: ReturnType<typeof createClient>,
  workerId: string,
  hours: number,
): Promise<ParsedEntry | null> {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const sinceDate = twoWeeksAgo.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  // Query confirmed entries from last 2 weeks
  const { data: recentEntries } = await supabase
    .from("time_entries")
    .select("block_id, task_id, blocks(name), tasks(name)")
    .eq("worker_id", workerId)
    .eq("status", "worker_confirmed")
    .gte("date", sinceDate)
    .order("date", { ascending: false })
    .limit(50);

  if (!recentEntries || recentEntries.length === 0) return null;

  // Find most common block+task combination
  const comboCounts = new Map<string, { count: number; blockName: string | null; taskName: string | null }>();
  for (const entry of recentEntries) {
    const blockInfo = entry.blocks as Record<string, unknown> | null;
    const taskInfo = entry.tasks as Record<string, unknown> | null;
    const blockName = (blockInfo?.name as string) ?? null;
    const taskName = (taskInfo?.name as string) ?? null;
    const key = `${blockName ?? "null"}|${taskName ?? "null"}`;

    const existing = comboCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      comboCounts.set(key, { count: 1, blockName, taskName });
    }
  }

  // Find the combo with the highest count
  let bestCombo: { blockName: string | null; taskName: string | null } | null = null;
  let bestCount = 0;
  for (const [, value] of comboCounts) {
    if (value.count > bestCount) {
      bestCount = value.count;
      bestCombo = { blockName: value.blockName, taskName: value.taskName };
    }
  }

  // Only suggest if there's a meaningful pattern (at least 2 occurrences)
  if (!bestCombo || bestCount < 2) return null;
  // Only suggest if at least one of block/task is known
  if (!bestCombo.blockName && !bestCombo.taskName) return null;

  return {
    date: today,
    start_time: null,
    end_time: null,
    hours,
    block_name: bestCombo.blockName,
    task_name: bestCombo.taskName,
    confidence: 0.8,
    notes: "Created from historical pattern suggestion",
  };
}

// --- Fuzzy name matching for batch entries (STORY-020) ---

function fuzzyNameMatch(input: string, candidates: { id: string; full_name: string }[]): { id: string; full_name: string } | null {
  const inputLower = input.trim().toLowerCase();
  if (!inputLower) return null;

  // Exact match
  const exact = candidates.find((c) => c.full_name.toLowerCase() === inputLower);
  if (exact) return exact;

  // First name match
  const firstNameMatch = candidates.find((c) => {
    const firstName = c.full_name.split(" ")[0].toLowerCase();
    return firstName === inputLower;
  });
  if (firstNameMatch) return firstNameMatch;

  // Partial / contains match
  const partial = candidates.find((c) =>
    c.full_name.toLowerCase().includes(inputLower) || inputLower.includes(c.full_name.toLowerCase()),
  );
  if (partial) return partial;

  return null;
}

// --- Core parsing ---

interface ParsedEntry {
  date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  block_name: string | null;
  task_name: string | null;
  confidence: number;
  notes: string | null;
}

interface BatchWorkerEntry {
  worker_name: string;
  entries: ParsedEntry[];
}

interface ParseResult {
  reply: string;
  needsConfirmation: boolean;
  needsClarification: boolean;
}

async function parseAndCreateEntries(
  supabase: ReturnType<typeof createClient>,
  message: string,
  worker: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null; type: string },
  messageId: string | null,
): Promise<ParseResult> {
  const lang = worker.language ?? "es";
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!apiKey) {
    const parsed = fallbackParse(message);
    if (!parsed) {
      return {
        reply: lang === "es"
          ? "No pude entender tu mensaje. Envía algo como: '8am-4pm poda bloque A'"
          : "I couldn't understand your message. Send something like: '8am-4pm pruning block A'",
        needsConfirmation: false,
        needsClarification: false,
      };
    }
    return await createEntriesAndConfirm(supabase, [parsed], worker, messageId, lang);
  }

  // Fetch context
  const [{ data: blocks }, { data: tasks }] = await Promise.all([
    supabase.from("blocks").select("name, aliases, vineyard_id, vineyards(name)"),
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
      crewDefaults = `Worker's crew: ${(crew as Record<string, unknown>).name}.`;
    }
  }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

  const blockList = (blocks ?? [])
    .map((b: Record<string, unknown>) => {
      const vineyard = b.vineyards as Record<string, unknown> | null;
      return `${b.name} (vineyard: ${vineyard?.name ?? "unknown"}, aliases: ${(b.aliases as string[])?.join(", ") ?? "none"})`;
    })
    .join("\n");

  const taskList = (tasks ?? [])
    .map((t: Record<string, unknown>) => `${t.name} (aliases: ${(t.aliases as string[])?.join(", ") ?? "none"})`)
    .join("\n");

  const systemPrompt = `You are a time entry parser for vineyard workers. Extract structured time entries from informal messages in English or Spanish. A single message may contain MULTIPLE entries (different days, blocks, or tasks).

Today is ${today} (${dayOfWeek}).

Available blocks:
${blockList || "None configured yet"}

Available tasks:
${taskList || "None configured yet"}

${crewDefaults}

Return ONLY valid JSON in this format:
{
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM" or null,
      "end_time": "HH:MM" or null,
      "hours": number,
      "block_name": string or null,
      "task_name": string or null,
      "confidence": number (0-1),
      "notes": string or null
    }
  ],
  "is_batch": false,
  "needs_clarification": boolean,
  "clarification_question_en": string or null,
  "clarification_question_es": string or null
}

If the message is from a crew lead submitting for multiple workers, return:
{
  "batch_entries": [
    {
      "worker_name": "Maria",
      "entries": [{ "date": "YYYY-MM-DD", "start_time": "HH:MM" or null, "end_time": "HH:MM" or null, "hours": number, "block_name": string or null, "task_name": string or null, "confidence": number (0-1), "notes": string or null }]
    }
  ],
  "is_batch": true,
  "needs_clarification": boolean,
  "clarification_question_en": string or null,
  "clarification_question_es": string or null
}

Batch format examples: "Team today: Maria 8h, Juan 7h, Carlos 8h pruning block A"
or "Crew hours: Maria 8am-4pm block A pruning, Juan 7am-3pm block B spraying"

If it's not a batch entry, set is_batch: false and use the regular entries array.

Rules:
- Parse ALL entries from the message. "Mon 8h pruning, Tue 6h spraying" = 2 entries.
- Resolve relative dates: "yesterday" = ${getRelativeDate(-1)}, "last Monday" = compute from today ${today}.
- If a relative date is ambiguous (e.g., "Monday" could mean last Monday or next Monday), set needs_clarification=true and provide a question like "Did you mean Monday 3/16 or Monday 3/23?"
- Hours: "8 hours", "8h", "8", "8 horas", or calculate from start/end times ("8am-4pm" = 8h)
- If worker provides start/end times, extract them. If only hours given, start_time and end_time are null.
- If no start/end times provided and only hours, gently ask in the confirmation: "Next time, try including start and end times like '8am-4pm'"
- Block matching: try exact name first, then aliases. Include vineyard context.
- Task matching: try exact name first, then aliases.
- If a task isn't in the predefined list, still accept it and put the name in task_name with a note.
- Confidence: 1.0 = all fields clear, 0.7 = using defaults, 0.5 = ambiguous, 0.3 = missing info
- If you can't extract any hours at all, return empty entries array.`;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        reply: lang === "es"
          ? "No pude entender tu mensaje. Envía algo como: '8am-4pm poda bloque A'"
          : "I couldn't understand your message. Send something like: '8am-4pm pruning block A'",
        needsConfirmation: false,
        needsClarification: false,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.needs_clarification) {
      const question = lang === "es"
        ? parsed.clarification_question_es
        : parsed.clarification_question_en;
      return {
        reply: question || (lang === "es" ? "¿Puedes aclarar las fechas?" : "Can you clarify the dates?"),
        needsConfirmation: false,
        needsClarification: true,
      };
    }

    // --- BATCH ENTRY HANDLING (STORY-020) ---
    if (parsed.is_batch) {
      return await handleBatchEntries(supabase, parsed.batch_entries ?? [], worker, messageId, lang);
    }

    const entries: ParsedEntry[] = parsed.entries ?? [];
    if (entries.length === 0) {
      return {
        reply: lang === "es"
          ? "No pude extraer horas de tu mensaje. Envía algo como: '8am-4pm poda bloque A'"
          : "I couldn't extract hours from your message. Send something like: '8am-4pm pruning block A'",
        needsConfirmation: false,
        needsClarification: false,
      };
    }

    return await createEntriesAndConfirm(supabase, entries, worker, messageId, lang);
  } catch (err) {
    console.error("AI parsing error:", err);
    const fb = fallbackParse(message);
    if (!fb) {
      return {
        reply: lang === "es"
          ? "Hubo un error procesando tu mensaje. Inténtalo de nuevo."
          : "There was an error processing your message. Please try again.",
        needsConfirmation: false,
        needsClarification: false,
      };
    }
    return await createEntriesAndConfirm(supabase, [fb], worker, messageId, lang);
  }
}

// --- Batch Entry Handler (STORY-020) ---

async function handleBatchEntries(
  supabase: ReturnType<typeof createClient>,
  batchEntries: BatchWorkerEntry[],
  sender: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null; type: string },
  messageId: string | null,
  lang: string,
): Promise<ParseResult> {
  // Crew lead check: sender must be elevated
  if (sender.type !== "elevated") {
    return {
      reply: lang === "es"
        ? "Solo los líderes de cuadrilla pueden enviar horas para otros trabajadores."
        : "Only crew leads can submit hours for other workers.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  if (!sender.crew_id) {
    return {
      reply: lang === "es"
        ? "No estás asignado a una cuadrilla. Contacta a tu supervisor."
        : "You are not assigned to a crew. Contact your supervisor.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  // Fetch crew members
  const { data: crewMembers } = await supabase
    .from("workers")
    .select("id, full_name")
    .eq("crew_id", sender.crew_id)
    .eq("is_active", true);

  if (!crewMembers || crewMembers.length === 0) {
    return {
      reply: lang === "es"
        ? "No se encontraron trabajadores en tu cuadrilla."
        : "No workers found in your crew.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  const summaryParts: string[] = [];
  const warnings: string[] = [];
  let totalEntries = 0;

  for (const batchWorker of batchEntries) {
    const matched = fuzzyNameMatch(batchWorker.worker_name, crewMembers);

    if (!matched) {
      warnings.push(
        lang === "es"
          ? `⚠ "${batchWorker.worker_name}" no encontrado en tu cuadrilla`
          : `⚠ "${batchWorker.worker_name}" not found in your crew`,
      );
      continue;
    }

    const workerEntryIds: string[] = [];

    for (const entry of batchWorker.entries) {
      const blockId = entry.block_name ? await resolveBlock(supabase, entry.block_name) : null;
      const taskId = entry.task_name ? await resolveTask(supabase, entry.task_name) : null;
      const vineyardId = blockId ? await getVineyardForBlock(supabase, blockId) : null;

      const { data: inserted } = await supabase.from("time_entries").insert({
        worker_id: matched.id,
        vineyard_id: vineyardId,
        block_id: blockId,
        task_id: taskId,
        date: entry.date,
        hours: entry.hours,
        start_time: entry.start_time ?? null,
        end_time: entry.end_time ?? null,
        status: "draft",
        source_message_id: messageId,
        ai_confidence: entry.confidence,
        notes: entry.notes ? `${entry.notes} (submitted by crew lead)` : "Submitted by crew lead",
      }).select("id").single();

      if (inserted) workerEntryIds.push(inserted.id);
      totalEntries++;

      const blockName = entry.block_name ?? "?";
      const taskName = entry.task_name ?? "?";
      const timeStr = entry.start_time && entry.end_time
        ? `${entry.start_time}-${entry.end_time}`
        : `${entry.hours}h`;
      summaryParts.push(`${matched.full_name}: ${entry.date} ${timeStr} ${taskName} @ ${blockName}`);
    }

    // Fire crew-intelligence for each matched worker (fire and forget)
    if (matched.id && sender.crew_id && workerEntryIds.length > 0) {
      const entryDate = batchWorker.entries[0]?.date ?? new Date().toISOString().split("T")[0];
      const url = Deno.env.get("SUPABASE_URL")!;
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fireCrewIntelligence(url, key, matched.id, sender.crew_id, entryDate, workerEntryIds);
    }
  }

  if (totalEntries === 0 && warnings.length > 0) {
    return {
      reply: warnings.join("\n"),
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  let reply: string;
  if (lang === "es") {
    reply = `¡Recibido! ${totalEntries} entrada(s) para tu equipo:\n${summaryParts.join("\n")}`;
    if (warnings.length > 0) reply += `\n\n${warnings.join("\n")}`;
    reply += "\n\nResponde SÍ para confirmar o describe correcciones.";
  } else {
    reply = `Got it! ${totalEntries} entry(ies) for your team:\n${summaryParts.join("\n")}`;
    if (warnings.length > 0) reply += `\n\n${warnings.join("\n")}`;
    reply += "\n\nReply YES to confirm or describe corrections.";
  }

  return { reply, needsConfirmation: true, needsClarification: false };
}

// --- Crew Intelligence Integration ---

function fireCrewIntelligence(
  supabaseUrl: string,
  serviceKey: string,
  workerId: string,
  crewId: string,
  date: string,
  entryIds: string[],
) {
  try {
    fetch(`${supabaseUrl}/functions/v1/crew-intelligence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        worker_id: workerId,
        crew_id: crewId,
        date,
        entry_ids: entryIds,
      }),
    }).then((res) => {
      if (!res.ok) {
        console.error(`crew-intelligence call failed: ${res.status}`);
      }
    }).catch((err) => {
      console.error("crew-intelligence fire-and-forget error:", err);
    });
  } catch (err) {
    console.error("crew-intelligence dispatch error:", err);
  }
}

async function createEntriesAndConfirm(
  supabase: ReturnType<typeof createClient>,
  entries: ParsedEntry[],
  worker: { id: string; language: string; crew_id?: string | null },
  messageId: string | null,
  lang: string,
): Promise<ParseResult> {
  const summaryParts: string[] = [];
  let anyMissingTimes = false;
  const createdEntryIds: string[] = [];

  for (const entry of entries) {
    const blockId = entry.block_name ? await resolveBlock(supabase, entry.block_name) : null;
    const taskId = entry.task_name ? await resolveTask(supabase, entry.task_name) : null;
    const vineyardId = blockId ? await getVineyardForBlock(supabase, blockId) : null;

    const { data: inserted } = await supabase.from("time_entries").insert({
      worker_id: worker.id,
      vineyard_id: vineyardId,
      block_id: blockId,
      task_id: taskId,
      date: entry.date,
      hours: entry.hours,
      start_time: entry.start_time ?? null,
      end_time: entry.end_time ?? null,
      status: "draft",
      source_message_id: messageId,
      ai_confidence: entry.confidence,
      notes: entry.notes,
    }).select("id").single();

    if (inserted) createdEntryIds.push(inserted.id);

    if (!entry.start_time || !entry.end_time) anyMissingTimes = true;

    const blockName = entry.block_name ?? "?";
    const taskName = entry.task_name ?? "?";
    const timeStr = entry.start_time && entry.end_time
      ? `${entry.start_time}-${entry.end_time}`
      : `${entry.hours}h`;
    summaryParts.push(`${entry.date}: ${timeStr} ${taskName} @ ${blockName}`);
  }

  // Fire crew-intelligence after creating entries (fire and forget)
  if (worker.crew_id && createdEntryIds.length > 0) {
    const entryDate = entries[0]?.date ?? new Date().toISOString().split("T")[0];
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fireCrewIntelligence(url, key, worker.id, worker.crew_id, entryDate, createdEntryIds);
  }

  let reply: string;
  if (lang === "es") {
    reply = `¡Recibido! ${entries.length} entrada(s):\n${summaryParts.join("\n")}\n\nResponde SÍ para confirmar o describe correcciones.`;
    if (anyMissingTimes) reply += "\n\nTip: incluye hora de inicio y fin, ej: '8am-4pm'";
  } else {
    reply = `Got it! ${entries.length} entry(ies):\n${summaryParts.join("\n")}\n\nReply YES to confirm or describe corrections.`;
    if (anyMissingTimes) reply += "\n\nTip: include start & end times, e.g. '8am-4pm'";
  }

  return { reply, needsConfirmation: true, needsClarification: false };
}

function getRelativeDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAgo);
  return d.toISOString().split("T")[0];
}

function fallbackParse(message: string): ParsedEntry | null {
  const hoursMatch = message.match(/(\d+\.?\d*)\s*(hours?|horas?|hrs?|h)\b/i);
  if (!hoursMatch) {
    const numMatch = message.match(/\b(\d+\.?\d*)\b/);
    if (!numMatch) return null;
    return {
      date: new Date().toISOString().split("T")[0],
      start_time: null, end_time: null,
      hours: parseFloat(numMatch[1]),
      block_name: null, task_name: null,
      confidence: 0.3,
      notes: "Parsed by fallback — only hours extracted",
    };
  }
  return {
    date: new Date().toISOString().split("T")[0],
    start_time: null, end_time: null,
    hours: parseFloat(hoursMatch[1]),
    block_name: null, task_name: null,
    confidence: 0.5,
    notes: "Parsed by fallback",
  };
}

// --- Weekly summary change parser ---
// Parses corrections to a weekly summary and upserts time entries.
// Workers reply with things like: "Mon was 6h not 8h", "I didn't work Wed",
// "Tue 8am-3pm pruning block B, Thu was 9h"

async function parseWeeklyChanges(
  supabase: ReturnType<typeof createClient>,
  message: string,
  worker: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null },
  messageId: string | null,
  weekStart: string,
  weekEnd: string,
): Promise<ParseResult> {
  const lang = worker.language ?? "es";
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!apiKey) {
    return {
      reply: lang === "es"
        ? "No pude procesar tus cambios. Contacta a tu supervisor."
        : "Couldn't process your changes. Contact your supervisor.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  // Fetch current entries for the week
  const { data: currentEntries } = await supabase
    .from("time_entries")
    .select("id, date, hours, start_time, end_time, block_id, task_id, blocks(name), tasks(name)")
    .eq("worker_id", worker.id)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .order("date");

  const currentSummary = (currentEntries ?? [])
    .map((e: Record<string, unknown>) => {
      const d = new Date((e.date as string) + "T00:00:00");
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const block = (e.blocks as Record<string, unknown> | null)?.name ?? "?";
      const task = (e.tasks as Record<string, unknown> | null)?.name ?? "?";
      const timeStr = e.start_time && e.end_time ? `${e.start_time}-${e.end_time}` : `${e.hours}h`;
      return `${dayNames[d.getDay()]} ${e.date}: ${timeStr} ${task} @ ${block} (entry_id: ${e.id})`;
    })
    .join("\n");

  // Fetch blocks and tasks for context
  const [{ data: blocks }, { data: tasks }] = await Promise.all([
    supabase.from("blocks").select("name, aliases"),
    supabase.from("tasks").select("name, aliases"),
  ]);

  const blockList = (blocks ?? [])
    .map((b: Record<string, unknown>) => `${b.name} (aliases: ${(b.aliases as string[])?.join(", ") ?? "none"})`)
    .join("\n");
  const taskList = (tasks ?? [])
    .map((t: Record<string, unknown>) => `${t.name} (aliases: ${(t.aliases as string[])?.join(", ") ?? "none"})`)
    .join("\n");

  const systemPrompt = `You are processing corrections to a weekly timesheet. The worker is replying to their weekly summary with changes.

Week: ${weekStart} to ${weekEnd}

Current entries:
${currentSummary || "No entries"}

Available blocks:
${blockList || "None"}

Available tasks:
${taskList || "None"}

The worker's correction message may:
- Change hours for a specific day: "Mon was 6h not 8h"
- Remove a day: "I didn't work Wed" or "remove Wednesday"
- Add a missing day: "I also worked Fri 8h pruning block A"
- Change the block/task: "Tue was at block B not block A"
- Provide multiple changes at once

Return ONLY valid JSON:
{
  "changes": [
    {
      "action": "update" | "delete" | "add",
      "entry_id": "uuid" | null,
      "date": "YYYY-MM-DD",
      "hours": number | null,
      "start_time": "HH:MM" | null,
      "end_time": "HH:MM" | null,
      "block_name": string | null,
      "task_name": string | null,
      "notes": string | null
    }
  ],
  "summary_en": "Brief description of changes made",
  "summary_es": "Breve descripción de los cambios realizados"
}

Rules:
- For "update": match to an existing entry_id from the current entries list. Set only the fields being changed.
- For "delete": set entry_id to the entry being removed. Other fields can be null.
- For "add": entry_id is null. Must include date and hours at minimum.
- Resolve day names to actual dates within the week ${weekStart} to ${weekEnd}.
- Mon=${weekStart}, Tue=+1, Wed=+2, Thu=+3, Fri=+4, Sat=+5, Sun=+6.`;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        reply: lang === "es"
          ? "No pude entender tus cambios. Intenta ser más específico, ej: 'Lunes fueron 6h, no trabajé el miércoles'"
          : "I couldn't understand your changes. Try being more specific, e.g. 'Monday was 6h, I didn't work Wednesday'",
        needsConfirmation: false,
        needsClarification: false,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const changes = parsed.changes ?? [];

    if (changes.length === 0) {
      return {
        reply: lang === "es"
          ? "No encontré cambios en tu mensaje. ¿Puedes ser más específico?"
          : "I didn't find any changes in your message. Can you be more specific?",
        needsConfirmation: false,
        needsClarification: false,
      };
    }

    // Apply changes
    let updatedCount = 0;
    let deletedCount = 0;
    let addedCount = 0;

    for (const change of changes) {
      if (change.action === "delete" && change.entry_id) {
        await supabase.from("time_entries").delete().eq("id", change.entry_id).eq("worker_id", worker.id);
        deletedCount++;
      } else if (change.action === "update" && change.entry_id) {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (change.hours != null) updates.hours = change.hours;
        if (change.start_time) updates.start_time = change.start_time;
        if (change.end_time) updates.end_time = change.end_time;
        if (change.block_name) {
          const blockId = await resolveBlock(supabase, change.block_name);
          if (blockId) {
            updates.block_id = blockId;
            updates.vineyard_id = await getVineyardForBlock(supabase, blockId);
          }
        }
        if (change.task_name) {
          const taskId = await resolveTask(supabase, change.task_name);
          if (taskId) updates.task_id = taskId;
        }
        if (change.notes) updates.notes = change.notes;
        await supabase.from("time_entries").update(updates).eq("id", change.entry_id).eq("worker_id", worker.id);
        updatedCount++;
      } else if (change.action === "add" && change.date && change.hours) {
        const blockId = change.block_name ? await resolveBlock(supabase, change.block_name) : null;
        const taskId = change.task_name ? await resolveTask(supabase, change.task_name) : null;
        const vineyardId = blockId ? await getVineyardForBlock(supabase, blockId) : null;
        await supabase.from("time_entries").insert({
          worker_id: worker.id,
          date: change.date,
          hours: change.hours,
          start_time: change.start_time ?? null,
          end_time: change.end_time ?? null,
          vineyard_id: vineyardId,
          block_id: blockId,
          task_id: taskId,
          status: "draft",
          source_message_id: messageId,
          ai_confidence: 0.8,
          notes: change.notes ?? "Added via weekly summary correction",
        });
        addedCount++;
      }
    }

    // Rebuild summary after changes
    const { data: updatedEntries } = await supabase
      .from("time_entries")
      .select("date, hours, start_time, end_time, blocks(name), tasks(name)")
      .eq("worker_id", worker.id)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date");

    const newTotal = (updatedEntries ?? []).reduce((sum: number, e: Record<string, unknown>) => sum + Number(e.hours), 0);

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const breakdown = (updatedEntries ?? [])
      .map((e: Record<string, unknown>) => {
        const d = new Date((e.date as string) + "T00:00:00");
        const timeStr = e.start_time && e.end_time ? `${e.start_time}-${e.end_time}` : `${e.hours}h`;
        return `${dayNames[d.getDay()]} ${timeStr}`;
      })
      .join(", ");

    const changeSummary = parsed[lang === "es" ? "summary_es" : "summary_en"] ?? "";

    let reply: string;
    if (lang === "es") {
      reply = `Cambios aplicados: ${changeSummary}\n\nResumen actualizado (${newTotal}h): ${breakdown}\n\nResponde con C si es correcto.`;
    } else {
      reply = `Changes applied: ${changeSummary}\n\nUpdated summary (${newTotal}h): ${breakdown}\n\nReply with C if this is correct.`;
    }

    // Update the weekly summary totals
    await supabase
      .from("weekly_summaries")
      .update({
        total_hours: newTotal,
        total_pay: newTotal * (Number((await supabase.from("workers").select("hourly_rate").eq("id", worker.id).single()).data?.hourly_rate) || 0),
        updated_at: new Date().toISOString(),
      })
      .eq("worker_id", worker.id)
      .eq("week_start", weekStart);

    return { reply, needsConfirmation: true, needsClarification: false };
  } catch (err) {
    console.error("parseWeeklyChanges error:", err);
    return {
      reply: lang === "es"
        ? "Hubo un error procesando tus cambios. Inténtalo de nuevo."
        : "There was an error processing your changes. Please try again.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }
}

async function resolveBlock(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const { data: exact } = await supabase
    .from("blocks").select("id").ilike("name", `%${name}%`).limit(1).single();
  if (exact) return exact.id;
  const { data: blocks } = await supabase.from("blocks").select("id, aliases");
  const match = (blocks ?? []).find((b: { id: string; aliases: string[] }) =>
    b.aliases?.some((a: string) =>
      a.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.toLowerCase()),
    ),
  );
  return match?.id ?? null;
}

async function resolveTask(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const { data: exact } = await supabase
    .from("tasks").select("id").ilike("name", `%${name}%`).limit(1).single();
  if (exact) return exact.id;
  const { data: tasks } = await supabase.from("tasks").select("id, aliases");
  const match = (tasks ?? []).find((t: { id: string; aliases: string[] }) =>
    t.aliases?.some((a: string) =>
      a.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.toLowerCase()),
    ),
  );
  return match?.id ?? null;
}

async function getVineyardForBlock(
  supabase: ReturnType<typeof createClient>,
  blockId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("blocks").select("vineyard_id").eq("id", blockId).single();
  return data?.vineyard_id ?? null;
}
