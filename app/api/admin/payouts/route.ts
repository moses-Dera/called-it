import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Endpoint to trigger automated cloud payouts via GitHub Actions runner
// Only authenticated admins can invoke this endpoint.
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer /i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !anonKey) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const sb = createClient(sbUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr || !isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    network?: "mainnet" | "testnet";
    contest_id?: string;
    rank?: number;
  };
  const network = body.network === "testnet" ? "testnet" : "mainnet";
  const contestId = body.contest_id || "";
  const rank = body.rank ? String(body.rank) : "";

  const githubRepo = process.env.GITHUB_REPO; // e.g. "my-user/called-it"
  const githubPat = process.env.GITHUB_PAT;   // Personal Access Token with repo/actions scope

  if (!githubRepo || !githubPat) {
    return NextResponse.json({
      ok: false,
      automated: false,
      network,
      message:
        "GitHub Actions automation is not connected. Add GITHUB_REPO and GITHUB_PAT to your environment variables to enable 1-click cloud payouts, or run: ZCASH_NETWORK=" +
        network +
        " node cli.mjs " +
        (contestId ? `contest-payout ${contestId}` : "payouts"),
    });
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/payouts.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubPat}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            network,
            contest_id: contestId,
            rank,
          },
        }),
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      return NextResponse.json(
        { error: `GitHub Actions rejected dispatch: ${ghRes.status} ${errText}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      automated: true,
      network,
      message: `Automated payout workflow dispatched on GitHub Actions (${network}${
        contestId ? `, contest ${contestId}` : ""
      }). Runs in ~30 seconds.`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
