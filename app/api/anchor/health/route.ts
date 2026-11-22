import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.ANCHOR_URL?.replace(/\/$/, "");
  const token = process.env.ANCHOR_TOKEN;
  if (!url) return NextResponse.json({ error: "ANCHOR_URL not set" }, { status: 501 });

  try {
    const r = await fetch(`${url}/health`, {
      headers: { authorization: `Bearer ${token ?? ""}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ error: `Anchor service returned ${r.status}` }, { status: 502 });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "Could not reach anchor service" }, { status: 502 });
  }
}
