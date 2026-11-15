import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Proxies football-data.org for the admin page so the API key (FOOTBALL_DATA_KEY) never reaches a browser.
// Only the Called It admin may call it: the request carries the admin's Supabase session token, and the
// route asks the database whether that user is the admin before fetching anything.
//   GET /api/football?competition=PL&kind=upcoming   -> matches in the next 10 days
//   GET /api/football?competition=PL&kind=results    -> matches finished in the last 10 days
const COMPETITIONS = new Set(["PL", "PD", "SA", "BL1", "FL1", "CL", "DED", "PPL", "ELC", "BSA", "EC", "WC"]);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Match = { id: number; utcDate: string; status: string; homeTeam: { name: string; shortName?: string }; awayTeam: { name: string; shortName?: string }; score: { fullTime: { home: number | null; away: number | null } } };

export async function GET(req: Request) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return NextResponse.json({ error: "Add FOOTBALL_DATA_KEY (a free key from football-data.org) to the server environment." }, { status: 501 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!url || !anon || !token) return NextResponse.json({ error: "sign in as the admin" }, { status: 401 });
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: status } = await sb.rpc("admin_status");
  if (!status?.is_admin) return NextResponse.json({ error: "admins only" }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const competition = (q.get("competition") ?? "PL").toUpperCase();
  const kind = q.get("kind") === "results" ? "results" : "upcoming";
  if (!COMPETITIONS.has(competition)) return NextResponse.json({ error: "unknown competition" }, { status: 400 });

  const params = kind === "upcoming" ? `status=SCHEDULED,TIMED&dateFrom=${day(0)}&dateTo=${day(10)}` : `status=FINISHED&dateFrom=${day(-10)}&dateTo=${day(0)}`;
  const r = await fetch(`https://api.football-data.org/v4/competitions/${competition}/matches?${params}`, { headers: { "X-Auth-Token": key }, cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: `football-data.org replied ${r.status}${r.status === 429 ? " (rate limit: wait a minute)" : ""}` }, { status: 502 });
  const body = (await r.json()) as { matches?: Match[] };
  return NextResponse.json({
    matches: (body.matches ?? []).map((m) => ({
      id: `fd-${m.id}`, home: m.homeTeam.shortName || m.homeTeam.name, away: m.awayTeam.shortName || m.awayTeam.name,
      kickoff: m.utcDate, homeGoals: m.score.fullTime.home, awayGoals: m.score.fullTime.away, status: m.status,
    })),
  });
}
