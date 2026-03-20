import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the most common element in an array, or undefined if empty. */
function mode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of arr) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

/** Return the median of a numeric array. The array must be non-empty. */
function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Standard deviation of a numeric array. */
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** Invoke the send-sms edge function. */
async function sendReply(
  supabaseUrl: string,
  serviceKey: string,
  phone: string,
  message: string,
  workerId: string,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ to: phone, body: message, worker_id: workerId }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`send-sms failed for ${workerId}:`, errText);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { worker_id, crew_id, date, entry_ids } = await req.json();

    if (!worker_id || !crew_id || !date || !entry_ids?.length) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: worker_id, crew_id, date, entry_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ------------------------------------------------------------------
    // 1. Fetch all crew entries for the date
    // ------------------------------------------------------------------

    // Get all active workers in this crew
    const { data: crewWorkers, error: cwErr } = await supabase
      .from("workers")
      .select("id, full_name, phone, language")
      .eq("crew_id", crew_id)
      .eq("is_active", true);

    if (cwErr) {
      console.error("Error fetching crew workers:", cwErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch crew workers", details: cwErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const crewWorkerIds = (crewWorkers || []).map((w: { id: string }) => w.id);

    // Fetch all time entries for these workers on this date
    const { data: allEntries, error: aeErr } = await supabase
      .from("time_entries")
      .select("*")
      .in("worker_id", crewWorkerIds)
      .eq("date", date);

    if (aeErr) {
      console.error("Error fetching entries:", aeErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch time entries", details: aeErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const entries = allEntries || [];

    // Fetch crew defaults
    const { data: crew } = await supabase
      .from("crews")
      .select("default_vineyard_id, default_block_id")
      .eq("id", crew_id)
      .single();

    // ------------------------------------------------------------------
    // 2. Compute majority (mode) values from entries that have them
    // ------------------------------------------------------------------

    const vineyardIds = entries
      .filter((e: { vineyard_id: string | null }) => e.vineyard_id)
      .map((e: { vineyard_id: string }) => e.vineyard_id);
    const blockIds = entries
      .filter((e: { block_id: string | null }) => e.block_id)
      .map((e: { block_id: string }) => e.block_id);
    const taskIds = entries
      .filter((e: { task_id: string | null }) => e.task_id)
      .map((e: { task_id: string }) => e.task_id);

    const majorityVineyard = mode(vineyardIds) || crew?.default_vineyard_id || null;
    const majorityBlock = mode(blockIds) || crew?.default_block_id || null;
    const majorityTask = mode(taskIds) || null;

    // ------------------------------------------------------------------
    // 3. Cross-Fill Engine
    // ------------------------------------------------------------------

    const crossFillResults: string[] = [];

    for (const entry of entries) {
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (!entry.vineyard_id && majorityVineyard) {
        updates.vineyard_id = majorityVineyard;
        needsUpdate = true;
      }
      if (!entry.block_id && majorityBlock) {
        updates.block_id = majorityBlock;
        needsUpdate = true;
      }
      if (!entry.task_id && majorityTask) {
        updates.task_id = majorityTask;
        needsUpdate = true;
      }

      if (needsUpdate) {
        // Lower confidence by 0.2, min 0.3
        const currentConfidence = entry.ai_confidence ?? 1.0;
        updates.ai_confidence = Math.max(0.3, currentConfidence - 0.2);

        // Append cross-fill note
        const existingNotes = entry.notes || "";
        const crossFillNote = "Cross-filled from crew context";
        updates.notes = existingNotes
          ? `${existingNotes}. ${crossFillNote}`
          : crossFillNote;
        updates.updated_at = new Date().toISOString();

        const { error: updateErr } = await supabase
          .from("time_entries")
          .update(updates)
          .eq("id", entry.id);

        if (updateErr) {
          console.error(`Cross-fill update failed for entry ${entry.id}:`, updateErr);
        } else {
          crossFillResults.push(entry.id);
          // Update local copy so anomaly detection uses corrected values
          Object.assign(entry, updates);
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Auto-Generate for Unreported Workers
    // ------------------------------------------------------------------

    const reportedWorkerIds = new Set(
      entries.map((e: { worker_id: string }) => e.worker_id),
    );

    const unreportedWorkers = (crewWorkers || []).filter(
      (w: { id: string }) => !reportedWorkerIds.has(w.id),
    );

    const autoGenerated: string[] = [];

    // Only auto-generate if at least 2 crew members have reported
    if (reportedWorkerIds.size >= 2 && unreportedWorkers.length > 0) {
      const hoursArr = entries.map((e: { hours: number }) => Number(e.hours));
      const medianHours = median(hoursArr);

      const triggerEntryId = entry_ids[0];

      for (const worker of unreportedWorkers) {
        // Idempotency: check if an inferred entry already exists for this worker/date
        const { data: existing } = await supabase
          .from("time_entries")
          .select("id")
          .eq("worker_id", worker.id)
          .eq("date", date)
          .eq("source_type", "inferred")
          .limit(1);

        if (existing && existing.length > 0) {
          continue; // Already generated, skip
        }

        const { data: newEntry, error: insertErr } = await supabase
          .from("time_entries")
          .insert({
            worker_id: worker.id,
            vineyard_id: majorityVineyard,
            block_id: majorityBlock,
            task_id: majorityTask,
            date,
            hours: medianHours,
            source_type: "inferred",
            inferred_from: triggerEntryId,
            ai_confidence: 0.4,
            status: "draft",
            notes: "Auto-generated from crew data. Please confirm.",
          })
          .select()
          .single();

        if (insertErr) {
          console.error(`Auto-generate failed for worker ${worker.id}:`, insertErr);
          continue;
        }

        autoGenerated.push(newEntry.id);

        // Look up block and task names for the SMS message
        let blockName = "unknown";
        let taskName = "unknown";

        if (majorityBlock) {
          const { data: block } = await supabase
            .from("blocks")
            .select("name")
            .eq("id", majorityBlock)
            .single();
          if (block) blockName = block.name;
        }

        if (majorityTask) {
          const { data: task } = await supabase
            .from("tasks")
            .select("name")
            .eq("id", majorityTask)
            .single();
          if (task) taskName = task.name;
        }

        // Send SMS notification
        if (worker.phone) {
          const lang = worker.language || "es";
          let smsBody: string;
          if (lang === "en") {
            smsBody = `Your crew logged ${medianHours}h at ${blockName} (${taskName}) today. Did you work the same? Reply YES or send your actual hours.`;
          } else {
            smsBody = `Tu equipo registr\u00f3 ${medianHours}h en ${blockName} (${taskName}) hoy. \u00bfTrabajaste lo mismo? Responde S\u00cd o env\u00eda tus horas reales.`;
          }

          await sendReply(supabaseUrl, supabaseServiceKey, worker.phone, smsBody, worker.id);
        }

        // Set conversation_state to awaiting_confirmation
        await supabase.from("conversation_state").upsert(
          {
            worker_id: worker.id,
            state: "awaiting_confirmation",
            pending_entry_id: newEntry.id,
            context: { source: "crew_intelligence", crew_id, date },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "worker_id" },
        );
      }
    }

    // ------------------------------------------------------------------
    // 5. Anomaly Detection
    // ------------------------------------------------------------------

    // Re-fetch all entries for the date (including newly auto-generated ones)
    const { data: finalEntries } = await supabase
      .from("time_entries")
      .select("*")
      .in("worker_id", crewWorkerIds)
      .eq("date", date);

    const allFinal = finalEntries || [];
    const anomaliesInserted: string[] = [];

    // 5a. Hours variance: std dev > 1.5
    const allHours = allFinal.map((e: { hours: number }) => Number(e.hours));
    if (allHours.length >= 2 && stddev(allHours) > 1.5) {
      // Idempotency: check if this anomaly already exists
      const { data: existingAnomaly } = await supabase
        .from("anomalies")
        .select("id")
        .eq("crew_id", crew_id)
        .eq("date", date)
        .eq("type", "hours_variance")
        .limit(1);

      if (!existingAnomaly || existingAnomaly.length === 0) {
        const { data: anomaly, error: aErr } = await supabase
          .from("anomalies")
          .insert({
            crew_id,
            date,
            type: "hours_variance",
            severity: "warning",
            description: `Hours standard deviation (${stddev(allHours).toFixed(2)}) exceeds threshold of 1.5`,
            context: {
              hours: allHours,
              std_dev: stddev(allHours),
              entries: allFinal.map((e: { id: string; worker_id: string; hours: number }) => ({
                id: e.id,
                worker_id: e.worker_id,
                hours: Number(e.hours),
              })),
            },
          })
          .select("id")
          .single();

        if (aErr) {
          console.error("Failed to insert hours_variance anomaly:", aErr);
        } else if (anomaly) {
          anomaliesInserted.push(anomaly.id);
        }
      }
    }

    // 5b. Block mismatch: any member working a different block than majority
    if (majorityBlock) {
      const mismatchEntries = allFinal.filter(
        (e: { block_id: string | null }) => e.block_id && e.block_id !== majorityBlock,
      );

      for (const entry of mismatchEntries) {
        // Idempotency check
        const { data: existingAnomaly } = await supabase
          .from("anomalies")
          .select("id")
          .eq("entry_id", entry.id)
          .eq("date", date)
          .eq("type", "block_mismatch")
          .limit(1);

        if (existingAnomaly && existingAnomaly.length > 0) continue;

        const { data: anomaly, error: aErr } = await supabase
          .from("anomalies")
          .insert({
            crew_id,
            worker_id: entry.worker_id,
            entry_id: entry.id,
            date,
            type: "block_mismatch",
            severity: "warning",
            description: `Worker block (${entry.block_id}) differs from crew majority (${majorityBlock})`,
            context: {
              worker_block_id: entry.block_id,
              majority_block_id: majorityBlock,
            },
          })
          .select("id")
          .single();

        if (aErr) {
          console.error("Failed to insert block_mismatch anomaly:", aErr);
        } else if (anomaly) {
          anomaliesInserted.push(anomaly.id);
        }
      }
    }

    // 5c. Excessive hours: any worker with > 12 total hours for the date
    // Group entries by worker and sum hours
    const workerHoursMap = new Map<string, number>();
    for (const entry of allFinal) {
      const current = workerHoursMap.get(entry.worker_id) || 0;
      workerHoursMap.set(entry.worker_id, current + Number(entry.hours));
    }

    for (const [wId, totalHours] of workerHoursMap) {
      if (totalHours > 12) {
        // Idempotency check
        const { data: existingAnomaly } = await supabase
          .from("anomalies")
          .select("id")
          .eq("worker_id", wId)
          .eq("date", date)
          .eq("type", "excessive_hours")
          .limit(1);

        if (existingAnomaly && existingAnomaly.length > 0) continue;

        const { data: anomaly, error: aErr } = await supabase
          .from("anomalies")
          .insert({
            crew_id,
            worker_id: wId,
            date,
            type: "excessive_hours",
            severity: "critical",
            description: `Worker has ${totalHours} total hours for ${date}, exceeding 12-hour threshold`,
            context: {
              total_hours: totalHours,
              entries: allFinal
                .filter((e: { worker_id: string }) => e.worker_id === wId)
                .map((e: { id: string; hours: number }) => ({
                  id: e.id,
                  hours: Number(e.hours),
                })),
            },
          })
          .select("id")
          .single();

        if (aErr) {
          console.error("Failed to insert excessive_hours anomaly:", aErr);
        } else if (anomaly) {
          anomaliesInserted.push(anomaly.id);
        }
      }
    }

    // ------------------------------------------------------------------
    // 6. Response
    // ------------------------------------------------------------------

    return new Response(
      JSON.stringify({
        success: true,
        cross_filled: crossFillResults,
        auto_generated: autoGenerated,
        anomalies: anomaliesInserted,
        summary: {
          crew_members: crewWorkerIds.length,
          reported: reportedWorkerIds.size,
          unreported: unreportedWorkers.length,
          majority_vineyard: majorityVineyard,
          majority_block: majorityBlock,
          majority_task: majorityTask,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("crew-intelligence error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
