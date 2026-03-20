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
      return jsonOk("This number is not registered.");
    }

    // Check conversation state
    const { data: convState } = await supabase
      .from("conversation_state")
      .select("state, pending_entry_id, context")
      .eq("worker_id", worker.id)
      .single();

    const currentState = convState?.state ?? "idle";
    const upperMsg = body.trim().toUpperCase();
    const lang = detectMessageLanguage(body) ?? worker.language ?? "es";

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

          // Queue for supervisor review
          await queueForSupervisorReview(
            supabase, supabaseUrl, supabaseServiceKey,
            worker, summaryWeekStart, summaryWeekEnd ?? getSundayFromMonday(summaryWeekStart),
          );
        }

        await resetState(supabase, worker.id);

        const reply = lang === "es"
          ? "¡Confirmado! Tus horas han sido registradas. Tu supervisor será notificado."
          : "Confirmed! Your hours have been logged. Your supervisor will be notified.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
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
        return jsonOk(reply);
      }

      // Not C/YES/NO — treat as changes (corrections)
      // If this is a weekly summary confirmation, parse changes and upsert entries
      if (isWeeklySummary && summaryWeekStart && summaryWeekEnd) {
        const result = await parseWeeklyChanges(
          supabase, body, worker, rawMsg?.id ?? null, summaryWeekStart, summaryWeekEnd, lang,
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

      const result = await parseAndCreateEntries(supabase, combinedMsg, worker, rawMsg?.id ?? null, lang);
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
        return jsonOk(result.reply);
      }

      // Not YES — treat as a new message, reset and fall through to AI parsing
      await resetState(supabase, worker.id);
      // Fall through to handle as new entry
    }

    // --- AWAITING SUPERVISOR REVIEW ---
    if (currentState === "awaiting_supervisor_review") {
      const ctx = convState?.context as Record<string, unknown> | null;
      const weekStart = ctx?.week_start as string;
      const weekEnd = ctx?.week_end as string;
      const reviewWorkers = ctx?.workers as Array<{ id: string; name: string; summary_id: string }> | null;

      if (!weekStart || !reviewWorkers || reviewWorkers.length === 0) {
        await resetState(supabase, worker.id);
        const reply = lang === "es"
          ? "Error en la revisión. Usa el panel de control."
          : "Review error. Please use the dashboard.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
      }

      // Supervisor approves all
      if (["YES", "SÍ", "SI", "Y", "S", "C", "OK"].includes(upperMsg)) {
        for (const rw of reviewWorkers) {
          // Update time entries
          await supabase
            .from("time_entries")
            .update({ status: "boss_approved" })
            .eq("worker_id", rw.id)
            .eq("status", "worker_confirmed")
            .gte("date", weekStart)
            .lte("date", weekEnd);

          // Update weekly summary
          await supabase
            .from("weekly_summaries")
            .update({ status: "boss_approved", boss_approved_at: new Date().toISOString() })
            .eq("id", rw.summary_id);

          // Update queue
          await supabase
            .from("supervisor_review_queue")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("supervisor_id", worker.id)
            .eq("worker_id", rw.id)
            .eq("week_start", weekStart);

          // Audit log
          await supabase.from("approval_log").insert({
            summary_id: rw.summary_id,
            action: "supervisor_sms_approved",
            performed_by: worker.id,
            actor_role: "supervisor",
            notes: "Approved via SMS",
          });
        }

        await resetState(supabase, worker.id);
        const reply = lang === "es"
          ? `¡Aprobado! ${reviewWorkers.length} resumen(es) enviados para aprobación final.`
          : `Approved! ${reviewWorkers.length} summary(ies) forwarded for final approval.`;
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
      }

      // Supervisor sends changes — parse them with AI
      const changeResult = await parseSupervisorChanges(
        supabase, body, worker, reviewWorkers, weekStart, weekEnd, lang,
      );

      if (!changeResult.hasChanges) {
        // Couldn't parse — ask again
        const reply = lang === "es"
          ? "No entendí los cambios. Responde OK para aprobar todo, o especifica cambios como: 'Maria lun 6h, Juan quitar vie'"
          : "I didn't understand the changes. Reply OK to approve all, or specify changes like: 'Maria Mon 6h, Juan remove Fri'";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
      }

      // Apply changes and notify affected workers
      for (const workerChange of changeResult.workerChanges) {
        const rw = reviewWorkers.find((r) => r.id === workerChange.workerId);
        if (!rw) continue;

        if (workerChange.payAffecting) {
          // Apply the changes to entries
          for (const ch of workerChange.changes) {
            if (ch.action === "update" && ch.entryId) {
              const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
              if (ch.hours != null) updates.hours = ch.hours;
              if (ch.startTime) updates.start_time = ch.startTime;
              if (ch.endTime) updates.end_time = ch.endTime;
              await supabase.from("time_entries").update(updates).eq("id", ch.entryId);
            } else if (ch.action === "delete" && ch.entryId) {
              await supabase.from("time_entries").delete().eq("id", ch.entryId);
            }
          }

          // Recalculate weekly summary
          const { data: updatedEntries } = await supabase
            .from("time_entries")
            .select("hours")
            .eq("worker_id", workerChange.workerId)
            .gte("date", weekStart)
            .lte("date", weekEnd);
          const newTotal = (updatedEntries ?? []).reduce((s: number, e: { hours: number }) => s + Number(e.hours), 0);
          const { data: wkr } = await supabase.from("workers").select("hourly_rate").eq("id", workerChange.workerId).single();
          const rate = Number(wkr?.hourly_rate) || 0;
          await supabase.from("weekly_summaries").update({
            total_hours: newTotal,
            total_pay: newTotal * rate,
            updated_at: new Date().toISOString(),
          }).eq("id", rw.summary_id);

          // Update queue with changes
          await supabase.from("supervisor_review_queue").update({
            status: "changes_pending",
            supervisor_changes: workerChange.changes,
            updated_at: new Date().toISOString(),
          }).eq("supervisor_id", worker.id).eq("worker_id", workerChange.workerId).eq("week_start", weekStart);

          // Notify worker of pay-affecting changes
          const targetWorker = await supabase.from("workers").select("phone, language, full_name").eq("id", workerChange.workerId).single();
          if (targetWorker.data?.phone) {
            const wLang = targetWorker.data.language ?? "es";
            let changeDesc = workerChange.changeDescription;
            const notifyMsg = wLang === "es"
              ? `Tu supervisor ajustó tus horas (${weekStart}):\n${changeDesc}\nNuevo total: ${newTotal}h ($${(newTotal * rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})\nResponde OK para aceptar o explica por qué no estás de acuerdo.`
              : `Your supervisor adjusted your hours (${weekStart}):\n${changeDesc}\nNew total: ${newTotal}h ($${(newTotal * rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})\nReply OK to accept or explain why you disagree.`;
            await sendReply(supabaseUrl, supabaseServiceKey, targetWorker.data.phone, notifyMsg, workerChange.workerId);

            // Set worker conversation state
            await supabase.from("conversation_state").upsert({
              worker_id: workerChange.workerId,
              state: "awaiting_change_response",
              pending_entry_id: null,
              context: {
                type: "supervisor_change",
                supervisor_id: worker.id,
                week_start: weekStart,
                summary_id: rw.summary_id,
                changes: workerChange.changes,
              },
            }, { onConflict: "worker_id" });
          }

          // Audit log
          await supabase.from("approval_log").insert({
            summary_id: rw.summary_id,
            action: "supervisor_sms_edited",
            performed_by: worker.id,
            actor_role: "supervisor",
            previous_value: { description: "original hours" },
            new_value: { changes: workerChange.changes },
            notes: `Supervisor edited via SMS: ${workerChange.changeDescription}`,
          });
        } else {
          // Non-pay-affecting changes — approve directly
          await supabase.from("time_entries")
            .update({ status: "boss_approved" })
            .eq("worker_id", rw.id)
            .eq("status", "worker_confirmed")
            .gte("date", weekStart)
            .lte("date", weekEnd);

          await supabase.from("weekly_summaries")
            .update({ status: "boss_approved", boss_approved_at: new Date().toISOString() })
            .eq("id", rw.summary_id);

          await supabase.from("supervisor_review_queue").update({
            status: "completed", updated_at: new Date().toISOString(),
          }).eq("supervisor_id", worker.id).eq("worker_id", rw.id).eq("week_start", weekStart);

          await supabase.from("approval_log").insert({
            summary_id: rw.summary_id,
            action: "supervisor_sms_approved",
            performed_by: worker.id,
            actor_role: "supervisor",
            notes: "Approved via SMS (no pay-affecting changes)",
          });
        }
      }

      // Approve workers not mentioned in changes
      for (const rw of reviewWorkers) {
        const wasChanged = changeResult.workerChanges.some((wc) => wc.workerId === rw.id);
        if (!wasChanged) {
          await supabase.from("time_entries")
            .update({ status: "boss_approved" })
            .eq("worker_id", rw.id)
            .eq("status", "worker_confirmed")
            .gte("date", weekStart)
            .lte("date", weekEnd);

          await supabase.from("weekly_summaries")
            .update({ status: "boss_approved", boss_approved_at: new Date().toISOString() })
            .eq("id", rw.summary_id);

          await supabase.from("supervisor_review_queue").update({
            status: "completed", updated_at: new Date().toISOString(),
          }).eq("supervisor_id", worker.id).eq("worker_id", rw.id).eq("week_start", weekStart);

          await supabase.from("approval_log").insert({
            summary_id: rw.summary_id,
            action: "supervisor_sms_approved",
            performed_by: worker.id,
            actor_role: "supervisor",
            notes: "Approved via SMS (not mentioned in changes)",
          });
        }
      }

      await resetState(supabase, worker.id);

      const changedNames = changeResult.workerChanges
        .filter((wc) => wc.payAffecting)
        .map((wc) => wc.workerName);
      let reply: string;
      if (changedNames.length > 0) {
        reply = lang === "es"
          ? `Cambios aplicados. ${changedNames.join(", ")} será(n) notificado(s) de los cambios de pago. Los demás están aprobados.`
          : `Changes applied. ${changedNames.join(", ")} will be notified of pay changes. Others approved.`;
      } else {
        reply = lang === "es"
          ? "Cambios aplicados y aprobados."
          : "Changes applied and approved.";
      }
      await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
      return jsonOk(reply);
    }

    // --- AWAITING WORKER CHANGE RESPONSE ---
    if (currentState === "awaiting_change_response") {
      const ctx = convState?.context as Record<string, unknown> | null;
      const supervisorId = ctx?.supervisor_id as string;
      const weekStart = ctx?.week_start as string;
      const summaryId = ctx?.summary_id as string;

      if (!supervisorId || !weekStart || !summaryId) {
        await resetState(supabase, worker.id);
        // Fall through to normal parsing
      } else if (["YES", "SÍ", "SI", "Y", "S", "C", "OK"].includes(upperMsg)) {
        // Worker accepts supervisor's changes
        await supabase.from("time_entries")
          .update({ status: "boss_approved" })
          .eq("worker_id", worker.id)
          .gte("date", weekStart)
          .in("status", ["worker_confirmed", "draft"]);

        await supabase.from("weekly_summaries")
          .update({ status: "boss_approved", boss_approved_at: new Date().toISOString() })
          .eq("id", summaryId);

        await supabase.from("supervisor_review_queue").update({
          status: "completed",
          worker_response: "accepted",
          updated_at: new Date().toISOString(),
        }).eq("supervisor_id", supervisorId).eq("worker_id", worker.id).eq("week_start", weekStart);

        await supabase.from("approval_log").insert({
          summary_id: summaryId,
          action: "worker_change_accepted",
          performed_by: worker.id,
          actor_role: "worker",
          notes: "Worker accepted supervisor changes via SMS",
        });

        await resetState(supabase, worker.id);
        const reply = lang === "es"
          ? "Cambios aceptados. Tus horas actualizadas han sido enviadas."
          : "Changes accepted. Your updated hours have been submitted.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
      } else {
        // Worker rejects — their message is the reason
        const reason = body.trim();

        await supabase.from("supervisor_review_queue").update({
          status: "disputed",
          worker_response: "rejected",
          worker_rejection_reason: reason,
          updated_at: new Date().toISOString(),
        }).eq("supervisor_id", supervisorId).eq("worker_id", worker.id).eq("week_start", weekStart);

        await supabase.from("weekly_summaries")
          .update({ status: "disputed", updated_at: new Date().toISOString() })
          .eq("id", summaryId);

        await supabase.from("approval_log").insert({
          summary_id: summaryId,
          action: "worker_change_rejected",
          performed_by: worker.id,
          actor_role: "worker",
          notes: `Worker rejected changes: ${reason}`,
        });

        // Notify supervisor
        const { data: supervisor } = await supabase.from("workers")
          .select("phone, language").eq("id", supervisorId).single();
        if (supervisor?.phone) {
          const sLang = supervisor.language ?? "es";
          const notifyMsg = sLang === "es"
            ? `${worker.full_name} rechazó los cambios de horas: "${reason}". Revisa en el panel de control.`
            : `${worker.full_name} rejected the hour changes: "${reason}". Review on the dashboard.`;
          await sendReply(supabaseUrl, supabaseServiceKey, supervisor.phone, notifyMsg, supervisorId);
        }

        await resetState(supabase, worker.id);
        const reply = lang === "es"
          ? "Tu respuesta ha sido registrada. Tu supervisor será notificado."
          : "Your response has been recorded. Your supervisor will be notified.";
        await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, reply, worker.id);
        return jsonOk(reply);
      }
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
    const result = await parseAndCreateEntries(supabase, body, worker, rawMsg?.id ?? null, lang);

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
      return jsonOk(result.reply);
    }

    if (result.needsConfirmation) {
      await supabase.from("conversation_state").upsert(
        { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
        { onConflict: "worker_id" },
      );
    }

    await sendReply(supabaseUrl, supabaseServiceKey, worker.phone!, result.reply, worker.id);
    return jsonOk(result.reply);
  } catch (err) {
    console.error("sms-webhook error:", err);
    return jsonOk();
  }
});

// --- Language Detection ---

function detectMessageLanguage(text: string): "en" | "es" | null {
  const lower = text.toLowerCase();

  const esPatterns = [
    /\bhoras?\b/, /\btrabaj[éeao]\b/, /\bbloque\b/, /\bpoda\b/,
    /\blunes\b/, /\bmartes\b/, /\bmi[ée]rcoles\b/, /\bjueves\b/, /\bviernes\b/,
    /\bs[áa]bado\b/, /\bdomingo\b/, /\bayer\b/, /\bhoy\b/,
    /[áéíóúñ¿¡]/, /\bno\s+trabaj/, /\bquitar\b/, /\bfueron?\b/,
    /\bsemana\b/, /\bcambiar\b/, /\bcorrecto\b/,
  ];

  const enPatterns = [
    /\bhours?\b/, /\bworked?\b/, /\bblock\b/, /\bpruning\b/, /\bspraying\b/,
    /\bmonday\b/, /\btuesday\b/, /\bwednesday\b/, /\bthursday\b/, /\bfriday\b/,
    /\bsaturday\b/, /\bsunday\b/, /\byesterday\b/, /\btoday\b/,
    /\bdidn'?t\s+work/, /\bremove\b/, /\bweek\b/, /\bchange\b/, /\bcorrect\b/,
  ];

  let esScore = 0;
  let enScore = 0;

  for (const p of esPatterns) {
    if (p.test(lower)) esScore++;
  }
  for (const p of enPatterns) {
    if (p.test(lower)) enScore++;
  }

  if (esScore > enScore) return "es";
  if (enScore > esScore) return "en";
  return null;
}

// --- Helpers ---

function jsonOk(reply?: string): Response {
  return new Response(JSON.stringify({ ok: true, reply: reply ?? null }), {
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
  // Log the outbound message directly in raw_messages (guaranteed to persist).
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  await supabase.from("raw_messages").insert({
    twilio_sid: `OUT_${Date.now()}`,
    from_number: "system",
    body: message,
    worker_id: workerId,
    direction: "outbound",
  });

  // Fire-and-forget actual SMS delivery via send-sms edge function.
  // Don't await — we don't want delivery failures to block the response.
  fetch(`${supabaseUrl}/functions/v1/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({ to: phone, body: message, worker_id: workerId }),
  }).catch((err) => console.error("send-sms fire-and-forget error:", err));
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

// --- Fuzzy name matching with ambiguity detection ---

interface NameMatchResult {
  match: { id: string; full_name: string } | null;
  ambiguous: boolean;
  candidates: { id: string; full_name: string }[];
}

function fuzzyNameMatchWithAmbiguity(
  input: string,
  candidates: { id: string; full_name: string }[],
): NameMatchResult {
  const inputLower = input.trim().toLowerCase();
  if (!inputLower) return { match: null, ambiguous: false, candidates: [] };

  // Exact full name match — always unambiguous
  const exact = candidates.find((c) => c.full_name.toLowerCase() === inputLower);
  if (exact) return { match: exact, ambiguous: false, candidates: [] };

  // "First Last" or "First L" match
  const inputParts = inputLower.split(/\s+/);
  if (inputParts.length >= 2) {
    const [inputFirst, ...inputRest] = inputParts;
    const inputLastPart = inputRest.join(" ");

    // Try full last name match first
    const fullMatch = candidates.find((c) => {
      const parts = c.full_name.toLowerCase().split(/\s+/);
      if (parts.length < 2) return false;
      return parts[0] === inputFirst && parts.slice(1).join(" ").startsWith(inputLastPart);
    });
    if (fullMatch) return { match: fullMatch, ambiguous: false, candidates: [] };

    // Try last initial match (e.g., "Andrew F")
    if (inputRest.length === 1 && inputRest[0].length === 1) {
      const initial = inputRest[0];
      const initialMatches = candidates.filter((c) => {
        const parts = c.full_name.toLowerCase().split(/\s+/);
        return parts[0] === inputFirst && parts.length >= 2 && parts[parts.length - 1].startsWith(initial);
      });
      if (initialMatches.length === 1) return { match: initialMatches[0], ambiguous: false, candidates: [] };
      if (initialMatches.length > 1) return { match: null, ambiguous: true, candidates: initialMatches };
    }
  }

  // First name only — check for uniqueness
  const firstNameMatches = candidates.filter((c) => {
    const firstName = c.full_name.split(/\s+/)[0].toLowerCase();
    return firstName === inputLower;
  });

  if (firstNameMatches.length === 1) return { match: firstNameMatches[0], ambiguous: false, candidates: [] };
  if (firstNameMatches.length > 1) return { match: null, ambiguous: true, candidates: firstNameMatches };

  // Partial / contains match
  const partialMatches = candidates.filter((c) =>
    c.full_name.toLowerCase().includes(inputLower) || inputLower.includes(c.full_name.toLowerCase()),
  );
  if (partialMatches.length === 1) return { match: partialMatches[0], ambiguous: false, candidates: [] };
  if (partialMatches.length > 1) return { match: null, ambiguous: true, candidates: partialMatches };

  return { match: null, ambiguous: false, candidates: [] };
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
  lang: string,
): Promise<ParseResult> {
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

  // Fetch recent conversation history for context (inbound only to avoid JSON noise)
  const { data: recentMsgs } = await supabase
    .from("raw_messages")
    .select("body, direction, created_at")
    .eq("worker_id", worker.id)
    .order("created_at", { ascending: false })
    .limit(6);

  let conversationContext = "";
  if (recentMsgs && recentMsgs.length > 1) {
    // Show recent messages but truncate long system replies to avoid JSON in context
    const history = [...recentMsgs].reverse().slice(0, -1).map((m: Record<string, unknown>) => {
      const role = m.direction === "inbound" ? "Worker" : "System";
      const body = String(m.body ?? "");
      const truncated = body.length > 120 ? body.slice(0, 120) + "..." : body;
      return `${role}: ${truncated}`;
    }).join("\n");
    conversationContext = `\nRecent conversation (for context only — do NOT re-extract old entries):\n${history}\n\nIf the current message references previous messages (e.g. "same thing today", "actually 7h not 8", "block B not A"), use the context to understand it.\n`;
  }

  const systemPrompt = `You are a time entry parser for vineyard workers. Extract structured time entries from informal messages in English or Spanish. Detect the language of the incoming message and always provide clarification questions in the same language the worker used. A single message may contain MULTIPLE entries (different days, blocks, or tasks).

Today is ${today} (${dayOfWeek}).
${conversationContext}
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
  // Fetch all active workers for name matching (any worker can submit for anyone)
  const { data: allWorkers } = await supabase
    .from("workers")
    .select("id, full_name")
    .eq("is_active", true);

  if (!allWorkers || allWorkers.length === 0) {
    return {
      reply: lang === "es"
        ? "No se encontraron trabajadores activos."
        : "No active workers found.",
      needsConfirmation: false,
      needsClarification: false,
    };
  }

  const workerSummaries: string[] = [];
  const warnings: string[] = [];
  const ambiguous: string[] = [];
  let totalEntries = 0;

  for (const batchWorker of batchEntries) {
    const matchResult = fuzzyNameMatchWithAmbiguity(batchWorker.worker_name, allWorkers);

    if (matchResult.ambiguous) {
      const names = matchResult.candidates.map((c) => c.full_name).join(", ");
      ambiguous.push(
        lang === "es"
          ? `"${batchWorker.worker_name}" es ambiguo. ¿Cuál? ${names}. Usa apellido o inicial.`
          : `"${batchWorker.worker_name}" is ambiguous. Which one? ${names}. Use last name or initial.`,
      );
      continue;
    }

    const matched = matchResult.match;
    if (!matched) {
      warnings.push(
        lang === "es"
          ? `⚠ "${batchWorker.worker_name}" no encontrado`
          : `⚠ "${batchWorker.worker_name}" not found`,
      );
      continue;
    }

    const workerEntryIds: string[] = [];
    const entryLines: string[] = [];

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
        notes: entry.notes ? `${entry.notes} (submitted by ${sender.full_name})` : `Submitted by ${sender.full_name}`,
      }).select("id").single();

      if (inserted) workerEntryIds.push(inserted.id);
      totalEntries++;

      const blockName = entry.block_name ?? "?";
      const taskName = entry.task_name ?? "?";
      const timeStr = entry.start_time && entry.end_time
        ? `${entry.start_time}-${entry.end_time}`
        : `${entry.hours}h`;
      entryLines.push(`  ${entry.date} ${timeStr} ${taskName} @ ${blockName}`);
    }

    workerSummaries.push(`${matched.full_name}:\n${entryLines.join("\n")}`);

    // Fire crew-intelligence for each matched worker (fire and forget)
    if (matched.id && sender.crew_id && workerEntryIds.length > 0) {
      const entryDate = batchWorker.entries[0]?.date ?? new Date().toISOString().split("T")[0];
      const url = Deno.env.get("SUPABASE_URL")!;
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fireCrewIntelligence(url, key, matched.id, sender.crew_id, entryDate, workerEntryIds);
    }
  }

  const formattedSummary = workerSummaries.join("\n\n");

  // If there are ambiguous names, prompt for clarification
  if (ambiguous.length > 0) {
    let reply = ambiguous.join("\n");
    if (totalEntries > 0) {
      const processed = lang === "es"
        ? `${totalEntries} entrada(s) registrada(s):\n\n${formattedSummary}`
        : `${totalEntries} entry(ies) logged:\n\n${formattedSummary}`;
      reply = processed + "\n\n" + reply;
    }
    if (warnings.length > 0) reply += "\n" + warnings.join("\n");
    return { reply, needsConfirmation: totalEntries > 0, needsClarification: ambiguous.length > 0 };
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
    reply = `¡Recibido! ${totalEntries} entrada(s):\n\n${formattedSummary}`;
    if (warnings.length > 0) reply += `\n\n${warnings.join("\n")}`;
    reply += "\n\nResponde SÍ para confirmar o describe correcciones.";
  } else {
    reply = `Got it! ${totalEntries} entry(ies):\n\n${formattedSummary}`;
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
  lang: string,
): Promise<ParseResult> {
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

// --- Supervisor Review Helpers ---

function getSundayFromMonday(monday: string): string {
  const d = new Date(monday + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

async function findSupervisor(
  supabase: ReturnType<typeof createClient>,
  worker: { id: string; crew_id: string | null },
): Promise<{ id: string; phone: string | null; language: string; full_name: string } | null> {
  // 1. Check reports_to
  const { data: selfRow } = await supabase
    .from("workers")
    .select("reports_to")
    .eq("id", worker.id)
    .single();

  if (selfRow?.reports_to) {
    const { data: sup } = await supabase
      .from("workers")
      .select("id, phone, language, full_name")
      .eq("id", selfRow.reports_to)
      .eq("is_active", true)
      .single();
    if (sup) return sup;
  }

  // 2. Fallback: find elevated worker in same crew
  if (worker.crew_id) {
    const { data: sup } = await supabase
      .from("workers")
      .select("id, phone, language, full_name")
      .eq("crew_id", worker.crew_id)
      .eq("type", "elevated")
      .eq("is_active", true)
      .neq("id", worker.id)
      .limit(1)
      .single();
    if (sup) return sup;
  }

  return null;
}

async function queueForSupervisorReview(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  worker: { id: string; crew_id: string | null },
  weekStart: string,
  weekEnd: string,
) {
  const supervisor = await findSupervisor(supabase, worker);
  if (!supervisor || !supervisor.phone) {
    console.log(`No supervisor with phone found for worker ${worker.id}`);
    return;
  }

  // Get the summary id
  const { data: summary } = await supabase
    .from("weekly_summaries")
    .select("id")
    .eq("worker_id", worker.id)
    .eq("week_start", weekStart)
    .single();

  if (!summary) return;

  // Upsert into queue
  await supabase.from("supervisor_review_queue").upsert({
    supervisor_id: supervisor.id,
    worker_id: worker.id,
    summary_id: summary.id,
    week_start: weekStart,
    status: "pending",
    updated_at: new Date().toISOString(),
  }, { onConflict: "supervisor_id,worker_id,week_start" });

  // Check how many workers report to this supervisor and how many have confirmed
  const { data: allReports } = await supabase
    .from("workers")
    .select("id")
    .eq("reports_to", supervisor.id)
    .eq("is_active", true);

  // Also check crew-based reports if reports_to is sparse
  let reportIds = (allReports ?? []).map((w: { id: string }) => w.id);
  if (reportIds.length === 0 && worker.crew_id) {
    const { data: crewWorkers } = await supabase
      .from("workers")
      .select("id")
      .eq("crew_id", worker.crew_id)
      .eq("is_active", true)
      .neq("id", supervisor.id);
    reportIds = (crewWorkers ?? []).map((w: { id: string }) => w.id);
  }

  // Count how many have pending entries in the queue for this week
  const { data: queuedItems } = await supabase
    .from("supervisor_review_queue")
    .select("worker_id")
    .eq("supervisor_id", supervisor.id)
    .eq("week_start", weekStart)
    .eq("status", "pending");

  const queuedCount = queuedItems?.length ?? 0;
  const totalWorkers = reportIds.length;

  // Send when all workers have confirmed, or if supervisor is idle and at least one is ready
  // For now: send immediately for each confirmation (supervisor accumulates context)
  // Check if supervisor already has an active review for this week
  const { data: existingState } = await supabase
    .from("conversation_state")
    .select("state, context")
    .eq("worker_id", supervisor.id)
    .single();

  const supState = existingState?.state ?? "idle";

  if (supState === "awaiting_supervisor_review") {
    // Supervisor already reviewing — don't interrupt, they'll see it when they reply
    console.log(`Supervisor ${supervisor.id} already reviewing; queued worker ${worker.id}`);
    return;
  }

  // Send batched review to supervisor
  await sendSupervisorReviewSMS(supabase, supabaseUrl, serviceKey, supervisor, weekStart, weekEnd);
}

async function sendSupervisorReviewSMS(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  supervisor: { id: string; phone: string | null; language: string; full_name: string },
  weekStart: string,
  weekEnd: string,
) {
  if (!supervisor.phone) return;

  // Get all pending items in the queue
  const { data: queueItems, error: queueErr } = await supabase
    .from("supervisor_review_queue")
    .select("worker_id, summary_id")
    .eq("supervisor_id", supervisor.id)
    .eq("week_start", weekStart)
    .eq("status", "pending");

  if (queueErr) {
    console.error("Error fetching supervisor review queue:", queueErr);
    return;
  }
  if (!queueItems || queueItems.length === 0) return;

  const lang = supervisor.language ?? "es";
  const reviewWorkers: { id: string; name: string; summary_id: string }[] = [];
  const lines: string[] = [];

  const DAY_ABBR: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

  for (const item of queueItems) {
    const workerId = item.worker_id as string;
    const summaryId = item.summary_id as string;

    // Fetch worker name separately to avoid ambiguous FK join
    const { data: wRow } = await supabase
      .from("workers")
      .select("full_name")
      .eq("id", workerId)
      .single();
    const workerName = wRow?.full_name ?? "?";

    reviewWorkers.push({ id: workerId, name: workerName, summary_id: summaryId });

    // Fetch entries for compact breakdown
    const { data: entries } = await supabase
      .from("time_entries")
      .select("date, hours, tasks(name), blocks(name)")
      .eq("worker_id", workerId)
      .eq("status", "worker_confirmed")
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date");

    const totalH = (entries ?? []).reduce((s: number, e: Record<string, unknown>) => s + Number(e.hours), 0);

    // Get hourly rate for pay calculation
    const { data: wkr } = await supabase.from("workers").select("hourly_rate").eq("id", workerId).single();
    const rate = Number(wkr?.hourly_rate) || 0;
    const pay = totalH * rate;

    // Build compact daily breakdown
    const dayParts: string[] = [];
    for (const entry of (entries ?? [])) {
      const e = entry as Record<string, unknown>;
      const d = new Date((e.date as string) + "T00:00:00");
      const day = DAY_ABBR[d.getDay()];
      const task = (e.tasks as Record<string, unknown> | null)?.name as string ?? "";
      const block = (e.blocks as Record<string, unknown> | null)?.name as string ?? "";
      dayParts.push(`${day} ${e.hours}h ${task ? task.split(" ")[0] : ""} ${block ?? ""}`.trim());
    }

    const firstName = workerName.split(" ")[0];
    lines.push(`${firstName}: ${totalH}h $${pay.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} - ${dayParts.join(", ")}`);

    // Mark as sent
    await supabase.from("supervisor_review_queue").update({
      status: "sent_to_supervisor",
      updated_at: new Date().toISOString(),
    }).eq("supervisor_id", supervisor.id).eq("worker_id", workerId).eq("week_start", weekStart);
  }

  let message: string;
  if (lang === "es") {
    message = `Revisión semanal (${weekStart}):\n${lines.join("\n")}\n\nResponde OK para aprobar todo, o indica cambios:\nej: "Maria lun 6h, Juan quitar vie"`;
  } else {
    message = `Weekly review (${weekStart}):\n${lines.join("\n")}\n\nReply OK to approve all, or describe changes:\ne.g. "Maria Mon 6h, Juan remove Fri"`;
  }

  await sendReply(supabaseUrl, serviceKey, supervisor.phone, message, supervisor.id);

  // Set supervisor conversation state
  await supabase.from("conversation_state").upsert({
    worker_id: supervisor.id,
    state: "awaiting_supervisor_review",
    pending_entry_id: null,
    context: {
      type: "supervisor_review",
      week_start: weekStart,
      week_end: weekEnd,
      workers: reviewWorkers,
    },
  }, { onConflict: "worker_id" });
}

// --- Supervisor Change Parsing ---

interface SupervisorChange {
  action: string;
  entryId: string | null;
  date: string;
  hours: number | null;
  startTime: string | null;
  endTime: string | null;
  originalHours: number | null;
}

interface WorkerChangeResult {
  workerId: string;
  workerName: string;
  changes: SupervisorChange[];
  changeDescription: string;
  payAffecting: boolean;
}

interface SupervisorChangeParseResult {
  hasChanges: boolean;
  workerChanges: WorkerChangeResult[];
}

async function parseSupervisorChanges(
  supabase: ReturnType<typeof createClient>,
  message: string,
  supervisor: { id: string; language: string },
  reviewWorkers: Array<{ id: string; name: string; summary_id: string }>,
  weekStart: string,
  weekEnd: string,
  lang: string,
): Promise<SupervisorChangeParseResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { hasChanges: false, workerChanges: [] };

  // Build context: each worker's current entries
  const workerContextParts: string[] = [];
  for (const rw of reviewWorkers) {
    const { data: entries } = await supabase
      .from("time_entries")
      .select("id, date, hours, start_time, end_time, blocks(name), tasks(name)")
      .eq("worker_id", rw.id)
      .eq("status", "worker_confirmed")
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date");

    const DAY_ABBR: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    const entryLines = (entries ?? []).map((e: Record<string, unknown>) => {
      const d = new Date((e.date as string) + "T00:00:00");
      const block = (e.blocks as Record<string, unknown> | null)?.name ?? "?";
      const task = (e.tasks as Record<string, unknown> | null)?.name ?? "?";
      const timeStr = e.start_time && e.end_time ? `${e.start_time}-${e.end_time}` : `${e.hours}h`;
      return `  ${DAY_ABBR[d.getDay()]} ${e.date}: ${timeStr} ${task} @ ${block} (entry_id: ${e.id})`;
    }).join("\n");

    workerContextParts.push(`${rw.name} (worker_id: ${rw.id}):\n${entryLines || "  No entries"}`);
  }

  const systemPrompt = `You are parsing a supervisor's changes to their crew's weekly timesheets.

Week: ${weekStart} to ${weekEnd}
Mon=${weekStart}, Tue=+1, Wed=+2, Thu=+3, Fri=+4, Sat=+5, Sun=+6.

Workers and their current entries:
${workerContextParts.join("\n\n")}

The supervisor's message may:
- Change hours for a specific worker/day: "Maria Mon 6h" or "Maria Monday was 6 not 8"
- Remove an entry: "Juan remove Fri" or "Juan didn't work Friday"
- Change times: "Rosa Mon 7am-2pm"
- Make changes for multiple workers at once

Return ONLY valid JSON:
{
  "worker_changes": [
    {
      "worker_id": "uuid",
      "worker_name": "string",
      "changes": [
        {
          "action": "update" | "delete",
          "entry_id": "uuid",
          "date": "YYYY-MM-DD",
          "hours": number | null,
          "start_time": "HH:MM" | null,
          "end_time": "HH:MM" | null,
          "original_hours": number
        }
      ],
      "change_description": "Brief description of changes"
    }
  ]
}

Rules:
- Match worker names using first name, full name, or partial match.
- Match entry_id from the entries listed above.
- For "update": include the new hours and/or times. Include original_hours for comparison.
- For "delete": set the entry_id of the entry to remove. Include original_hours.
- Only include workers who have actual changes. Workers not mentioned are implicitly approved.`;

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
    if (!jsonMatch) return { hasChanges: false, workerChanges: [] };

    const parsed = JSON.parse(jsonMatch[0]);
    const rawChanges = parsed.worker_changes ?? [];

    if (rawChanges.length === 0) return { hasChanges: false, workerChanges: [] };

    const workerChanges: WorkerChangeResult[] = rawChanges.map((wc: Record<string, unknown>) => {
      const changes: SupervisorChange[] = ((wc.changes as Array<Record<string, unknown>>) ?? []).map((ch) => ({
        action: ch.action as string,
        entryId: (ch.entry_id as string) ?? null,
        date: ch.date as string,
        hours: ch.hours != null ? Number(ch.hours) : null,
        startTime: (ch.start_time as string) ?? null,
        endTime: (ch.end_time as string) ?? null,
        originalHours: ch.original_hours != null ? Number(ch.original_hours) : null,
      }));

      // A change is pay-affecting if hours changed or entry deleted
      const payAffecting = changes.some((ch) => {
        if (ch.action === "delete") return true;
        if (ch.hours != null && ch.originalHours != null && ch.hours !== ch.originalHours) return true;
        return false;
      });

      return {
        workerId: wc.worker_id as string,
        workerName: wc.worker_name as string,
        changes,
        changeDescription: (wc.change_description as string) ?? "",
        payAffecting,
      };
    });

    return { hasChanges: true, workerChanges };
  } catch (err) {
    console.error("parseSupervisorChanges error:", err);
    return { hasChanges: false, workerChanges: [] };
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
