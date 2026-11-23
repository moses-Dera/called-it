"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { addReward, getState, markRevealed, mergeCloud, subscribe, type Reward, type Seal } from "./store";
import { FIXTURES, whenOf, type Fixture } from "./data";

// Optional cloud account (Supabase + Google sign-in). Without the two env vars the app stays guest-only.
// What syncs: profile, the rewards ledger, and each seal's commitment and proof.
// What never syncs: the move and its salt. Those stay on the device until reveal.
// Ranked points are "verified": only the database function claim_classic() can create them.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // older projects call it the anon key
export const cloudReady = !!(URL && KEY);

let client: SupabaseClient | null = null;
export function sb() { return cloudReady ? (client ??= createClient(URL!, KEY!, { auth: { flowType: "pkce" } })) : null; }

type Cloud = { session: Session | null; status: "off" | "idle" | "syncing" | "synced" | "error"; error?: string };
let cloud: Cloud = { session: null, status: cloudReady ? "idle" : "off" };
const SERVER: Cloud = { session: null, status: "off" };
const listeners = new Set<() => void>();
function set(patch: Partial<Cloud>) { cloud = { ...cloud, ...patch }; listeners.forEach((l) => l()); }
export function useCloud(): Cloud {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cloud, () => SERVER);
}

export async function signInWithGoogle() {
  const { error } = (await sb()?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } })) ?? {};
  if (error) set({ status: "error", error: error.message });
}
export async function signOut() { await sb()?.auth.signOut(); }
/** The signed-in user's access token, for server routes that check who is calling. */
export async function accessToken() { return (await sb()?.auth.getSession())?.data.session?.access_token ?? null; }

const iso = (ms: number) => new Date(ms).toISOString();

const PAGE = 500;
async function pullAll<T>(c: SupabaseClient, table: string, uid: string, order: string) {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await c.from(table).select("*").eq("user_id", uid)
      .order(order, { ascending: false }).range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

async function pull(uid: string) {
  const c = sb()!;
  const p = await c.from("profiles").select("name, avatar, address, withdrawn").eq("id", uid).maybeSingle();
  if (p.error) throw new Error(p.error.message);

  const [seRaw, reRaw] = await Promise.all([
    pullAll<Record<string, unknown>>(c, "seals", uid, "sealed_at"),
    pullAll<Record<string, unknown>>(c, "rewards", uid, "at"),
  ]);

  const seals: Seal[] = seRaw.map((r) => ({
    id: r.id as string, game: r.game as string, round: r.round as string, label: r.label as string,
    move: "", salt: "", commitment: r.commitment as string,
    sealedAt: Date.parse(r.sealed_at as string), status: r.status as "sealed" | "onchain",
    root: (r.root as string) ?? undefined, proof: (r.proof as string[]) ?? undefined,
    txid: (r.txid as string) ?? undefined, height: (r.height as number) ?? undefined,
    mode: (r.mode as "bitcoin" | "simulated") ?? undefined, revealed: r.revealed as boolean, remote: true,
  }));
  const ledger: Reward[] = reRaw.map((r) => ({
    id: r.id as string, label: r.label as string, points: r.points as number,
    zec: Number(r.zec), at: Date.parse(r.at as string), verified: !!r.verified,
  }));
  mergeCloud({ profile: p.data ?? undefined, withdrawn: Number(p.data?.withdrawn ?? 0), seals, ledger });
}

async function push(uid: string) {
  const c = sb()!, s = getState();
  const mine = s.seals.filter((x) => !x.remote); // only this device's seals; never the move or salt
  const practice = s.ledger.filter((r) => !r.verified); // verified rows are written by the server only
  const res = await Promise.all([
    c.from("profiles").upsert({ id: uid, name: s.profile.name, avatar: s.profile.avatar, address: s.profile.address, player: s.player, withdrawn: s.withdrawn, updated_at: iso(Date.now()) }),
    mine.length ? c.from("seals").upsert(mine.map((x) => ({
      user_id: uid, id: x.id, game: x.game, round: x.round, label: x.label, commitment: x.commitment, sealed_at: iso(x.sealedAt),
      status: x.status, root: x.root ?? null, proof: x.proof ?? null, txid: x.txid ?? null, height: x.height ?? null, mode: x.mode ?? null, revealed: !!x.revealed,
    }))) : null,
    practice.length ? c.from("rewards").upsert(practice.map((r) => ({ user_id: uid, id: r.id, label: r.label, points: r.points, zec: r.zec, at: iso(r.at) }))) : null,
  ]);
  const err = res.find((r) => r?.error)?.error;
  if (err) throw new Error(err.message);
}

let timer: ReturnType<typeof setTimeout> | null = null, busy = false, again = false;
async function sync(first = false) {
  const uid = cloud.session?.user.id;
  if (!uid) return;
  if (busy) { again = true; return; }
  busy = true; set({ status: "syncing", error: undefined });
  try { if (first) await pull(uid); await push(uid); set({ status: "synced" }); }
  catch (e) { set({ status: "error", error: e instanceof Error ? e.message : "Sync failed" }); }
  busy = false;
  if (again) { again = false; sync(); }
}

/** Push local changes now (used before a claim, so the server has the seal). */
export async function syncNow() { if (timer) clearTimeout(timer); await sync(); }

export type Claim = { status: "scored" | "pending" | "late"; points?: number; exact?: boolean; result?: boolean; final?: string; id?: string; message?: string; streak?: number; streak_mult?: number };
/** Reveal a Classic Call to the server, which re-hashes it and scores it against the official result. */
export async function claimClassic(seal: Seal): Promise<Claim> {
  const c = sb();
  if (!c || !cloud.session) throw new Error("Sign in to earn ranked points.");
  await syncNow();
  const { data, error } = await c.rpc("claim_classic", { p_seal_id: seal.id, p_player: seal.player ?? getState().player, p_move: seal.move, p_salt: seal.salt });
  if (error) throw new Error(error.message);
  const r = data as Claim;
  if (r.status === "scored" && r.points && r.id) addReward(`${seal.label} · Classic Call (verified)`, r.points, { id: r.id, verified: true });
  return r;
}

export async function requestWithdrawal(address: string): Promise<{ status: "requested" | "too_small"; amount?: number; available?: number }> {
  const c = sb();
  if (!c || !cloud.session) throw new Error("Sign in to request a payout.");
  const { data, error } = await c.rpc("request_withdrawal", { p_address: address.trim() });
  if (error) throw new Error(error.message);
  return data;
}

export type Rank = { rank: number; name: string; avatar: number; points: number; me: boolean };
const LB_PAGE = 50;
/** Verified-points leaderboard with pagination. */
export function useLeaderboard(period: "week" | "all"): { rows: Rank[] | null; error?: string; loadMore: () => void; hasMore: boolean; loading: boolean } {
  const [rows, setRows] = useState<Rank[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const uid = useCloud().session?.user.id ?? "";
  const key = period + uid;

  useEffect(() => {
    const c = sb();
    if (!c) return;
    let live = true;
    setRows(null); setHasMore(false);
    c.rpc("leaderboard", { p_period: period, p_limit: LB_PAGE, p_offset: 0 }).then(({ data, error: err }) => {
      if (!live) return;
      if (err) { setError(err.message); setRows([]); return; }
      const mapped = (data as Rank[]).map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
      setRows(mapped);
      setHasMore(mapped.length >= LB_PAGE);
    });
    return () => { live = false; };
  }, [key, period]);

  function loadMore() {
    const c = sb();
    if (!c || !rows || loading) return;
    setLoading(true);
    Promise.resolve(c.rpc("leaderboard", { p_period: period, p_limit: LB_PAGE, p_offset: rows.length })).then(({ data }) => {
      const page = (data as Rank[] ?? []).map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
      setRows([...rows, ...page]);
      setHasMore(page.length >= LB_PAGE);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  return { rows, error, loadMore, hasMore, loading };
}

/** Call a database function; throws with its message on error. */
export async function cloudRpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = sb();
  if (!c) throw new Error("Accounts are not configured.");
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- Fixtures and contests (public tables) ----------
type Listener = () => void;
function shared<T>(load: () => Promise<T>, initial: T) {
  let value = initial, loaded = false, loading = false;
  const subs = new Set<Listener>();
  const refresh = async () => {
    if (loading) return;
    loading = true;
    try { value = await load(); loaded = true; subs.forEach((l) => l()); } catch { /* keep the last value */ }
    loading = false;
  };
  return {
    refresh,
    get: () => value,
    use(): T {
      return useSyncExternalStore((l) => { subs.add(l); if (!loaded) refresh(); return () => subs.delete(l); }, () => value, () => initial);
    },
  };
}

const fixtureStore = shared<Fixture[]>(async () => {
  const c = sb();
  if (!c) return FIXTURES;
  const { data, error } = await c.from("fixtures").select("id, home, away, kickoff, home_goals, away_goals").order("kickoff");
  if (error) throw error;
  return (data ?? []).map((f) => ({ id: f.id, home: f.home, away: f.away, kickoff: f.kickoff, when: whenOf(f.kickoff), homeGoals: f.home_goals, awayGoals: f.away_goals }));
}, FIXTURES);
export const useFixtures = () => fixtureStore.use();
export const refreshFixtures = () => fixtureStore.refresh();

export type Contest = {
  id: string; title: string; sponsor: string | null; prize_zec: number; fixture_ids: string[];
  status: "open" | "closed"; winners: { rank: number; name: string; points: number; zec: number; address?: string; user_id?: string; status?: "pending" | "paid"; txid?: string | null }[] | null;
  sponsor_logo: string | null; sponsor_color: string | null; sponsor_url: string | null;
  prize_structure: "top3" | "top5" | "top10" | "top20" | "all_correct" | "random_draw" | "custom" | "equal_split";
  entry_deadline: string | null; description: string | null;
  custom_shares?: number[] | null;
};
const contestStore = shared<Contest[]>(async () => {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c.from("contests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((x) => ({ ...x, prize_zec: Number(x.prize_zec) }));
}, []);
export const useContests = () => contestStore.use();
export const refreshContests = () => contestStore.refresh();

// ---------- Contest entries (join / leave) ----------
export async function joinContest(id: string, referrer?: string): Promise<{ joined: boolean; contest: string }> {
  return cloudRpc("join_contest", { p_id: id, p_referrer: referrer ?? null });
}
export async function leaveContest(id: string): Promise<void> {
  await cloudRpc("leave_contest", { p_id: id });
}
export function useMyContestIds(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  const uid = useCloud().session?.user.id;
  useEffect(() => {
    if (!uid || !sb()) return;
    let live = true;
    cloudRpc<string[]>("my_contest_ids").then((r) => live && setIds(r)).catch(() => {});
    return () => { live = false; };
  }, [uid]);
  return ids;
}
export function useContestEntryCount(id: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!id || !sb()) return;
    let live = true;
    cloudRpc<number>("contest_entry_count", { p_id: id }).then((n) => live && setCount(Number(n))).catch(() => {});
    return () => { live = false; };
  }, [id]);
  return count;
}
export function useFixtureSealCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!sb()) return;
    let live = true;
    cloudRpc<{ fixture_id: string; seal_count: number }[]>("fixture_seal_counts")
      .then((rows) => { if (live) { const m: Record<string, number> = {}; rows.forEach((r) => m[r.fixture_id] = Number(r.seal_count)); setCounts(m); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return counts;
}
export function usePlayerStats(): Record<string, number> | null {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const uid = useCloud().session?.user.id;
  useEffect(() => {
    if (!uid || !sb()) return;
    let live = true;
    cloudRpc<Record<string, number>>("player_stats").then((r) => live && setStats(r)).catch(() => {});
    return () => { live = false; };
  }, [uid]);
  return stats;
}
export function useFixtureRevealStats(fixtureId: string | null): Record<string, number> | null {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!fixtureId || !sb()) return;
    let live = true;
    cloudRpc<Record<string, number>>("fixture_reveal_stats", { p_fixture_id: fixtureId }).then((r) => live && setStats(r)).catch(() => {});
    return () => { live = false; };
  }, [fixtureId]);
  return stats;
}

/** Contest leaderboard with pagination. */
export function useContestBoard(id: string | null): { rows: Rank[] | null; loadMore: () => void; hasMore: boolean; loading: boolean } {
  const [rows, setRows] = useState<Rank[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [curId, setCurId] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !sb()) return;
    let live = true;
    setCurId(id); setRows(null); setHasMore(false);
    cloudRpc<Rank[]>("contest_leaderboard", { p_id: id, p_limit: LB_PAGE, p_offset: 0 })
      .then((data) => {
        if (!live) return;
        const mapped = data.map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
        setRows(mapped);
        setHasMore(mapped.length >= LB_PAGE);
      })
      .catch(() => live && setRows([]));
    return () => { live = false; };
  }, [id]);

  function loadMore() {
    if (!id || !rows || loading) return;
    setLoading(true);
    cloudRpc<Rank[]>("contest_leaderboard", { p_id: id, p_limit: LB_PAGE, p_offset: rows.length })
      .then((data) => {
        const page = data.map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
        setRows([...rows, ...page]);
        setHasMore(page.length >= LB_PAGE);
        setLoading(false);
      }).catch(() => setLoading(false));
  }

  return { rows: curId === id ? rows : null, loadMore, hasMore, loading };
}

// ---------- Automatic claiming ----------
/** Once a fixture has its official result, claim ranked points for this device's sealed calls on it,
 * so players don't have to go back to Reveal. Only seals made on this device hold the move and salt. */
let claiming = false;
export async function autoClaim() {
  if (claiming || !cloud.session || !sb()) return;
  claiming = true;
  try {
    await fixtureStore.refresh();
    const final = new Set(fixtureStore.get().filter((f) => f.homeGoals != null).map((f) => f.id));
    const due = getState().seals.filter((x) => x.game === "classic" && !x.revealed && x.move && final.has(x.round));
    for (const seal of due) {
      try {
        const r = await claimClassic(seal);
        if (r.status !== "pending") markRevealed(seal.id);
      } catch { /* try again next time */ }
    }
  } finally { claiming = false; }
}

let started = false;
/** Start once, on the client. Watches sign-in state and pushes local changes a moment after they happen. */
export function startCloud() {
  const c = sb();
  if (!c || started) return;
  started = true;
  c.auth.onAuthStateChange((event, session) => {
    const was = cloud.session?.user.id;
    set({ session, status: session ? cloud.status : "idle" });
    // Supabase calls must not run inside this callback, so defer the first sync.
    if (session && session.user.id !== was) setTimeout(() => sync(true).then(autoClaim), 0);
    // After Google sends the player back, drop the one-time ?code= from the address bar.
    if (session && new URLSearchParams(location.search).has("code")) {
      const q = new URLSearchParams(location.search); q.delete("code");
      history.replaceState(history.state, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
    }
    if (event === "SIGNED_OUT") set({ status: "idle", error: undefined });
  });
  setInterval(() => { autoClaim(); fixtureStore.refresh(); contestStore.refresh(); }, 5 * 60_000);
  subscribe(() => {
    if (!cloud.session || busy) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => sync(), 1500);
  });
}
