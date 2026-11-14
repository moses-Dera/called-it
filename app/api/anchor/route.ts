import { NextResponse } from "next/server";
import { buildTree } from "@/lib/merkle";
import { anchorRoot } from "@/lib/zcash";

// Receives only commitments (hashes). Moves and salts never reach the server before reveal.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const commitments: unknown = body?.commitments;
  if (!Array.isArray(commitments) || commitments.length === 0 || commitments.length > 2000 ||
      !commitments.every((c) => typeof c === "string" && /^[0-9a-f]{64}$/.test(c))) {
    return NextResponse.json({ error: "commitments must be 1-2000 sha256 hex strings" }, { status: 400 });
  }
  const { root, proofs } = await buildTree(commitments as string[]);
  const anchor = await anchorRoot(root);
  return NextResponse.json({ root, proofs, ...anchor, anchoredAt: Date.now() });
}
