import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { fromNumber, text } = await request.json();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration" },
      { status: 500 }
    );
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/sms-webhook`;
  const textId = `SIM_${Date.now()}`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ textId, fromNumber, text }),
    });

    const data = await res.json();

    // The webhook now returns { ok: true, reply: "..." }
    const reply = data.reply ?? null;

    return NextResponse.json({
      success: true,
      textId,
      replies: reply ? [{ body: reply, created_at: new Date().toISOString() }] : [],
    });
  } catch (err) {
    console.error("SMS simulator webhook error:", err);
    return NextResponse.json(
      { error: "Failed to call sms-webhook" },
      { status: 500 }
    );
  }
}
