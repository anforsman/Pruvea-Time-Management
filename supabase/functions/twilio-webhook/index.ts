import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const AUDIO_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/ogg",
  "audio/amr",
  "audio/wav",
  "audio/mp4",
]);

function parseFormData(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, ...valueParts] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(
        valueParts.join("=").replace(/\+/g, " "),
      );
    }
  }
  return params;
}

async function sendTextbelt(phone: string, message: string): Promise<void> {
  const key = Deno.env.get("TEXTBELT_API_KEY");
  if (!key) {
    console.error("TEXTBELT_API_KEY not set");
    return;
  }
  try {
    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message, key }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error("Textbelt error:", data.error);
    }
  } catch (err) {
    console.error("Textbelt send failed:", err);
  }
}

// --- Media Processing: Image OCR (STORY-018) ---

interface MediaItem {
  url: string;
  contentType: string;
}

function getMediaItems(params: Record<string, string>, numMedia: number): MediaItem[] {
  const items: MediaItem[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const contentType = (params[`MediaContentType${i}`] || "").toLowerCase();
    if (url) {
      items.push({ url, contentType });
    }
  }
  return items;
}

async function fetchMediaAsBase64(
  url: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    // Twilio media URLs are publicly accessible; try direct fetch first
    let res = await fetch(url);

    // If unauthorized, retry with Basic auth
    if (res.status === 401 || res.status === 403) {
      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      if (accountSid && authToken) {
        const credentials = btoa(`${accountSid}:${authToken}`);
        res = await fetch(url, {
          headers: { Authorization: `Basic ${credentials}` },
        });
      }
    }

    if (!res.ok) {
      console.error(`Media fetch failed: ${res.status} ${res.statusText} for ${url}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await res.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    return { base64, mediaType: contentType.split(";")[0].trim() };
  } catch (err) {
    console.error(`Failed to fetch media from ${url}:`, err);
    return null;
  }
}

async function processImageOCR(
  supabase: ReturnType<typeof createClient>,
  imageUrl: string,
  worker: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null },
  messageId: string | null,
  textContext: string,
): Promise<ParseResult | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set for image OCR");
    return null;
  }

  const mediaData = await fetchMediaAsBase64(imageUrl);
  if (!mediaData) {
    return null;
  }

  // Fetch crew members for multi-worker timesheet matching
  let crewMembersList = "";
  if (worker.crew_id) {
    const { data: crewMembers } = await supabase
      .from("workers")
      .select("id, full_name")
      .eq("crew_id", worker.crew_id)
      .eq("is_active", true);
    if (crewMembers && crewMembers.length > 0) {
      crewMembersList = `\n\nWorkers in this crew:\n${crewMembers.map((w: { id: string; full_name: string }) => `- ${w.full_name} (id: ${w.id})`).join("\n")}`;
    }
  }

  const systemPrompt = `Extract time entry data from this handwritten timesheet or note. The image may contain entries for one or multiple workers. Extract all entries you can find. Return the same JSON format as text parsing.${crewMembersList}

${textContext ? `Additional context from the text message: "${textContext}"` : ""}

Return ONLY valid JSON in this format:
{
  "entries": [
    {
      "worker_name": string or null,
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
  "needs_clarification": false,
  "clarification_question_en": null,
  "clarification_question_es": null
}

Rules:
- If names are visible on the timesheet, include them in worker_name to match against the crew list.
- If no date is visible, use today's date: ${new Date().toISOString().split("T")[0]}.
- Calculate hours from start/end times when both are provided.
- Set confidence based on legibility: 1.0 = clear, 0.7 = mostly readable, 0.5 = guessing parts.
- If you cannot read the image at all, return empty entries array.`;

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
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaData.mediaType,
                  data: mediaData.base64,
                },
              },
              {
                type: "text",
                text: "Please extract all time entry data from this image.",
              },
            ],
          },
        ],
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Image OCR: no JSON in Claude response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const rawEntries = parsed.entries ?? [];
    if (rawEntries.length === 0) {
      return null;
    }

    // Handle multi-worker timesheets: group entries by worker_name
    const lang = worker.language ?? "es";

    // Separate entries by worker
    const entriesByWorker = new Map<string | null, ParsedEntry[]>();
    for (const entry of rawEntries) {
      const workerName: string | null = entry.worker_name ?? null;
      const parsed: ParsedEntry = {
        date: entry.date,
        start_time: entry.start_time ?? null,
        end_time: entry.end_time ?? null,
        hours: entry.hours,
        block_name: entry.block_name ?? null,
        task_name: entry.task_name ?? null,
        confidence: entry.confidence ?? 0.7,
        notes: entry.notes ?? "Extracted from image via OCR",
      };
      if (!entriesByWorker.has(workerName)) {
        entriesByWorker.set(workerName, []);
      }
      entriesByWorker.get(workerName)!.push(parsed);
    }

    // If all entries have no worker_name, or only one worker, assign to the sender
    if (entriesByWorker.size === 1 && entriesByWorker.has(null)) {
      const entries = entriesByWorker.get(null)!;
      return await createEntriesAndConfirm(supabase, entries, worker, messageId, lang);
    }

    // Multi-worker: try to match names to crew members
    let totalEntries = 0;
    const summaryParts: string[] = [];

    for (const [workerName, entries] of entriesByWorker) {
      let targetWorker = worker; // default to sender

      if (workerName && worker.crew_id) {
        // Try to match the name to a crew member
        const { data: matchedWorker } = await supabase
          .from("workers")
          .select("id, full_name, language, crew_id, phone")
          .eq("crew_id", worker.crew_id)
          .eq("is_active", true)
          .ilike("full_name", `%${workerName}%`)
          .limit(1)
          .single();

        if (matchedWorker) {
          targetWorker = matchedWorker;
        }
      }

      for (const entry of entries) {
        const blockId = entry.block_name ? await resolveBlock(supabase, entry.block_name) : null;
        const taskId = entry.task_name ? await resolveTask(supabase, entry.task_name) : null;
        const vineyardId = blockId ? await getVineyardForBlock(supabase, blockId) : null;

        await supabase.from("time_entries").insert({
          worker_id: targetWorker.id,
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
        });

        totalEntries++;
        const who = workerName ?? targetWorker.full_name;
        const blockName = entry.block_name ?? "?";
        const taskName = entry.task_name ?? "?";
        const timeStr = entry.start_time && entry.end_time
          ? `${entry.start_time}-${entry.end_time}`
          : `${entry.hours}h`;
        summaryParts.push(`${who}: ${entry.date} ${timeStr} ${taskName} @ ${blockName}`);
      }
    }

    let reply: string;
    if (lang === "es") {
      reply = `Leído de la foto: ${totalEntries} entrada(s):\n${summaryParts.join("\n")}\n\nResponde SÍ para confirmar o describe correcciones.`;
    } else {
      reply = `Read from photo: ${totalEntries} entry(ies):\n${summaryParts.join("\n")}\n\nReply YES to confirm or describe corrections.`;
    }

    return { reply, needsConfirmation: true, needsClarification: false };
  } catch (err) {
    console.error("Image OCR processing error:", err);
    return null;
  }
}

// --- Media Processing: Voice Transcription (STORY-019) ---

async function processVoiceTranscription(
  audioUrl: string,
  contentType: string,
  workerLanguage: string,
): Promise<string | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return null; // Caller will send "not yet supported" message
  }

  try {
    // Fetch the audio file
    let res = await fetch(audioUrl);

    // If unauthorized, retry with Basic auth
    if (res.status === 401 || res.status === 403) {
      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      if (accountSid && authToken) {
        const credentials = btoa(`${accountSid}:${authToken}`);
        res = await fetch(audioUrl, {
          headers: { Authorization: `Basic ${credentials}` },
        });
      }
    }

    if (!res.ok) {
      console.error(`Audio fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const audioBlob = await res.blob();

    // Determine file extension from content type
    const extMap: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "audio/amr": "amr",
      "audio/wav": "wav",
      "audio/mp4": "mp4",
    };
    const ext = extMap[contentType] ?? "mp3";

    // Send to OpenAI Whisper API
    const formData = new FormData();
    formData.append("file", audioBlob, `audio.${ext}`);
    formData.append("model", "whisper-1");

    // Set language hint based on worker preference
    if (workerLanguage === "es") {
      formData.append("language", "es");
    } else if (workerLanguage === "en") {
      formData.append("language", "en");
    }
    // If language is unknown, omit for auto-detect

    const whisperRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
        },
        body: formData,
      },
    );

    if (!whisperRes.ok) {
      console.error(`Whisper API error: ${whisperRes.status} ${await whisperRes.text()}`);
      return null;
    }

    const whisperData = await whisperRes.json();
    const transcript = whisperData.text ?? "";
    console.log(`Voice transcription: "${transcript}"`);
    return transcript || null;
  } catch (err) {
    console.error("Voice transcription error:", err);
    return null;
  }
}

// --- Media Processing Orchestrator ---

interface MediaProcessingResult {
  /** Combined text from transcriptions and/or OCR text output */
  transcribedText: string | null;
  /** Direct ParseResult from image OCR (bypasses text parsing) */
  imageResult: ParseResult | null;
  /** Error messages to send to the user */
  errorMessages: string[];
}

async function processMedia(
  supabase: ReturnType<typeof createClient>,
  params: Record<string, string>,
  numMedia: number,
  worker: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null },
  messageId: string | null,
  textBody: string,
): Promise<MediaProcessingResult> {
  const lang = worker.language ?? "es";
  const mediaItems = getMediaItems(params, numMedia);
  const result: MediaProcessingResult = {
    transcribedText: null,
    imageResult: null,
    errorMessages: [],
  };

  const transcriptionParts: string[] = [];

  for (const item of mediaItems) {
    if (IMAGE_CONTENT_TYPES.has(item.contentType)) {
      // Process image via OCR
      try {
        const ocrResult = await processImageOCR(
          supabase,
          item.url,
          worker,
          messageId,
          textBody,
        );
        if (ocrResult) {
          result.imageResult = ocrResult;
        } else {
          const errorMsg = lang === "es"
            ? "No pude leer esa imagen. Por favor escribe tus horas."
            : "I couldn't read that image. Please type your hours instead.";
          result.errorMessages.push(errorMsg);
        }
      } catch (err) {
        console.error("Image processing error:", err);
        const errorMsg = lang === "es"
          ? "No pude leer esa imagen. Por favor escribe tus horas."
          : "I couldn't read that image. Please type your hours instead.";
        result.errorMessages.push(errorMsg);
      }
    } else if (AUDIO_CONTENT_TYPES.has(item.contentType)) {
      // Process audio via Whisper transcription
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) {
        const errorMsg = lang === "es"
          ? "Los mensajes de voz aún no son compatibles. Por favor escribe tus horas."
          : "Voice messages are not yet supported. Please type your hours.";
        result.errorMessages.push(errorMsg);
        continue;
      }

      try {
        const transcript = await processVoiceTranscription(
          item.url,
          item.contentType,
          worker.language ?? "es",
        );
        if (transcript) {
          transcriptionParts.push(transcript);
        } else {
          const errorMsg = lang === "es"
            ? "No pude transcribir ese mensaje de voz. Por favor escribe tus horas."
            : "I couldn't transcribe that voice message. Please type your hours.";
          result.errorMessages.push(errorMsg);
        }
      } catch (err) {
        console.error("Voice transcription error:", err);
        const errorMsg = lang === "es"
          ? "No pude transcribir ese mensaje de voz. Por favor escribe tus horas."
          : "I couldn't transcribe that voice message. Please type your hours.";
        result.errorMessages.push(errorMsg);
      }
    }
    // Skip unknown content types silently
  }

  if (transcriptionParts.length > 0) {
    result.transcribedText = transcriptionParts.join(" ");
  }

  return result;
}

// --- Main Handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const rawBody = await req.text();
    const params = parseFormData(rawBody);

    const messageSid = params.MessageSid || "";
    const fromNumber = params.From || "";
    const body = params.Body || "";
    const numMedia = parseInt(params.NumMedia || "0", 10);

    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    console.log(`Inbound SMS from ${fromNumber}: ${body} (media: ${numMedia})`);

    // Look up worker
    const { data: worker } = await supabase
      .from("workers")
      .select("id, full_name, language, crew_id, phone")
      .eq("phone", fromNumber)
      .eq("is_active", true)
      .single();

    // Store raw message
    const { data: rawMsg } = await supabase
      .from("raw_messages")
      .insert({
        twilio_sid: messageSid,
        from_number: fromNumber,
        body,
        media_urls: mediaUrls,
        worker_id: worker?.id ?? null,
        direction: "inbound",
      })
      .select()
      .single();

    if (!worker) {
      await sendTextbelt(
        fromNumber,
        "This number is not registered. Please contact your supervisor. / Este número no está registrado. Contacta a tu supervisor.",
      );
      return emptyTwiml();
    }

    // Store outbound in raw_messages helper
    async function logOutbound(msg: string) {
      await supabase.from("raw_messages").insert({
        twilio_sid: `TB_OUT_${Date.now()}`,
        from_number: "textbelt",
        body: msg,
        worker_id: worker!.id,
        direction: "outbound",
      });
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
      if (["YES", "SÍ", "SI", "Y", "S"].includes(upperMsg)) {
        // Confirm ALL pending draft entries for this worker
        await supabase
          .from("time_entries")
          .update({ status: "worker_confirmed" })
          .eq("worker_id", worker.id)
          .eq("status", "draft");

        await supabase
          .from("conversation_state")
          .update({ state: "idle", pending_entry_id: null, context: {} })
          .eq("worker_id", worker.id);

        const reply = lang === "es"
          ? "¡Confirmado! Tus horas han sido registradas."
          : "Confirmed! Your hours have been logged.";
        await sendTextbelt(worker.phone!, reply);
        await logOutbound(reply);
        return emptyTwiml();
      }

      if (["NO", "N"].includes(upperMsg)) {
        // Reject ALL pending drafts
        await supabase
          .from("time_entries")
          .update({ status: "rejected" })
          .eq("worker_id", worker.id)
          .eq("status", "draft");

        await supabase
          .from("conversation_state")
          .update({ state: "idle", pending_entry_id: null, context: {} })
          .eq("worker_id", worker.id);

        const reply = lang === "es"
          ? "Entradas rechazadas. Envía tus horas de nuevo cuando estés listo."
          : "Entries rejected. Send your hours again when ready.";
        await sendTextbelt(worker.phone!, reply);
        await logOutbound(reply);
        return emptyTwiml();
      }

      // Not YES/NO — treat as new entry (don't delete old drafts)
      await supabase
        .from("conversation_state")
        .update({ state: "idle", pending_entry_id: null, context: {} })
        .eq("worker_id", worker.id);
      // Fall through to AI parsing
    }

    // --- AWAITING CLARIFICATION ---
    if (currentState === "awaiting_correction") {
      // User is responding to a clarification question
      // Re-parse with the original + clarification context
      const originalMsg = (convState?.context as Record<string, string>)?.original_message ?? "";
      const combinedMsg = `Original: ${originalMsg}\nClarification response: ${body}`;

      await supabase
        .from("conversation_state")
        .update({ state: "idle", pending_entry_id: null, context: {} })
        .eq("worker_id", worker.id);

      // Re-process with combined context
      const result = await parseAndCreateEntries(
        supabase, combinedMsg, worker, rawMsg?.id ?? null,
      );
      const reply = result.reply;
      await sendTextbelt(worker.phone!, reply);
      await logOutbound(reply);

      if (result.needsConfirmation) {
        await supabase.from("conversation_state").upsert(
          { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
          { onConflict: "worker_id" },
        );
      }
      return emptyTwiml();
    }

    // --- IDLE / NEW ENTRY ---

    // Process media attachments if present (STORY-018 / STORY-019)
    if (numMedia > 0) {
      const mediaResult = await processMedia(
        supabase,
        params,
        numMedia,
        worker,
        rawMsg?.id ?? null,
        body,
      );

      // Send any error messages
      for (const errMsg of mediaResult.errorMessages) {
        // Only send error messages if there's no successful result to report
        if (!mediaResult.imageResult && !mediaResult.transcribedText && !body.trim()) {
          await sendTextbelt(worker.phone!, errMsg);
          await logOutbound(errMsg);
          return emptyTwiml();
        }
      }

      // If image OCR produced a direct result, use it
      if (mediaResult.imageResult) {
        const result = mediaResult.imageResult;

        if (result.needsConfirmation) {
          await supabase.from("conversation_state").upsert(
            { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
            { onConflict: "worker_id" },
          );
        }

        // If there were also error messages (e.g., audio failed but image worked), append them
        let replyText = result.reply;
        if (mediaResult.errorMessages.length > 0) {
          replyText += "\n\n" + mediaResult.errorMessages.join("\n");
        }

        await sendTextbelt(worker.phone!, replyText);
        await logOutbound(replyText);
        return emptyTwiml();
      }

      // If voice transcription produced text, combine with body and parse
      if (mediaResult.transcribedText) {
        const combinedText = body.trim()
          ? `${mediaResult.transcribedText} ${body.trim()}`
          : mediaResult.transcribedText;

        const result = await parseAndCreateEntries(
          supabase, combinedText, worker, rawMsg?.id ?? null,
        );

        if (result.needsClarification) {
          await supabase.from("conversation_state").upsert(
            {
              worker_id: worker.id,
              state: "awaiting_correction",
              pending_entry_id: null,
              context: { original_message: combinedText },
            },
            { onConflict: "worker_id" },
          );
          await sendTextbelt(worker.phone!, result.reply);
          await logOutbound(result.reply);
          return emptyTwiml();
        }

        if (result.needsConfirmation) {
          await supabase.from("conversation_state").upsert(
            { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
            { onConflict: "worker_id" },
          );
        }

        await sendTextbelt(worker.phone!, result.reply);
        await logOutbound(result.reply);
        return emptyTwiml();
      }

      // Media processing failed entirely but there are error messages — send them
      // only if there's no text body to fall back on
      if (mediaResult.errorMessages.length > 0 && !body.trim()) {
        const allErrors = mediaResult.errorMessages.join("\n");
        await sendTextbelt(worker.phone!, allErrors);
        await logOutbound(allErrors);
        return emptyTwiml();
      }

      // Fall through to process text body if media processing failed but text exists
    }

    // Process text body (original flow)
    const result = await parseAndCreateEntries(
      supabase, body, worker, rawMsg?.id ?? null,
    );

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
      await sendTextbelt(worker.phone!, result.reply);
      await logOutbound(result.reply);
      return emptyTwiml();
    }

    if (result.needsConfirmation) {
      await supabase.from("conversation_state").upsert(
        { worker_id: worker.id, state: "awaiting_confirmation", pending_entry_id: null, context: {} },
        { onConflict: "worker_id" },
      );
    }

    await sendTextbelt(worker.phone!, result.reply);
    await logOutbound(result.reply);
    return emptyTwiml();
  } catch (err) {
    console.error("twilio-webhook error:", err);
    return emptyTwiml();
  }
});

function emptyTwiml(): Response {
  return new Response(TWIML_EMPTY, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

// --- Core parsing and entry creation ---

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

interface ParseResult {
  reply: string;
  needsConfirmation: boolean;
  needsClarification: boolean;
}

async function parseAndCreateEntries(
  supabase: ReturnType<typeof createClient>,
  message: string,
  worker: { id: string; full_name: string; language: string; crew_id: string | null; phone: string | null },
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
  "needs_clarification": boolean,
  "clarification_question_en": string or null,
  "clarification_question_es": string or null
}

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

    // Handle clarification needed
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

async function createEntriesAndConfirm(
  supabase: ReturnType<typeof createClient>,
  entries: ParsedEntry[],
  worker: { id: string; language: string },
  messageId: string | null,
  lang: string,
): Promise<ParseResult> {
  const summaryParts: string[] = [];
  let anyMissingTimes = false;

  for (const entry of entries) {
    const blockId = entry.block_name ? await resolveBlock(supabase, entry.block_name) : null;
    const taskId = entry.task_name ? await resolveTask(supabase, entry.task_name) : null;
    const vineyardId = blockId ? await getVineyardForBlock(supabase, blockId) : null;

    await supabase.from("time_entries").insert({
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
    });

    if (!entry.start_time || !entry.end_time) {
      anyMissingTimes = true;
    }

    const blockName = entry.block_name ?? "?";
    const taskName = entry.task_name ?? "?";
    const timeStr = entry.start_time && entry.end_time
      ? `${entry.start_time}-${entry.end_time}`
      : `${entry.hours}h`;
    summaryParts.push(`${entry.date}: ${timeStr} ${taskName} @ ${blockName}`);
  }

  let reply: string;
  if (lang === "es") {
    reply = `¡Recibido! ${entries.length} entrada(s):\n${summaryParts.join("\n")}\n\nResponde SÍ para confirmar o describe correcciones.`;
    if (anyMissingTimes) {
      reply += "\n\n💡 Tip: incluye hora de inicio y fin, ej: '8am-4pm'";
    }
  } else {
    reply = `Got it! ${entries.length} entry(ies):\n${summaryParts.join("\n")}\n\nReply YES to confirm or describe corrections.`;
    if (anyMissingTimes) {
      reply += "\n\nTip: include start & end times, e.g. '8am-4pm'";
    }
  }

  return { reply, needsConfirmation: true, needsClarification: false };
}

// --- Helpers ---

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
      start_time: null,
      end_time: null,
      hours: parseFloat(numMatch[1]),
      block_name: null,
      task_name: null,
      confidence: 0.3,
      notes: "Parsed by fallback — only hours extracted",
    };
  }
  return {
    date: new Date().toISOString().split("T")[0],
    start_time: null,
    end_time: null,
    hours: parseFloat(hoursMatch[1]),
    block_name: null,
    task_name: null,
    confidence: 0.5,
    notes: "Parsed by fallback",
  };
}

async function resolveBlock(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const { data: exact } = await supabase
    .from("blocks")
    .select("id")
    .ilike("name", `%${name}%`)
    .limit(1)
    .single();
  if (exact) return exact.id;

  const { data: blocks } = await supabase.from("blocks").select("id, aliases");
  const match = (blocks ?? []).find((b: { id: string; aliases: string[] }) =>
    b.aliases?.some((a: string) => a.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.toLowerCase())),
  );
  return match?.id ?? null;
}

async function resolveTask(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const { data: exact } = await supabase
    .from("tasks")
    .select("id")
    .ilike("name", `%${name}%`)
    .limit(1)
    .single();
  if (exact) return exact.id;

  const { data: tasks } = await supabase.from("tasks").select("id, aliases");
  const match = (tasks ?? []).find((t: { id: string; aliases: string[] }) =>
    t.aliases?.some((a: string) => a.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.toLowerCase())),
  );
  return match?.id ?? null;
}

async function getVineyardForBlock(
  supabase: ReturnType<typeof createClient>,
  blockId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("blocks")
    .select("vineyard_id")
    .eq("id", blockId)
    .single();
  return data?.vineyard_id ?? null;
}
