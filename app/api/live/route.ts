import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const COMPETITIONS = ["PL", "CL", "PD", "SA", "BL1"];

type Match = {
  id: number; utcDate: string; status: string; minute?: number;
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  score: { fullTime: { home: number | null; away: number | null } };
};

export async function GET() {
  const fdKey = process.env.FOOTBALL_DATA_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fdKey || !url || !serviceKey)
    return NextResponse.json({ error: "missing env" }, { status: 501 });

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const log: string[] = [];
  const live: { id: string; home: string; away: string; home_goals: number; away_goals: number; status: string }[] = [];

  for (const comp of COMPETITIONS) {
    try {
      const res = await fetch(
        `https://api.football-data.org/v4/competitions/${comp}/matches?status=LIVE,IN_PLAY,PAUSED,HALFTIME`,
        { headers: { "X-Auth-Token": fdKey }, cache: "no-store" }
      );
      if (!res.ok) continue;
      const body = (await res.json()) as { matches?: Match[] };

      for (const m of body.matches ?? []) {
        if (m.score.fullTime.home == null) continue;
        const id = `fd-${m.id}`;

        await sb.from("fixtures").upsert({
          id,
          home: m.homeTeam.shortName || m.homeTeam.name,
          away: m.awayTeam.shortName || m.awayTeam.name,
          kickoff: m.utcDate,
          home_goals: m.score.fullTime.home,
          away_goals: m.score.fullTime.away,
        }, { onConflict: "id" });

        live.push({
          id,
          home: m.homeTeam.shortName || m.homeTeam.name,
          away: m.awayTeam.shortName || m.awayTeam.name,
          home_goals: m.score.fullTime.home,
          away_goals: m.score.fullTime.away,
          status: m.status,
        });
        log.push(`⚡ ${id} ${m.score.fullTime.home}-${m.score.fullTime.away} (${m.status})`);
      }

      const finished = await fetch(
        `https://api.football-data.org/v4/competitions/${comp}/matches?status=FINISHED&dateFrom=${new Date().toISOString().slice(0, 10)}&dateTo=${new Date().toISOString().slice(0, 10)}`,
        { headers: { "X-Auth-Token": fdKey }, cache: "no-store" }
      );
      if (finished.ok) {
        const fBody = (await finished.json()) as { matches?: Match[] };
        for (const m of fBody.matches ?? []) {
          if (m.score.fullTime.home == null) continue;
          const id = `fd-${m.id}`;
          const { data: existing } = await sb.from("fixtures").select("id, home_goals").eq("id", id).maybeSingle();
          if (existing && existing.home_goals == null) {
            await sb.from("fixtures").update({ home_goals: m.score.fullTime.home, away_goals: m.score.fullTime.away }).eq("id", id);
            log.push(`✓ ${id} ${m.score.fullTime.home}-${m.score.fullTime.away}`);
          }
        }
      }
    } catch (e) {
      log.push(`! ${comp}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ ok: true, live, log, at: new Date().toISOString() });
}
