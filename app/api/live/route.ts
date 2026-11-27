import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { settleTips } from "@/lib/tipsters";
import { leagueName } from "@/lib/leagues";
import { settleContests } from "@/lib/settle";

const COMPETITIONS = "PL,CL,PD,SA,BL1";
const LIVE = new Set(["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT", "LIVE"]);
const FINAL = new Set(["FINISHED", "AWARDED"]);
// Every open tab polls this, and the football-data free tier allows 10 requests a minute.
const MIN_GAP_MS = 45_000;

type Match = {
  id: number; utcDate: string; status: string;
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  score: { fullTime: { home: number | null; away: number | null } };
  competition?: { code?: string };
};
type Row = { id: string; league?: string; home: string; away: string; kickoff: string; status: string; home_goals?: number | null; away_goals?: number | null; live_home?: number | null; live_away?: number | null };

type Result = { body: Record<string, unknown>; status: number };
let lastRun = 0;
let last: Result | null = null;
let inflight: Promise<Result> | null = null;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function toRow(m: Match): Row {
  const row: Row = { id: `fd-${m.id}`, home: m.homeTeam.shortName || m.homeTeam.name, away: m.awayTeam.shortName || m.awayTeam.name, kickoff: m.utcDate, status: m.status };
  const league = leagueName(m.competition?.code);
  if (league) row.league = league;
  const { home, away } = m.score.fullTime;
  // home_goals is the final result; scoring and contest settlement read it as full time.
  if (FINAL.has(m.status) && home != null && away != null) Object.assign(row, { home_goals: home, away_goals: away, live_home: null, live_away: null });
  else if (LIVE.has(m.status)) Object.assign(row, { home_goals: null, away_goals: null, live_home: home ?? 0, live_away: away ?? 0 });
  return row;
}

async function run(): Promise<{ body: Record<string, unknown>; status: number }> {
  const fdKey = process.env.FOOTBALL_DATA_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fdKey || !url || !serviceKey) return { body: { error: "missing env" }, status: 501 };

  let matches: Match[];
  try {
    const res = await fetch(
      `https://api.football-data.org/v4/matches?competitions=${COMPETITIONS}&dateFrom=${day(-1)}&dateTo=${day(0)}`,
      { headers: { "X-Auth-Token": fdKey }, cache: "no-store" },
    );
    if (!res.ok) return { body: { error: `football-data responded ${res.status}` }, status: 502 };
    matches = ((await res.json()) as { matches?: Match[] }).matches ?? [];
  } catch (e) {
    return { body: { error: e instanceof Error ? e.message : "football-data unreachable" }, status: 502 };
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const rows = matches.map(toRow);
  const { data: existing, error: readErr } = await sb.from("fixtures")
    .select("id, home, away, kickoff, status, home_goals, away_goals, live_home, live_away, league")
    .in("id", rows.map((r) => r.id));
  if (readErr) return { body: { error: readErr.message }, status: 500 };

  const have = new Map((existing ?? []).map((r) => [r.id as string, r as Record<string, unknown>]));
  const changed = rows.filter((r) => {
    const old = have.get(r.id);
    if (!old) return true;
    return Object.entries(r).some(([k, v]) => k === "kickoff" ? Date.parse(String(old[k])) !== Date.parse(String(v)) : old[k] !== v);
  });

  // Group by column set: one upsert with mixed columns would null out the ones a row leaves out.
  const groups = new Map<string, Row[]>();
  for (const r of changed) { const k = Object.keys(r).sort().join(); groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const g of groups.values()) {
    const { error } = await sb.from("fixtures").upsert(g, { onConflict: "id" });
    if (error) return { body: { error: error.message }, status: 500 };
  }

  const tips = await settleTips(sb);
  const settled = await settleContests(sb);
  return { body: { ok: true, live: rows.filter((r) => LIVE.has(r.status)).length, updated: changed.length, tipsSettled: tips.settled, contests: settled, at: new Date().toISOString() }, status: 200 };
}

export async function GET() {
  if (last && Date.now() - lastRun < MIN_GAP_MS) return NextResponse.json(last.body, { status: last.status });
  inflight ??= run().then((r) => { lastRun = Date.now(); last = r; return r; }).finally(() => { inflight = null; });
  const { body, status } = await inflight;
  return NextResponse.json(body, { status });
}
