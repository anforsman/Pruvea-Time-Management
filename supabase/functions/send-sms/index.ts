import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, body, worker_id } = await req.json();

    if (!to || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Log outbound message FIRST — before attempting delivery.
    // This ensures the simulator and dashboard always see the reply.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const msgId = `MSG_${Date.now()}`;
    await supabase.from("raw_messages").insert({
      twilio_sid: msgId,
      from_number: "system",
      body,
      worker_id: worker_id || null,
      direction: "outbound",
    });

    // Attempt Textbelt delivery in background (best-effort, non-blocking).
    // Use a 5-second timeout so we don't hang if Textbelt is slow.
    const textbeltKey = Deno.env.get("TEXTBELT_API_KEY");
    if (textbeltKey) {
      const webhookUrl = `${supabaseUrl}/functions/v1/sms-webhook`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch("https://textbelt.com/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: to,
            message: body,
            key: textbeltKey,
            replyWebhookUrl: webhookUrl,
            webhookData: worker_id ?? "",
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const result = await res.json();
        if (!result.success) {
          console.log("Textbelt delivery failed (message still logged):", result.error);
        }
      } catch (err) {
        clearTimeout(timeout);
        console.log("Textbelt delivery skipped:", (err as Error).message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, text_id: msgId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-sms error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
