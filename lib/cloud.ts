"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { addReward, getState, markRevealed, mergeCloud, subscribe, type Reward, type Seal } from "./store";
import { FIXTURES, phaseOf, whenOf, type Fixture } from "./data";
import type { Network } from "./zaddr";

// Optional cloud account (Supabase + Google sign-in). Without the two env vars the app stays guest-only.
// What syncs: profile, the rewards ledger, and each seal's commitment and proof.
// What never syncs: the move and its salt. Those stay on the device until reveal.
// Ranked points are "verified": only the database function claim_classic() can create them.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // older projects call it the anon key
export const cloudReady = !!(URL && KEY);

let client: SupabaseClient | null = null;
export function sb() { return cloudReady ? (client ??= createClient(URL!, KEY!, { auth: { flowType: "pkce" } })) : null; }

type Cloud = { session: Session | null; status: "off" | "idle" | "syncing" | "synced" | "offline" | "error"; error?: string };
let cloud: Cloud = { session: null, status: cloudReady ? "idle" : "off" };
const SERVER: Cloud = { session: null, status: "off" };
const listeners = new Set<() => void>();
function set(patch: Partial<Cloud>) { cloud = { ...cloud, ...patch }; listeners.forEach((l) => l()); }
export function useCloud(): Cloud {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cloud, () => SERVER);
}

const RETRY_DELAYS = [5_000, 15_000, 30_000, 60_000];
const retryDelay = (attempt: number) => RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];

/** True when an error looks like an unreachable network, offline browser, or request timeout. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const msg = e instanceof Error ? e.message
    : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message)
    : String(e ?? "");
  if (e instanceof TypeError && (!msg || /fetch|network|load failed/i.test(msg))) return true;
  return /failed to fetch|networkerror|network error|load failed|fetch failed|internet disconnected|err_network|name not resolved|timed out|timeout|aborted/i.test(msg);
}

/** Schedule retries with escalating backoff (5s, 15s, 30s, 60s...) and immediate recovery on `online`. */
function retryWhenOnline(fn: () => void) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubOnline: (() => void) | null = null;
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (unsubOnline) { unsubOnline(); unsubOnline = null; }
  };
  return {
    schedule(alive: () => boolean) {
      if (timer || !alive()) return;
      const delay = retryDelay(attempt++);
      timer = setTimeout(() => { timer = null; if (alive()) fn(); }, delay);
      if (!unsubOnline && typeof window !== "undefined") {
        const onOnline = () => { clear(); attempt = 0; if (alive()) fn(); };
        window.addEventListener("online", onOnline);
        unsubOnline = () => window.removeEventListener("online", onOnline);
      }
    },
    reset() { attempt = 0; clear(); },
  };
}

export async function signInWithGoogle() {
  // Come back to exactly this page, link details included (?c=contest, ?h=tipster, ?f=match), so a shared
  // link still works after signing in. A leftover ?code= from an earlier sign-in is dropped.
  const q = new URLSearchParams(location.search); q.delete("code");
  const back = location.origin + location.pathname + (q.size ? "?" + q : "");
  const { error } = (await sb()?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: back } })) ?? {};
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

let timer: ReturnType<typeof setTimeout> | null = null, retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0, needPull = false, busy = false, again = false;
function clearSyncRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
function scheduleSyncRetry() {
  if (retryTimer || !cloud.session) return;
  const delay = retryDelay(retryAttempt++);
  retryTimer = setTimeout(() => { retryTimer = null; sync(); }, delay);
}
async function sync(first = false) {
  const uid = cloud.session?.user.id;
  if (!uid) return;
  if (first) needPull = true;
  if (busy) { again = true; return; }
  clearSyncRetry();
  busy = true; set({ status: "syncing", error: undefined });
  try {
    if (needPull) { await pull(uid); needPull = false; }
    await push(uid);
    retryAttempt = 0;
    set({ status: "synced", error: undefined });
  } catch (e) {
    if (isNetworkError(e)) {
      set({ status: "offline", error: undefined });
    } else {
      set({ status: "error", error: e instanceof Error ? e.message : "Sync failed" });
    }
    scheduleSyncRetry();
  }
  busy = false;
  if (again) { again = false; sync(); }
}

/** Push local changes now (used before a claim, so the server has the seal). */
export async function syncNow() {
  if (timer) clearTimeout(timer);
  // A sync already running may have started before the latest change, so wait for it to finish
  // (up to 15s), then run one that is sure to include everything.
  for (let waited = 0; (busy || again) && waited < 15_000; waited += 200) await new Promise((r) => setTimeout(r, 200));
  await sync();
}

export type Claim = { status: "scored" | "pending" | "late"; points?: number; exact?: boolean; result?: boolean; banker?: boolean; final?: string; id?: string; message?: string; streak?: number; streak_mult?: number };
/** Reveal a Classic Call to the server, which re-hashes it and scores it against the official result. */
export async function claimClassic(seal: Seal): Promise<Claim> {
  const c = sb();
  if (!c || !cloud.session) throw new Error("Sign in to earn ranked points.");
  await syncNow();
  const { data, error } = await c.rpc("claim_classic", { p_seal_id: seal.id, p_player: seal.player ?? getState().player, p_move: seal.move, p_salt: seal.salt });
  if (error) throw new Error(error.message);
  const r = data as Claim;
  if (r.status === "scored" && r.points && r.id) addReward(`${seal.label} · Classic Call (verified)${r.banker ? " ⚡ 2x" : ""}`, r.points, { id: r.id, verified: true });
  return r;
}

/** UTC ISO week Monday timestamp string matching Postgres date_trunc('week', kickoff at time zone 'UTC'). */
export function isoWeekStartMs(iso: string): number {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** Find an existing local Classic Call seal in the same UTC week that already carries the 2x Banker boost. */
export function bankerSealInWeek(seals: Seal[], fixtures: Fixture[], kickoffIso: string): Seal | null {
  const wk = isoWeekStartMs(kickoffIso);
  for (const s of seals) {
    if (s.game !== "classic" || !s.move || !s.move.split("|").includes("2X")) continue;
    const fx = fixtures.find((f) => f.id === s.round);
    const k = fx?.kickoff;
    if (k && isoWeekStartMs(k) === wk) return s;
  }
  return null;
}

export type LiveFixtureCall = { name: string; avatar: number; home_goals: number; away_goals: number; banker: boolean; early: boolean; live_points: number; me: boolean };
export type LiveRank = { rank: number; name: string; avatar: number; points: number; live_points: number; me: boolean };

export function useLiveFixtureCalls(fixtureId: string | null, contestId?: string | null) {
  const [calls, setCalls] = useState<LiveFixtureCall[] | null>(null);
  const tick = useVisibleTick(20_000);
  useEffect(() => {
    if (!fixtureId || !sb()) return;
    let live = true;
    cloudRpc<LiveFixtureCall[]>("live_fixture_calls", { p_fixture_id: fixtureId, p_contest_id: contestId ?? null })
      .then((r) => live && setCalls(r.map((x) => ({ ...x, home_goals: Number(x.home_goals), away_goals: Number(x.away_goals), live_points: Number(x.live_points) }))))
      .catch(() => live && setCalls([]));
    return () => { live = false; };
  }, [fixtureId, contestId, tick]);
  return calls;
}

export function useLiveContestBoard(id: string | null, active: boolean) {
  const [rows, setRows] = useState<LiveRank[] | null>(null);
  const tick = useVisibleTick(20_000);
  useEffect(() => {
    if (!id || !active || !sb()) { setRows(null); return; }
    let live = true;
    cloudRpc<LiveRank[]>("contest_live_leaderboard", { p_id: id, p_limit: LB_PAGE, p_offset: 0 })
      .then((r) => live && setRows(r.map((x) => ({ ...x, rank: Number(x.rank), points: Number(x.points), live_points: Number(x.live_points) }))))
      .catch(() => {});
    return () => { live = false; };
  }, [id, active, tick]);
  return rows;
}

export async function requestWithdrawal(address: string): Promise<{ status: "requested" | "too_small"; amount?: number; available?: number }> {
  const c = sb();
  if (!c || !cloud.session) throw new Error("Sign in to request a payout.");
  const { data, error } = await c.rpc("request_withdrawal", { p_address: address.trim() });
  if (error) throw new Error(error.message);
  return data;
}

export type Rank = { rank: number; user_id?: string; name: string; avatar: number; points: number; me: boolean };
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
    const retry = retryWhenOnline(() => load());
    setRows(null); setError(undefined); setHasMore(false);
    function load() {
      c!.rpc("leaderboard", { p_period: period, p_limit: LB_PAGE, p_offset: 0 }).then(({ data, error: err }) => {
        if (!live) return;
        if (err) {
          if (isNetworkError(err)) { retry.schedule(() => live); return; }
          setError(err.message); setRows([]); return;
        }
        retry.reset();
        setError(undefined);
        const mapped = (data as Rank[]).map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points), user_id: r.user_id ?? undefined }));
        setRows(mapped);
        setHasMore(mapped.length >= LB_PAGE);
      });
    }
    load();
    return () => { live = false; retry.reset(); };
  }, [key, period]);

  function loadMore() {
    const c = sb();
    if (!c || !rows || loading) return;
    setLoading(true);
    Promise.resolve(c.rpc("leaderboard", { p_period: period, p_limit: LB_PAGE, p_offset: rows.length })).then(({ data }) => {
      const page = (data as Rank[] ?? []).map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points), user_id: r.user_id ?? undefined }));
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

/** Counts up every `ms` while the page is visible, and once more when it becomes visible again. */
export function useVisibleTick(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setTick((t) => t + 1); };
    const t = setInterval(bump, ms);
    document.addEventListener("visibilitychange", bump);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", bump); };
  }, [ms]);
  return tick;
}

// ---------- Verified tipster profiles ----------
export type TipsterTip = {
  fixture_id: string; home: string; away: string; kickoff: string; home_goals: number; away_goals: number;
  pick: string | null; outcome: "won" | "lost"; exact: boolean; reason: "revealed" | "missing" | "mismatch";
  received_at: string; commitment: string | null; root: string | null; height: number | null;
};
export type Tipster = {
  handle: string; name: string; avatar: number; bio: string; public_since: string;
  followers: number; following: boolean; is_me: boolean;
  settled: number; won: number; exact: number; form: ("won" | "lost")[];
  tips: TipsterTip[]; pending: { home: string; away: string; kickoff: string; received_at: string }[];
};
/** A public tipster record: undefined while loading, null when the handle is unknown or private. */
export function useTipster(handle: string | null): { tipster: Tipster | null | undefined; error?: string } {
  const [state, setState] = useState<{ handle: string | null; tipster: Tipster | null | undefined; error?: string }>({ handle: null, tipster: undefined });
  const tick = useVisibleTick(60_000);
  useEffect(() => {
    const c = sb();
    if (!handle) return;
    if (!c) { setState({ handle, tipster: null, error: "Accounts are not configured." }); return; }
    let live = true;
    const retry = retryWhenOnline(() => load());
    function load() {
      c!.rpc("tipster_profile", { p_handle: handle }).then(({ data, error }) => {
        if (!live) return;
        if (error && isNetworkError(error)) { retry.schedule(() => live); return; }
        retry.reset();
        // A failed background refresh keeps what is already on screen.
        setState((prev) => error && prev.handle === handle && prev.tipster ? prev : { handle, tipster: error ? null : (data as Tipster | null), error: error?.message });
      });
    }
    load();
    return () => { live = false; retry.reset(); };
  }, [handle, tick]);
  return state.handle === handle ? state : { tipster: undefined };
}
export async function followTipster(handle: string, follow: boolean) {
  return cloudRpc<boolean>("follow_tipster", { p_handle: handle, p_follow: follow });
}
/** Tell a public tipster's followers that a tip was sealed. Best effort: the tip stands either way. */
export async function announceTip(sealId: string) {
  if (!cloud.session) return;
  try {
    await syncNow(); // the server must have the seal before it can announce it
    const token = await accessToken();
    if (!token) return;
    const send = () => fetch("/api/tipsters/announce", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ seal_id: sealId }) }).then((r) => r.json());
    const first = await send();
    // The seal can still be on its way to the server: try once more shortly after.
    if (first?.reason === "no such tip") { await new Promise((r) => setTimeout(r, 4000)); await syncNow(); await send(); }
  } catch { /* followers simply miss this one alert */ }
}
export async function saveTipsterProfile(handle: string, bio: string, isPublic: boolean) {
  return cloudRpc<{ handle: string; public: boolean }>("set_tipster_profile", { p_handle: handle, p_bio: bio, p_public: isPublic });
}
export async function myTipsterProfile(): Promise<{ handle: string | null; bio: string; public_record: boolean } | null> {
  const c = sb(), uid = cloud.session?.user.id;
  if (!c || !uid) return null;
  const { data } = await c.from("profiles").select("handle, bio, public_record").eq("id", uid).maybeSingle();
  return data ?? { handle: null, bio: "", public_record: false };
}

// ---------- Tipping ----------
export type Tip = { id: string; direction: string; other_name: string; amount: number; message: string | null; created_at: string };
export function useTipHistory(): Tip[] | null {
  const [tips, setTips] = useState<Tip[] | null>(null);
  const uid = useCloud().session?.user.id;
  useEffect(() => {
    if (!uid || !sb()) return;
    let live = true;
    cloudRpc<Tip[]>("my_tips", { p_limit: 20, p_offset: 0 }).then((r) => live && setTips(r)).catch(() => live && setTips([]));
    return () => { live = false; };
  }, [uid]);
  return tips;
}

// ---------- Fixtures and contests (public tables) ----------
type Listener = () => void;
export type LoadState = "loading" | "ready" | "offline" | "error";
function shared<T>(load: () => Promise<T>, initial: T) {
  let value = initial, state: LoadState = "loading", loading = false;
  const subs = new Set<Listener>();
  const retry = retryWhenOnline(() => refresh());
  const refresh = async () => {
    if (loading) return;
    loading = true;
    // After a successful load, a failed refresh keeps showing the last good data.
    try {
      value = await load();
      state = "ready";
      retry.reset();
    } catch (e) {
      if (isNetworkError(e)) {
        if (state !== "ready") state = "offline";
        retry.schedule(() => subs.size > 0);
      } else if (state !== "ready") {
        state = "error";
      }
    }
    loading = false;
    subs.forEach((l) => l());
  };
  const sub = (l: Listener) => {
    subs.add(l);
    if (state !== "ready") refresh();
    return () => { subs.delete(l); if (subs.size === 0) retry.reset(); };
  };
  return {
    refresh,
    get: () => value,
    use(): T {
      return useSyncExternalStore(sub, () => value, () => initial);
    },
    useLoadState(): LoadState {
      return useSyncExternalStore(sub, () => state, () => "loading");
    },
  };
}

const nowSubs = new Set<Listener>();
let nowTick: ReturnType<typeof setInterval> | null = null;
const roundNow = () => Math.floor(Date.now() / 30_000) * 30_000;
/** Current time in 30s steps; null during SSR and hydration so server and client render the same. */
export function useNow(): number | null {
  return useSyncExternalStore((l) => {
    nowSubs.add(l);
    nowTick ??= setInterval(() => nowSubs.forEach((s) => s()), 30_000);
    return () => { nowSubs.delete(l); if (!nowSubs.size && nowTick) { clearInterval(nowTick); nowTick = null; } };
  }, roundNow, () => null);
}

const fixtureStore = shared<Fixture[]>(async () => {
  const c = sb();
  if (!c) return FIXTURES;
  const base = "id, home, away, kickoff, home_goals, away_goals";
  let res: { data: unknown[] | null; error: unknown } = await c.from("fixtures").select(`${base}, status, live_home, live_away, league`).order("kickoff");
  // Databases without the newer migrations lack some columns; fall back step by step.
  if (res.error) res = await c.from("fixtures").select(`${base}, status, live_home, live_away`).order("kickoff");
  if (res.error) res = await c.from("fixtures").select(base).order("kickoff");
  if (res.error) throw res.error;
  return ((res.data ?? []) as Record<string, unknown>[]).map((f) => ({
    id: f.id as string, home: f.home as string, away: f.away as string, kickoff: f.kickoff as string, when: whenOf(f.kickoff as string),
    homeGoals: f.home_goals as number | null, awayGoals: f.away_goals as number | null,
    status: (f.status as string | null) ?? null, liveHome: (f.live_home as number | null) ?? null, liveAway: (f.live_away as number | null) ?? null,
    league: (f.league as string | null) ?? null,
  }));
}, FIXTURES);
export const useFixtures = () => fixtureStore.use();
export const useFixturesState = () => fixtureStore.useLoadState();
export const refreshFixtures = () => fixtureStore.refresh();

// Realtime and live polling, browser only.
if (typeof window !== "undefined") {
  let started = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const refreshSoon = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => fixtureStore.refresh(), 500); };
  // Only poll the score feed when this tab is visible and a match is in play or about to start.
  const matchNear = () => {
    const now = Date.now();
    return fixtureStore.get().some((f) => phaseOf(f, now) === "live" || (phaseOf(f, now) === "upcoming" && Date.parse(f.kickoff) - now < 5 * 60_000));
  };
  const poll = async () => {
    if (document.visibilityState !== "visible") return;
    if (matchNear()) { try { await fetch("/api/live"); } catch { /* the server throttles and reports its own errors */ } }
    refreshSoon();
  };
  const startLive = () => {
    if (started) return;
    started = true;
    sb()?.channel("fixtures-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "fixtures" }, refreshSoon)
      .subscribe();
    setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
  };
  if (document.readyState === "complete") startLive();
  else window.addEventListener("load", startLive, { once: true });
}

/** pending → sending → paid for prizes Called It pays; pending → sent → paid (or disputed) when the sponsor pays. */
export type WinnerStatus = "pending" | "sending" | "sent" | "disputed" | "paid" | "unclaimed";
export type Contest = {
  id: string; title: string; sponsor: string | null; prize_zec: number; fixture_ids: string[];
  status: "open" | "closed"; winners: { rank: number; name: string; points: number; zec: number; address?: string; user_id?: string; status?: WinnerStatus; txid?: string | null }[] | null;
  sponsor_logo: string | null; sponsor_color: string | null; sponsor_url: string | null;
  owner_id?: string | null; opens_at?: string | null; paused?: boolean; hidden?: boolean; funded_zec?: number; pay_by?: string | null;
  prize_structure: "top3" | "top5" | "top10" | "top20" | "all_correct" | "random_draw" | "custom" | "equal_split";
  entry_deadline: string | null; description: string | null;
  custom_shares?: number[] | null;
  /** football (score predictions) or one multiplayer game played in contest rooms until ends_at. */
  game?: ContestGame; ends_at?: string | null;
};
export type ContestGame = "football" | "arcade" | "bluff" | "fog" | "werewolf";
const contestStore = shared<Contest[]>(async () => {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c.from("contests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((x) => ({ ...x, prize_zec: Number(x.prize_zec), funded_zec: Number(x.funded_zec ?? 0) }));
}, []);
// ---------- Sponsor dashboard ----------
export type SponsorMatch = { id: string; home: string; away: string; kickoff: string; home_goals: number | null; away_goals: number | null; sealed: number };
export type SponsorContest = Contest & { created_at: string; entries: number; funded_zec: number; games_played?: number; matches: SponsorMatch[] };
export type SponsorDashboard = { name: string; limit_zec: number; owed_zec: number; contests: SponsorContest[] };
/** The signed-in sponsor's own contests with live numbers; null for anyone who is not a sponsor, undefined while loading. */
export function useSponsorDashboard(): { data: SponsorDashboard | null | undefined; reload: () => void } {
  const uid = useCloud().session?.user.id;
  const [data, setData] = useState<SponsorDashboard | null | undefined>(undefined);
  const [n, setN] = useState(0);
  const tick = useVisibleTick(30_000);
  useEffect(() => {
    if (!uid || !sb()) { setData(null); return; }
    let live = true;
    const retry = retryWhenOnline(() => load());
    function load() {
      cloudRpc<SponsorDashboard | null>("sponsor_dashboard").then((d) => {
        if (!live) return;
        retry.reset();
        setData(d && { ...d, limit_zec: Number(d.limit_zec ?? 0.5), owed_zec: Number(d.owed_zec ?? 0), contests: d.contests.map((c) => ({ ...c, prize_zec: Number(c.prize_zec), funded_zec: Number(c.funded_zec) })) });
      }).catch((e) => {
        if (!live) return;
        if (isNetworkError(e)) { retry.schedule(() => live); return; }
        setData((prev) => prev ?? null);
      });
    }
    load();
    return () => { live = false; retry.reset(); };
  }, [uid, tick, n]);
  return { data, reload: () => setN((x) => x + 1) };
}

// ---------- Sponsors pay their winners directly ----------
export type Payee = { rank: number; name: string; zec: number; status: WinnerStatus; txid: string | null; address: string | null };
/** Who the sponsor owes, with each winner's current shielded address (null if they haven't added a valid one). */
export const sponsorPayees = async (id: string) =>
  (await cloudRpc<Payee[]>("sponsor_payees", { p_contest_id: id })).map((p) => ({ ...p, zec: Number(p.zec) }));
export const sponsorMarkSent = (id: string, rank: number, txid: string | null) =>
  cloudRpc<boolean>("sponsor_mark_sent", { p_contest_id: id, p_rank: rank, p_txid: txid });
export const confirmPrize = (id: string, rank: number, received: boolean) =>
  cloudRpc<boolean>("confirm_prize", { p_contest_id: id, p_rank: rank, p_received: received });

export type SponsorPrize = { contest_id: string; title: string; sponsor: string | null; rank: number; zec: number; status: WinnerStatus; txid: string | null; pay_by: string | null };
/** The signed-in player's prizes from sponsor contests; reload after confirming one. */
export function useMySponsorPrizes(): { prizes: SponsorPrize[] | null; reload: () => void } {
  const uid = useCloud().session?.user.id;
  const [prizes, setPrizes] = useState<SponsorPrize[] | null>(null);
  const [n, setN] = useState(0);
  const tick = useVisibleTick(60_000);
  useEffect(() => {
    if (!uid || !sb()) { setPrizes(null); return; }
    let live = true;
    const retry = retryWhenOnline(() => load());
    function load() {
      cloudRpc<SponsorPrize[]>("my_sponsor_prizes").then((r) => {
        if (!live) return;
        retry.reset();
        setPrizes(r.map((p) => ({ ...p, zec: Number(p.zec) })));
      }).catch((e) => {
        if (!live) return;
        if (isNetworkError(e)) { retry.schedule(() => live); return; }
        setPrizes((x) => x ?? []);
      });
    }
    load();
    return () => { live = false; retry.reset(); };
  }, [uid, tick, n]);
  return { prizes, reload: () => setN((x) => x + 1) };
}

export type SponsorRecord = { owner_id: string; contests: number; paid_contests: number; overdue_contests: number; paid_zec: number };
const recordStore = shared<Record<string, SponsorRecord>>(async () => {
  if (!sb()) return {};
  const rows = await cloudRpc<SponsorRecord[]>("sponsor_records");
  return Object.fromEntries(rows.map((r) => [r.owner_id, { ...r, contests: Number(r.contests), paid_contests: Number(r.paid_contests), overdue_contests: Number(r.overdue_contests), paid_zec: Number(r.paid_zec) }]));
}, {});
/** Every sponsor's public payment record, keyed by owner id. */
export const useSponsorRecords = () => recordStore.use();

// ---------- Usernames (@handle, like x.com/username) ----------
/** The signed-in player's @username; every account gets one automatically. Null when signed out. */
const handleStore = shared<string | null>(async () => {
  if (!sb() || !(await sb()!.auth.getSession()).data.session) return null;
  return (await cloudRpc<string | null>("ensure_username")) ?? null;
}, null);
export const useMyHandle = () => handleStore.use();
export const refreshMyHandle = () => handleStore.refresh();
export const setUsername = async (h: string) => { const v = await cloudRpc<string>("set_username", { p_handle: h }); await handleStore.refresh(); return v; };
/** Stats are null unless the player shows them (or it's your own card); zec_received is only ever yours. */
export type PlayerCard = { handle: string; name: string; avatar: number; bio: string | null; joined: string | null; tipster: boolean; stats_public: boolean; points: number | null; calls: number | null; contests_won: number | null; zec_received: number | null; me: boolean };
export type Privacy = { show_stats: boolean; searchable: boolean };
export const myPrivacy = () => cloudRpc<Privacy | null>("my_privacy");
export const setPrivacy = (p: Privacy) => cloudRpc<boolean>("set_privacy", { p_show_stats: p.show_stats, p_searchable: p.searchable });
export const playerCard = (h: string) => cloudRpc<PlayerCard | null>("player_card", { p_handle: h });
export type PlayerHit = { handle: string; name: string; avatar: number };
export const searchPlayers = (q: string) => cloudRpc<PlayerHit[]>("search_players", { p_query: q });

/** Whether the public can see a contest: not hidden by the admin and past its opening time. */
export const isListed = (c: Contest, now = Date.now()) => !c.hidden && (!c.opens_at || Date.parse(c.opens_at) <= now);
/** Contests the public sees. Owners and the admin also receive their unlisted ones; those are filtered out here. */
export const useContests = () => contestStore.use().filter((c) => isListed(c));
/** Every contest the database lets this person see, including their own scheduled or hidden ones. */
export const useAllContests = () => contestStore.use();

// ---------- App settings ----------
type Settings = { fund_address: string | null; network: Network };
const settingsStore = shared<Settings>(async () => {
  const c = sb();
  if (!c) return { fund_address: null, network: "mainnet" };
  const { data, error } = await c.from("app_settings").select("key, value");
  if (error) throw error;
  const get = (k: string) => (data ?? []).find((r) => r.key === k)?.value as string | undefined;
  return { fund_address: get("fund_address") ?? null, network: get("network") === "testnet" ? "testnet" : "mainnet" };
}, { fund_address: null, network: "mainnet" });
/** The operator's prize-fund wallet for Boost the Pot and sponsor funding; null when none is set. */
export const useFundAddress = () => settingsStore.use().fund_address;
/** Which Zcash network prizes are paid on: mainnet for real ZEC, testnet for a practice run. */
export const useNetwork = () => settingsStore.use().network;
export const refreshFundAddress = () => settingsStore.refresh();
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
  const tick = useVisibleTick(30_000);
  useEffect(() => {
    if (!id || !sb()) return;
    let live = true;
    cloudRpc<number>("contest_entry_count", { p_id: id }).then((n) => live && setCount(Number(n))).catch(() => {});
    return () => { live = false; };
  }, [id, tick]);
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
    const retry = retryWhenOnline(() => load());
    setCurId(id); setRows(null); setHasMore(false);
    function load() {
      cloudRpc<Rank[]>("contest_leaderboard", { p_id: id, p_limit: LB_PAGE, p_offset: 0 })
        .then((data) => {
          if (!live) return;
          retry.reset();
          const mapped = data.map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
          setRows(mapped);
          setHasMore(mapped.length >= LB_PAGE);
        })
        .catch((e) => {
          if (!live) return;
          if (isNetworkError(e)) { retry.schedule(() => live); return; }
          setRows([]);
        });
    }
    load();
    return () => { live = false; retry.reset(); };
  }, [id]);

  // Keep the first page current while the page is open; leave it alone once more pages are loaded.
  const tick = useVisibleTick(30_000);
  const firstPageOnly = !rows || rows.length <= LB_PAGE;
  useEffect(() => {
    if (!tick || !id || !sb() || !firstPageOnly) return;
    let live = true;
    cloudRpc<Rank[]>("contest_leaderboard", { p_id: id, p_limit: LB_PAGE, p_offset: 0 })
      .then((data) => {
        if (!live) return;
        const mapped = data.map((r) => ({ ...r, rank: Number(r.rank), points: Number(r.points) }));
        setRows(mapped);
        setHasMore(mapped.length >= LB_PAGE);
      })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, id]);

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

const KICKOFF_DONE_KEY = "calledit:kickoff-revealed";
function getKickedOff(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KICKOFF_DONE_KEY) || "[]")); } catch { return new Set(); }
}
function markKickedOff(id: string) {
  try { const s = getKickedOff(); s.add(id); localStorage.setItem(KICKOFF_DONE_KEY, JSON.stringify([...s].slice(-200))); } catch {}
}

/** Reveal local sealed calls for matches whose kickoff has arrived, unlocking live matchday standings. */
let revealingKickoff = false;
export async function autoRevealAtKickoff() {
  const c = sb();
  if (revealingKickoff || !cloud.session || !c) return;
  revealingKickoff = true;
  try {
    await fixtureStore.refresh();
    const now = Date.now();
    const kicked = new Map(fixtureStore.get().filter((f) => Date.parse(f.kickoff) <= now).map((f) => [f.id, f]));
    const done = getKickedOff();
    const due = getState().seals.filter((x) => x.game === "classic" && !x.revealed && x.move && kicked.has(x.round) && !done.has(x.id));
    if (!due.length) return;
    await syncNow();
    for (const seal of due) {
      const fx = kicked.get(seal.round)!;
      if (seal.sealedAt >= Date.parse(fx.kickoff)) { markKickedOff(seal.id); continue; }
      try {
        await c.rpc("reveal_at_kickoff", { p_seal_id: seal.id, p_player: seal.player ?? getState().player, p_move: seal.move, p_salt: seal.salt });
        markKickedOff(seal.id);
      } catch { /* retry next pass */ }
    }
  } finally { revealingKickoff = false; }
}

// ---------- Automatic claiming ----------
/** Once a fixture has its official result, claim ranked points for this device's sealed calls on it,
 * so players don't have to go back to Reveal. Only seals made on this device hold the move and salt. */
let claiming = false;
export async function autoClaim() {
  await autoRevealAtKickoff();
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
    if (session && session.user.id !== was) setTimeout(() => sync(true).then(autoClaim).then(() => handleStore.refresh()), 0);
    if (!session && was) setTimeout(() => handleStore.refresh(), 0);
    // Owners and the admin see contests the public can't, so reload the list when the account changes.
    if ((session?.user.id ?? null) !== (was ?? null)) setTimeout(() => contestStore.refresh(), 0);
    // After Google sends the player back, drop the one-time ?code= from the address bar.
    if (session && new URLSearchParams(location.search).has("code")) {
      const q = new URLSearchParams(location.search); q.delete("code");
      history.replaceState(history.state, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
    }
    if (event === "SIGNED_OUT") { clearSyncRetry(); retryAttempt = 0; needPull = false; set({ status: "idle", error: undefined }); }
  });
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      clearSyncRetry();
      retryAttempt = 0;
      if (cloud.session && (cloud.status === "offline" || needPull)) sync().then(autoClaim);
      else if (cloud.session) autoClaim();
      fixtureStore.refresh();
      contestStore.refresh();
      recordStore.refresh();
      handleStore.refresh();
      settingsStore.refresh();
    });
    window.addEventListener("offline", () => {
      if (cloud.session && !busy) {
        set({ status: "offline", error: undefined });
        scheduleSyncRetry();
      }
    });
  }
  setInterval(() => { autoClaim(); fixtureStore.refresh(); contestStore.refresh(); }, 5 * 60_000);
  subscribe(() => {
    if (!cloud.session || busy) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => sync(), 1500);
  });
}

// --- Wallet backup RPCs ---
export type WalletBackup = { network: string; ciphertext: string; iv: string; salt: string; kdf: string; backup_verified: boolean };
export const saveWalletBackup = (network: string, ciphertext: string, iv: string, salt: string, kdf = "argon2id") =>
  cloudRpc<boolean>("save_wallet_backup", { p_network: network, p_ciphertext: ciphertext, p_iv: iv, p_salt: salt, p_kdf: kdf });
export const getWalletBackup = () => cloudRpc<WalletBackup | null>("get_wallet_backup");
export const verifyWalletBackup = () => cloudRpc<boolean>("verify_wallet_backup");
