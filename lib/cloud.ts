"use client";
import { useSyncExternalStore } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { getState, mergeCloud, subscribe, type Reward, type Seal } from "./store";

// Optional cloud account (Supabase + Google sign-in). Without the two env vars the app stays guest-only.
// What syncs: profile, the rewards ledger, and each seal's commitment and proof.
// What never syncs: the move and its salt. Those stay on the device until reveal.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // older projects call it the anon key
export const cloudReady = !!(URL && KEY);

let client: SupabaseClient | null = null;
function sb() { return cloudReady ? (client ??= createClient(URL!, KEY!, { auth: { flowType: "pkce" } })) : null; }

type Cloud = { session: Session | null; status: "off" | "idle" | "syncing" | "synced" | "error"; error?: string };
let cloud: Cloud = { session: null, status: cloudReady ? "idle" : "off" };
const SERVER: Cloud = { session: null, status: "off" };
const listeners = new Set<() => void>();
function set(patch: Partial<Cloud>) { cloud = { ...cloud, ...patch }; listeners.forEach((l) => l()); }
export function useCloud(): Cloud {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cloud, () => SERVER);
}

export async function signInWithGoogle() {
  const { error } = (await sb()?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/profile" } })) ?? {};
  if (error) set({ status: "error", error: error.message });
}
export async function signOut() { await sb()?.auth.signOut(); }

const iso = (ms: number) => new Date(ms).toISOString();

async function pull(uid: string) {
  const c = sb()!;
  const [p, se, re] = await Promise.all([
    c.from("profiles").select("name, avatar, address, withdrawn").eq("id", uid).maybeSingle(),
    c.from("seals").select("*").eq("user_id", uid).order("sealed_at", { ascending: false }).limit(200),
    c.from("rewards").select("*").eq("user_id", uid).order("at", { ascending: false }).limit(200),
  ]);
  const err = p.error ?? se.error ?? re.error;
  if (err) throw new Error(err.message);
  const seals: Seal[] = (se.data ?? []).map((r) => ({
    id: r.id, game: r.game, round: r.round, label: r.label, move: "", salt: "", commitment: r.commitment,
    sealedAt: Date.parse(r.sealed_at), status: r.status, root: r.root ?? undefined, proof: r.proof ?? undefined,
    txid: r.txid ?? undefined, height: r.height ?? undefined, mode: r.mode ?? undefined, revealed: r.revealed, remote: true,
  }));
  const ledger: Reward[] = (re.data ?? []).map((r) => ({ id: r.id, label: r.label, points: r.points, zec: Number(r.zec), at: Date.parse(r.at) }));
  mergeCloud({ profile: p.data ?? undefined, withdrawn: Number(p.data?.withdrawn ?? 0), seals, ledger });
}

async function push(uid: string) {
  const c = sb()!, s = getState();
  const mine = s.seals.filter((x) => !x.remote); // only this device's seals; never the move or salt
  const res = await Promise.all([
    c.from("profiles").upsert({ id: uid, name: s.profile.name, avatar: s.profile.avatar, address: s.profile.address, player: s.player, withdrawn: s.withdrawn, updated_at: iso(Date.now()) }),
    mine.length ? c.from("seals").upsert(mine.map((x) => ({
      user_id: uid, id: x.id, game: x.game, round: x.round, label: x.label, commitment: x.commitment, sealed_at: iso(x.sealedAt),
      status: x.status, root: x.root ?? null, proof: x.proof ?? null, txid: x.txid ?? null, height: x.height ?? null, mode: x.mode ?? null, revealed: !!x.revealed,
    }))) : null,
    s.ledger.length ? c.from("rewards").upsert(s.ledger.map((r) => ({ user_id: uid, id: r.id, label: r.label, points: r.points, zec: r.zec, at: iso(r.at) }))) : null,
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
    if (session && session.user.id !== was) setTimeout(() => sync(true), 0);
    if (event === "SIGNED_OUT") set({ status: "idle", error: undefined });
  });
  subscribe(() => {
    if (!cloud.session || busy) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => sync(), 1500);
  });
}
