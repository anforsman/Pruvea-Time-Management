import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { to, body } = await request.json();

  const key = process.env.TEXTBELT_API_KEY;
  const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sms-webhook`;

  if (!key) {
    return NextResponse.json(
      { error: "Textbelt API key not configured" },
      { status: 500 }
    );
  }

  const res = await fetch("https://textbelt.com/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: to, message: body, key, replyWebhookUrl: webhookUrl }),
  });

  const data = await res.json();

  if (!data.success) {
    return NextResponse.json(
      { error: data.error || "Failed to send SMS" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, textId: data.textId });
}
