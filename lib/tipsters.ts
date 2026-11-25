// Settles public tipsters' Classic Calls and market tips after full time, from the reveal escrow, so a tipster
// cannot choose which tips to reveal. Server only: needs SUPABASE_SERVICE_ROLE_KEY and SEAL_ESCROW_KEY.
//   * one tip per match: the earliest seal the server received before kickoff
//   * escrowed move missing, or not matching its sealed hash: the tip counts as lost
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settlePick } from "./data";

// Gives an offline tipster's phone time to hand its moves to escrow before a missing one counts as lost.
const GRACE_MS = 3 * 60 * 60_000;
const enc = new TextEncoder(), dec = new TextDecoder();
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

type Seal = { user_id: string; id: string; round: string; commitment: string; received_at: string };
type Fixture = { id: string; kickoff: string; home_goals: number; away_goals: number };
type Row = { user_id: string; fixture_id: string; seal_id: string; received_at: string; pick: string | null; outcome: "won" | "lost"; exact: boolean; reason: "revealed" | "missing" | "mismatch" };

async function escrowKey() {
  const raw = process.env.SEAL_ESCROW_KEY;
  if (!raw || unb64(raw).length !== 32) return null;
  return crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", false, ["decrypt"]);
}

function score(pick: string, f: Fixture): { outcome: "won" | "lost"; exact: boolean } | null {
  const r = settlePick(pick, f.home_goals, f.away_goals);
  return r && { outcome: r.won ? "won" : "lost", exact: r.exact };
}

export async function settleTips(sb: SupabaseClient): Promise<{ settled: number; error?: string }> {
  const key = await escrowKey();
  if (!key) return { settled: 0, error: "SEAL_ESCROW_KEY not set" };

  const { data: tipsters, error: pErr } = await sb.from("profiles").select("id").not("public_since", "is", null);
  if (pErr) return { settled: 0, error: pErr.message };
  if (!tipsters?.length) return { settled: 0 };
  const ids = tipsters.map((t) => t.id as string);

  const { data: seals, error: sErr } = await sb.from("seals").select("user_id, id, round, commitment, received_at").in("game", ["classic", "tip"]).in("user_id", ids);
  if (sErr) return { settled: 0, error: sErr.message };
  if (!seals?.length) return { settled: 0 };

  const rounds = [...new Set(seals.map((s) => s.round as string))];
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
  const { data: fixtures, error: fErr } = await sb.from("fixtures").select("id, kickoff, home_goals, away_goals")
    .in("id", rounds).not("home_goals", "is", null).lt("kickoff", cutoff);
  if (fErr) return { settled: 0, error: fErr.message };
  const final = new Map((fixtures ?? []).map((f) => [f.id as string, f as Fixture]));

  const { data: done } = await sb.from("tip_results").select("user_id, fixture_id").in("user_id", ids);
  const settled = new Set((done ?? []).map((d) => `${d.user_id}|${d.fixture_id}`));

  // The earliest seal before kickoff is the tip; later seals on the same match never count.
  const tips = new Map<string, Seal>();
  for (const s of seals as Seal[]) {
    const f = final.get(s.round);
    if (!f || Date.parse(s.received_at) >= Date.parse(f.kickoff)) continue;
    const k = `${s.user_id}|${s.round}`;
    if (settled.has(k)) continue;
    const cur = tips.get(k);
    if (!cur || Date.parse(s.received_at) < Date.parse(cur.received_at)) tips.set(k, s);
  }
  if (!tips.size) return { settled: 0 };

  const chosen = [...tips.values()];
  const { data: vault } = await sb.from("seal_vault").select("user_id, seal_id, iv, data")
    .in("user_id", [...new Set(chosen.map((s) => s.user_id))]).in("seal_id", chosen.map((s) => s.id));
  const blob = new Map((vault ?? []).map((v) => [`${v.user_id}|${v.seal_id}`, v]));

  const rows: Row[] = [];
  for (const s of chosen) {
    const f = final.get(s.round)!;
    const base = { user_id: s.user_id, fixture_id: s.round, seal_id: s.id, received_at: s.received_at };
    const v = blob.get(`${s.user_id}|${s.id}`);
    if (!v) { rows.push({ ...base, pick: null, outcome: "lost", exact: false, reason: "missing" }); continue; }
    let secret: { move?: string; salt?: string; player?: string };
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv), additionalData: enc.encode(`${s.user_id}|${s.id}`) }, key, unb64(v.data));
      secret = JSON.parse(dec.decode(plain));
    } catch { rows.push({ ...base, pick: null, outcome: "lost", exact: false, reason: "mismatch" }); continue; }
    const hash = createHash("sha256").update(`calledit:v1|${secret.player}|${s.round}|${secret.move}|${secret.salt}`).digest("hex");
    const pick = String(secret.move ?? "").split("|")[0];
    const result = hash === s.commitment ? score(pick, f) : null;
    rows.push(result ? { ...base, pick, ...result, reason: "revealed" } : { ...base, pick: null, outcome: "lost", exact: false, reason: "mismatch" });
  }

  const { error } = await sb.from("tip_results").upsert(rows, { onConflict: "user_id,fixture_id", ignoreDuplicates: true });
  if (error) return { settled: 0, error: error.message };
  return { settled: rows.length };
}
