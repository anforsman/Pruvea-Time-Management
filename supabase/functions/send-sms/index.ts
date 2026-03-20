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

    const textbeltKey = Deno.env.get("TEXTBELT_API_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const webhookUrl = `${supabaseUrl}/functions/v1/sms-webhook`;

    // Send via Textbelt with reply webhook
    const textbeltResponse = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: to,
        message: body,
        key: textbeltKey,
        replyWebhookUrl: webhookUrl,
        webhookData: worker_id ?? "",
      }),
    });

    const textbeltResult = await textbeltResponse.json();

    if (!textbeltResult.success) {
      console.error("Textbelt error:", textbeltResult.error);
      return new Response(
        JSON.stringify({ error: "Failed to send SMS", details: textbeltResult.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log outbound message
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await supabase.from("raw_messages").insert({
      twilio_sid: `TB_${textbeltResult.textId}`,
      from_number: "textbelt",
      body,
      worker_id: worker_id || null,
      direction: "outbound",
    });

    return new Response(
      JSON.stringify({ success: true, text_id: textbeltResult.textId }),
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
