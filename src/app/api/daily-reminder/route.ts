import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { type } = body as { type: "evening" | "morning" };

  if (!type || !["evening", "morning"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Must be 'evening' or 'morning'." },
      { status: 400 }
    );
  }

  const res = await fetch(
    `${supabaseUrl}/functions/v1/daily-reminder`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ type }),
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return NextResponse.json(
      { error: data?.error || "Failed to send reminders" },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
