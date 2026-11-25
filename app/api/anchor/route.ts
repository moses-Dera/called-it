import { NextResponse } from "next/server";
import { buildTree } from "@/lib/merkle";
import { stampRoot, checkRoot } from "@/lib/ots";

// Calendar calls run in parallel with a 12s timeout each.
export const maxDuration = 30;

const rateMap = new Map<string, number[]>();
function rateOk(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateMap.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  rateMap.set(key, hits);
  return true;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateOk(`anchor:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const commitments: unknown = body?.commitments;
  if (!Array.isArray(commitments) || commitments.length === 0 || commitments.length > 2000 ||
      !commitments.every((c) => typeof c === "string" && /^[0-9a-f]{64}$/.test(c))) {
    return NextResponse.json({ error: "commitments must be 1-2000 sha256 hex strings" }, { status: 400 });
  }
  const { root, proofs } = await buildTree(commitments as string[]);
  const anchor = await stampRoot(root);
  if (!anchor) return NextResponse.json({ error: "anchor service unavailable", retry: true }, { status: 503 });
  return NextResponse.json({ root, proofs, ...anchor });
}

// Where is this root now? queued -> mined (Bitcoin block height).
export async function GET(req: Request) {
  const root = new URL(req.url).searchParams.get("root") ?? "";
  if (!/^[0-9a-f]{64}$/.test(root)) return NextResponse.json({ error: "root must be 64 hex characters" }, { status: 400 });
  const state = await checkRoot(root);
  if (!state) return NextResponse.json({ error: "anchor unavailable", retry: true }, { status: 503 });
  return NextResponse.json(state);
}
