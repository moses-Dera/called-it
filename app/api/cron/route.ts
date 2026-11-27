import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { leagueName } from "@/lib/leagues";
import { settleContests } from "@/lib/settle";
import { settleTips } from "@/lib/tipsters";

// Auto fixture pipeline: import upcoming matches and fetch results.
// Called by a cron job (e.g. Vercel cron, or `curl /api/cron?token=...` every 30 minutes).
// Requires CRON_SECRET to authorize and FOOTBALL_DATA_KEY to query football-data.org.
// Also requires SUPABASE_SERVICE_ROLE_KEY for server-side writes (bypasses RLS).

const COMPETITIONS = ["PL", "CL", "PD", "SA", "BL1"];
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Match = { id: number; utcDate: string; status: string; homeTeam: { name: string; shortName?: string }; awayTeam: { name: string; shortName?: string }; score: { fullTime: { home: number | null; away: number | null } } };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const token = new URL(req.url).searchParams.get("token");
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const isVercelCron = req.headers.get("user-agent") === "vercel-cron/1.0";
  if (!isVercelCron && (!secret || (token !== secret && authHeader !== secret)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fdKey = process.env.FOOTBALL_DATA_KEY;
  if (!fdKey) return NextResponse.json({ error: "FOOTBALL_DATA_KEY not set" }, { status: 501 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const log: string[] = [];

  for (const comp of COMPETITIONS) {
    try {
      // Import upcoming matches
      const upcoming = await fetch(`https://api.football-data.org/v4/competitions/${comp}/matches?status=SCHEDULED,TIMED&dateFrom=${day(0)}&dateTo=${day(10)}`, { headers: { "X-Auth-Token": fdKey }, cache: "no-store" });
      if (upcoming.ok) {
        const body = (await upcoming.json()) as { matches?: Match[] };
        for (const m of body.matches ?? []) {
          const id = `fd-${m.id}`;
          // Upserting these columns only refreshes names, kickoff and league; results are left alone.
          const { error } = await sb.from("fixtures").upsert({ id, home: m.homeTeam.shortName || m.homeTeam.name, away: m.awayTeam.shortName || m.awayTeam.name, kickoff: m.utcDate, league: leagueName(comp) }, { onConflict: "id" });
          if (!error) log.push(`+ ${id}`);
        }
      }

      // Fetch results
      const results = await fetch(`https://api.football-data.org/v4/competitions/${comp}/matches?status=FINISHED&dateFrom=${day(-3)}&dateTo=${day(0)}`, { headers: { "X-Auth-Token": fdKey }, cache: "no-store" });
      if (results.ok) {
        const body = (await results.json()) as { matches?: Match[] };
        for (const m of body.matches ?? []) {
          if (m.score.fullTime.home == null) continue;
          const id = `fd-${m.id}`;
          const { data: existing } = await sb.from("fixtures").select("id, home_goals, away_goals").eq("id", id).maybeSingle();
          if (existing && (existing.home_goals !== m.score.fullTime.home || existing.away_goals !== m.score.fullTime.away)) {
            await sb.from("fixtures").update({ home_goals: m.score.fullTime.home, away_goals: m.score.fullTime.away }).eq("id", id);
            log.push(`✓ ${id} ${m.score.fullTime.home}-${m.score.fullTime.away}`);
          }
        }
      }
    } catch (e) {
      log.push(`! ${comp}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  const tips = await settleTips(sb);
  log.push(tips.error ? `! Tipster settle: ${tips.error}` : `tipster tips settled: ${tips.settled}`);

  // Weekly leaderboard cache reset (idempotent — only updates rows from prior weeks)
  try {
    const { error: resetErr } = await sb.rpc("leaderboard_weekly_reset");
    if (!resetErr) log.push("leaderboard weekly reset ok");
  } catch (e) {
    log.push(`! Leaderboard reset: ${e instanceof Error ? e.message : String(e)}`);
  }

  log.push(...(await settleContests(sb)));

  return NextResponse.json({ ok: true, log, at: new Date().toISOString() });
}
