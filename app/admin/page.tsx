"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BottomNav, Img } from "@/components/ui";
import { zip321 } from "@/lib/zip321";
import { askConfirm, askText } from "@/components/dialog";
import { LEAGUES, leagueName } from "@/lib/leagues";
import { Chips } from "@/components/chips";
import { accessToken, cloudReady, cloudRpc, refreshContests, refreshFixtures, refreshFundAddress, signInWithGoogle, useCloud, useAllContests, useFixtures, useNetwork, usePointSettings, type Contest } from "@/lib/cloud";
import { addressOf, balanceOf, createAccount, isPhrase, newPhrase, openWallet, savedPhrase, sendZec, syncWallet, zatsOf, zecOf } from "@/lib/in-app-wallet";
import { encryptPhrase } from "@/lib/wallet-crypto";
import { saveWalletBackup, verifyWalletBackup } from "@/lib/cloud";
import { unlockWalletPhrase } from "@/lib/wallet-unlock";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { short } from "@/lib/store";

type Overview = { players: number; seals: number; ranked_points: number; requested_zec: number; withdrawals: { id: string; address: string; amount: number; status: string; txid: string | null; created_at: string; name: string }[] };
type Txs = { anchors: { txid: string; height: number | null; root: string; seals: number; players: number; last_seal: string }[]; payouts: { txid: string | null; amount: number; address: string; created_at: string; name: string }[] };
type Act = (name: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;
const TABS = ["Overview", "Fixtures", "Contests", "Payouts", "Credit", "Transactions"] as const;
type Tab = (typeof TABS)[number];

const field: React.CSSProperties = { height: 46, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 15, fontWeight: 600, minWidth: 0, width: "100%" };
const card: React.CSSProperties = { padding: 18, display: "flex", flexDirection: "column", gap: 12 };
const btn = (bg: string, fg = "#111"): React.CSSProperties => ({ minHeight: 42, padding: "0 16px", borderRadius: 14, border: "2px solid #111", background: bg, color: fg, fontWeight: 800, fontSize: 14 });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Tx({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span style={{ color: "#8a8170" }}>–</span>;
  return (
    <button title={`${id} (click to copy)`} onClick={() => { navigator.clipboard?.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="mono" style={{ background: "#111", color: "var(--lime)", border: 0, borderRadius: 8, padding: "3px 8px", fontSize: 12, cursor: "copy" }}>
      {copied ? "copied ✓" : short(id)}
    </button>
  );
}
const Chip = ({ text, bg }: { text: string; bg: string }) => <span className="chip" style={{ background: bg, whiteSpace: "nowrap" }}>{text}</span>;

export default function Admin() {
  const signedIn = !!useCloud().session;
  const [status, setStatus] = useState<{ is_admin: boolean; has_admins: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ov, setOv] = useState<Overview | null>(null), [txs, setTxs] = useState<Txs | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await cloudRpc<{ is_admin: boolean; has_admins: boolean }>("admin_status");
      setStatus(s);
      if (s.is_admin) {
        const [o, t] = await Promise.all([cloudRpc<Overview>("admin_overview"), cloudRpc<Txs>("admin_transactions")]);
        setOv(o); setTxs(t);
      }
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : "Could not load", bad: true }); }
  }, []);
  useEffect(() => { if (cloudReady) load(); }, [load, signedIn]);

  const act: Act = async (name, args, ok) => {
    setMsg({ text: "Working…" });
    try { await cloudRpc(name, args); setMsg({ text: ok }); await Promise.all([load(), refreshFixtures(), refreshContests()]); return true; }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : "Failed", bad: true }); return false; }
  };

  let gate: React.ReactNode = null;
  if (!cloudReady) gate = <p style={{ margin: 0 }}>Accounts are not configured on this deployment.</p>;
  else if (!signedIn) gate = <><p style={{ margin: 0 }}>Sign in with the account that runs Called It.</p><button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} onClick={signInWithGoogle}>Sign in with Google</button></>;
  else if (!status) gate = <p style={{ margin: 0 }}>Checking access…</p>;
  else if (!status.is_admin && !status.has_admins) gate = <><p style={{ margin: 0 }}>There is no admin yet. The first account to claim it runs Called It.</p><button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} onClick={() => act("claim_first_admin", {}, "You are now the admin.")}>Claim admin</button></>;
  else if (!status.is_admin) gate = <p style={{ margin: 0 }}>This area is for the Called It admin only.</p>;

  const pending = ov?.withdrawals.filter((w) => w.status === "requested").length ?? 0;

  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><Link href="/" className="admin-back" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>← Back to the app</Link><h1 className="display" style={{ margin: 0, fontSize: 34 }}>Admin</h1></div>
        <span className="chip" style={{ background: "var(--amber)", transform: "rotate(2deg)", padding: "6px 10px" }}>RUN THE GAME</span>
      </div>

      {gate ? (
        <section className="paper" style={{ ...card, marginTop: 18, maxWidth: 560, fontSize: 15, fontWeight: 600, boxShadow: "6px 6px 0 var(--lime)" }}>{gate}{msg && <span style={{ fontSize: 13, fontWeight: 800, color: msg.bad ? "#9a2d1d" : "#3d6b00" }}>{msg.text}</span>}</section>
      ) : (
        <>
          <div role="tablist" className="admin-toptabs" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "14px 0 6px" }}>
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ height: 44, padding: "0 16px", borderRadius: 12, border: `2px solid ${tab === t ? "#111" : "var(--line)"}`, background: tab === t ? "var(--lime)" : "var(--panel)", color: tab === t ? "#111" : "#c9d3de", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>
                {t}{t === "Payouts" && pending ? ` (${pending})` : ""}
              </button>
            ))}
          </div>
          {msg && <div role="status" style={{ padding: "4px 0 8px", fontSize: 13, fontWeight: 800, color: msg.bad ? "var(--pink)" : "var(--lime)" }}>{msg.text}</div>}
          <div style={{ padding: "8px 0 28px" }}>
            {tab === "Overview" && <OverviewTab ov={ov} txs={txs} go={setTab} />}
            {tab === "Fixtures" && <FixturesTab act={act} />}
            {tab === "Contests" && <ContestsTab act={act} onReload={load} />}
            {tab === "Payouts" && <PayoutsTab ov={ov} act={act} onReload={load} />}
            {tab === "Credit" && <CreditTab act={act} />}
            {tab === "Transactions" && <TransactionsTab txs={txs} />}
          </div>
        </>
      )}
      {gate ? <BottomNav active="/" /> : <AdminTabBar tab={tab} setTab={setTab} pending={pending} />}
    </main>
  );
}

function demoMatch(act: Act) {
  const k = new Date(Date.now() + 10 * 60_000);
  return act("admin_upsert_fixture", { p_id: slug(`demo-${k.toISOString().slice(0, 16)}`), p_home: "Demo United", p_away: "Test City", p_kickoff: k.toISOString() }, "Demo match added. It kicks off in 10 minutes: seal it from Home now.");
}

type WalletHealth = { ok: boolean; mode?: string; queued?: number; mined?: number; error?: string };

function useWalletHealth() {
  const [health, setHealth] = useState<WalletHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/anchor/health", { headers: { authorization: `Bearer ${await accessToken()}` } });
      if (!r.ok) { setError(r.status === 403 ? "Admin access required" : `Couldn't load timestamp status (${r.status})`); return; }
      setHealth(await r.json());
      setError(null);
    } catch { setError("Couldn't load timestamp status"); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { health, error, refresh };
}

type Conn = { name: string; purpose: string; url: string; ok: boolean; ms: number; note?: string };

/** Each outside service, what it's for, and whether it answers right now. */
function Connections() {
  const [rows, setRows] = useState<Conn[] | null>(null), [n, setN] = useState(0);
  const [pushMsg, setPushMsg] = useState("");
  useEffect(() => { setRows(null); fetch("/api/health").then((r) => r.json()).then(setRows).catch(() => setRows([])); }, [n]);
  async function testPush() {
    setPushMsg("Sending test push…");
    try {
      const r = await fetch("/api/admin/test-push", { method: "POST", headers: { authorization: `Bearer ${await accessToken()}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setPushMsg(`Sent test push to ${j.sent} device(s).`);
    } catch (e) { setPushMsg(e instanceof Error ? e.message : "Push failed"); }
  }
  return (
    <section style={{ borderRadius: 26, background: "#111", color: "var(--paper)", border: "3px solid var(--line)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "var(--lime)" }}>Connections</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" onClick={testPush} style={{ background: "none", border: 0, fontWeight: 800, fontSize: 12, color: "var(--amber)", textDecoration: "underline", cursor: "pointer" }}>Test push</button>
          <button type="button" onClick={() => setN((x) => x + 1)} style={{ background: "none", border: 0, fontWeight: 800, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>Check again</button>
        </div>
      </div>
      {pushMsg && <div style={{ fontSize: 12, fontWeight: 700, color: pushMsg.startsWith("Sent") ? "var(--lime)" : "var(--pink)" }}>{pushMsg}</div>}
      {rows === null && <div style={{ fontSize: 13, color: "var(--muted)" }}>Checking…</div>}
      {rows?.map((c) => (
        <div key={c.name} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
          <span aria-label={c.ok ? "working" : "not answering"} style={{ fontWeight: 900, color: c.ok ? "var(--lime)" : "var(--red)" }}>{c.ok ? "✓" : "✗"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <b>{c.name} <span style={{ fontWeight: 600, color: "var(--muted)" }}>· {c.ok ? `${c.ms} ms${c.note ? ` · ${c.note}` : ""}` : c.note}</span></b>
            <span style={{ color: "#c9d3de" }}>{c.purpose}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)", overflowWrap: "anywhere" }}>{c.url}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function OverviewTab({ ov, txs, go }: { ov: Overview | null; txs: Txs | null; go: (t: Tab) => void }) {
  const fixtures = useFixtures();
  const wallet = useWalletHealth();
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [fixtures]);
  const awaiting = fixtures.filter((f) => f.homeGoals == null && now && Date.parse(f.kickoff) <= now);
  const stats: [string, string | number][] = [["Players", ov?.players ?? "…"], ["Seals synced", ov?.seals ?? "…"], ["Ranked points", ov?.ranked_points ?? "…"], ["Payouts owed", ov ? `${Number(ov.requested_zec).toFixed(4)}` : "…"]];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ borderRadius: 26, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="eyebrow">At a glance</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {stats.map(([k, v]) => <div key={k} style={{ background: "#111", color: "var(--paper)", borderRadius: 16, padding: "12px 14px" }}><div className="display" style={{ fontSize: 30 }}>{v}</div><div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{k}{k === "Payouts owed" ? " (ZEC)" : ""}</div></div>)}
        </div>
      </section>

      <Connections />

      <section style={{ borderRadius: 26, background: "#111", color: "var(--paper)", border: "3px solid var(--line)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>Bitcoin timestamps</span>
          <button onClick={wallet.refresh} style={{ background: "none", border: 0, fontWeight: 800, fontSize: 12, color: "var(--muted)" }}>Refresh</button>
        </div>
        {wallet.error ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{wallet.error}</div>
        ) : !wallet.health ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Loading…</div>
        ) : wallet.health.mode === "simulated" ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Simulated mode: set SUPABASE_SERVICE_ROLE_KEY to timestamp on Bitcoin.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <div><div className="display" style={{ fontSize: 32, color: "var(--lime)" }}>{wallet.health.mined ?? 0}</div><div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>batches confirmed in a Bitcoin block</div></div>
              <div><div className="display" style={{ fontSize: 32, color: "var(--amber)" }}>{wallet.health.queued ?? 0}</div><div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>waiting for a block (usually a few hours)</div></div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Seals are batched and timestamped through OpenTimestamps for free. Each batch confirms once players&apos; apps check it after the calendars commit.</div>
          </>
        )}
      </section>

      <section className="paper" style={{ ...card, boxShadow: "6px 6px 0 var(--lime)" }}>
        <span className="eyebrow" style={{ color: "#5b6b12" }}>To do</span>
        {awaiting.length === 0 && !(ov?.withdrawals.some((w) => w.status === "requested")) && <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#4a4436" }}>Nothing waiting on you.</p>}
        {awaiting.map((f) => (
          <button key={f.id} onClick={() => go("Fixtures")} style={{ ...btn("#fff"), display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}>
            <span>Enter the result: {f.home} vs {f.away}</span><span>→</span>
          </button>
        ))}
        {ov?.withdrawals.some((w) => w.status === "requested") && <button onClick={() => go("Payouts")} style={{ ...btn("#fff"), display: "flex", justifyContent: "space-between" }}><span>Payout requests waiting</span><span>→</span></button>}
        <div style={{ borderTop: "2px dashed #c9bfa6", paddingTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn("var(--lime)")} onClick={() => go("Fixtures")}>Import fixtures</button>
          <button style={btn("var(--paper)")} onClick={() => go("Contests")}>Manage contests</button>
        </div>
      </section>

      <section className="paper" style={{ ...card, gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="eyebrow" style={{ color: "#5b6b12" }}>Zcash testnet anchors (first build)</span>
          <button onClick={() => go("Transactions")} style={{ background: "none", border: 0, fontWeight: 800, textDecoration: "underline", color: "#111" }}>All transactions</button>
        </div>
        {!txs?.anchors.length && <p style={{ margin: 0, fontSize: 14, color: "#4a4436" }}>None recorded. Seals are now timestamped on Bitcoin (see Bitcoin timestamps).</p>}
        {txs?.anchors.slice(0, 4).map((a) => (
          <div key={a.txid} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: "2px dashed #d8cfb8", paddingBottom: 8, fontSize: 14 }}>
            <Img n="seal" size={28} /><Tx id={a.txid} /><b>{a.seals} seal{a.seals === 1 ? "" : "s"}</b>
            <span style={{ color: "#4a4436" }}>{a.height ? `block ${a.height.toLocaleString()}` : "block pending"} · {time(a.last_seal)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function FixturesTab({ act }: { act: Act }) {
  const fixtures = useFixtures();
  const [home, setHome] = useState(""), [away, setAway] = useState(""), [kick, setKick] = useState("");
  const [scores, setScores] = useState<Record<string, [string, string]>>({});
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [fixtures]);
  const [view, setView] = useState<"needs" | "upcoming" | "final">("needs");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openManual, setOpenManual] = useState<Record<string, boolean>>({});
  const groups = {
    needs: fixtures.filter((f) => f.homeGoals == null && now && Date.parse(f.kickoff) <= now).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)),
    upcoming: fixtures.filter((f) => f.homeGoals == null && (!now || Date.parse(f.kickoff) > now)).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)),
    final: fixtures.filter((f) => f.homeGoals != null).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)),
  };
  const leaguesInView = [...new Set(groups[view].map((f) => f.league).filter(Boolean) as string[])].sort();
  const activeLeague = leaguesInView.includes(leagueFilter) ? leagueFilter : "all";
  const needle = q.trim().toLowerCase();
  const shown = groups[view].filter((f) => (activeLeague === "all" || f.league === activeLeague) && (!needle || `${f.home} ${f.away} ${f.league ?? ""}`.toLowerCase().includes(needle)));
  const PAGE = 20;
  const [limit, setLimit] = useState(PAGE);

  async function add() {
    if (!home.trim() || !away.trim() || !kick) return;
    const iso = new Date(kick).toISOString();
    if (await act("admin_upsert_fixture", { p_id: slug(`${home}-${away}-${iso.slice(0, 16)}`), p_home: home, p_away: away, p_kickoff: iso }, "Fixture added. It shows on Home until kickoff.")) { setHome(""); setAway(""); setKick(""); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Fixtures</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Sealing closes at kickoff. Real results arrive automatically; enter a score by hand only for custom matches.</p>
        <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          {([["needs", "Needs result"], ["upcoming", "Upcoming"], ["final", "Finished"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => { setView(k); setLeagueFilter("all"); setLimit(PAGE); }} style={{ height: 40, borderRadius: 12, border: `2px solid ${view === k ? "#111" : "var(--line)"}`, background: view === k ? "var(--lime)" : "var(--panel)", color: view === k ? "#111" : "#c9d3de", fontWeight: 800, fontSize: 13 }}>{t} ({groups[k].length})</button>
          ))}
        </div>
        <input aria-label="Search fixtures" placeholder="Search a team or league" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} style={{ height: 42, borderRadius: 12, border: "2px solid var(--line)", background: "var(--ink)", color: "var(--text)", padding: "0 12px", fontSize: 14 }} />
        {leaguesInView.length > 0 && (
          <div className="chip-scroll">
            <div style={{ width: "max-content" }}>
              <Chips label="League filter" value={activeLeague} onChange={(v) => { setLeagueFilter(v); setLimit(PAGE); }} options={[["all", "All leagues"], ...leaguesInView.map((l) => [l, l] as const)]} />
            </div>
          </div>
        )}
        {shown.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{view === "needs" ? "Nothing waiting for a result." : "No matches here."}</p>}
        {shown.slice(0, limit).map((f) => {
          const s = scores[f.id] ?? [f.homeGoals?.toString() ?? "", f.awayGoals?.toString() ?? ""];
          const state = f.homeGoals != null ? ["FINAL", "var(--lime)"] : now && Date.parse(f.kickoff) <= now ? ["NEEDS RESULT", "var(--amber)"] : ["OPEN FOR SEALS", "var(--sky)"];
          const isOpen = view === "upcoming" && !openManual[f.id];
          const isCustom = !f.id.startsWith("fd-");
          return (
            <div key={f.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div><div className="display" style={{ fontSize: 18 }}>{f.home} vs {f.away}</div><div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{f.league ? `${f.league} · ` : ""}Kickoff {f.when}</div></div>
                <Chip text={state[0]} bg={state[1]} />
              </div>
              {isOpen ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{isCustom ? "Custom match" : "Score arrives automatically after full time"}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => setOpenManual({ ...openManual, [f.id]: true })} style={{ ...btn("#fff"), minHeight: 34, padding: "0 10px", fontSize: 12 }}>Enter score</button>
                    {isCustom && <button type="button" onClick={async () => { if (await askConfirm({ title: `Delete ${f.home} vs ${f.away}?`, body: "Removes this custom fixture permanently.", confirmLabel: "Delete", danger: true })) act("admin_delete_fixture", { p_id: f.id }, "Fixture removed."); }} style={{ ...btn("#ffefef", "#9a2d1d"), minHeight: 34, padding: "0 10px", fontSize: 12 }}>Delete</button>}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input aria-label={`${f.home} goals`} inputMode="numeric" value={s[0]} onChange={(e) => setScores({ ...scores, [f.id]: [e.target.value.replace(/\D/g, ""), s[1]] })} className="display" style={{ ...field, width: 64, textAlign: "center", fontSize: 22 }} />
                  <span className="display" style={{ fontSize: 22 }}>:</span>
                  <input aria-label={`${f.away} goals`} inputMode="numeric" value={s[1]} onChange={(e) => setScores({ ...scores, [f.id]: [s[0], e.target.value.replace(/\D/g, "")] })} className="display" style={{ ...field, width: 64, textAlign: "center", fontSize: 22 }} />
                  <button style={btn("#111", "var(--lime)")} disabled={s[0] === "" || s[1] === ""} onClick={() => act("admin_set_result", { p_id: f.id, p_home: Number(s[0]), p_away: Number(s[1]) }, `Result saved: ${f.home} ${s[0]}–${s[1]} ${f.away}.`)}>Save result</button>
                  {f.homeGoals != null && <button style={btn("transparent")} onClick={async () => { if (await askConfirm({ title: `Clear the result of ${f.home} vs ${f.away}?`, body: "Players' calls on this match go back to waiting for a result. Only do this to correct a wrong score.", confirmLabel: "Clear result", danger: true })) act("admin_set_result", { p_id: f.id, p_home: null, p_away: null }, "Result cleared."); }}>Clear</button>}
                  {isCustom && <button type="button" onClick={async () => { if (await askConfirm({ title: `Delete ${f.home} vs ${f.away}?`, body: "Removes this custom/demo fixture.", confirmLabel: "Delete", danger: true })) act("admin_delete_fixture", { p_id: f.id }, "Fixture removed."); }} style={{ ...btn("#ffefef", "#9a2d1d"), marginLeft: "auto" }}>Delete</button>}
                </div>
              )}
            </div>
          );
        })}
        {shown.length > limit && <button className="btn btn-quiet" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more ({shown.length - limit} left)</button>}
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <ImportCard />
        <section className="paper" style={{ ...card }}>
          <span className="eyebrow" style={{ color: "#5b6b12" }}>Add a manual fixture</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input aria-label="Home team" placeholder="Home team" value={home} onChange={(e) => setHome(e.target.value)} style={field} />
            <input aria-label="Away team" placeholder="Away team" value={away} onChange={(e) => setAway(e.target.value)} style={field} />
          </div>
          <label style={{ fontSize: 12, fontWeight: 800 }}>Kickoff (your local time)<input type="datetime-local" value={kick} onChange={(e) => setKick(e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ flex: 1, minHeight: 50, fontSize: 15, boxShadow: "0 5px 0 #111" }} onClick={add}>Add fixture</button>
            <button type="button" onClick={() => demoMatch(act)} style={{ background: "none", border: 0, padding: "4px 6px", fontSize: 12, fontWeight: 700, color: "#4a4436", textDecoration: "underline", cursor: "pointer" }}>+ Add test match in 10m</button>
          </div>
        </section>
      </div>
    </div>
  );
}

type Imported = { id: string; home: string; away: string; kickoff: string; homeGoals: number | null; awayGoals: number | null };

/** Real fixtures and results from football-data.org (the key stays on the server). */
function ImportCard() {
  const fixtures = useFixtures();
  const [league, setLeague] = useState("PL"), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  async function pull(kind: "upcoming" | "results") {
    setBusy(true); setNote("Asking football-data.org…");
    try {
      const r = await fetch(`/api/football?competition=${league}&kind=${kind}`, { headers: { authorization: `Bearer ${await accessToken()}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      const matches = j.matches as Imported[];
      const have = new Map(fixtures.map((f) => [f.id, f]));
      let n = 0;
      for (const m of matches) {
        if (kind === "upcoming") { if (!have.has(m.id)) n++; await cloudRpc("admin_upsert_fixture", { p_id: m.id, p_home: m.home, p_away: m.away, p_kickoff: m.kickoff, p_league: leagueName(league) }); }
        if (kind === "results" && have.has(m.id) && have.get(m.id)!.homeGoals == null && m.homeGoals != null && m.awayGoals != null) { await cloudRpc("admin_set_result", { p_id: m.id, p_home: m.homeGoals, p_away: m.awayGoals }); n++; }
      }
      await refreshFixtures();
      setNote(kind === "upcoming" ? `${n} new fixture${n === 1 ? "" : "s"} added (${matches.length} found in the next 10 days).` : `${n} result${n === 1 ? "" : "s"} entered. Players are scored as they open the app.`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Import failed"); }
    setBusy(false);
  }
  return (
    <section className="paper" style={{ ...card }}>
      <span className="eyebrow" style={{ color: "#5b6b12" }}>Real fixtures</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#4a4436", lineHeight: 1.45 }}>Pull real matches and final scores from football-data.org. Results scored this way need no typing.</span>
      <Chips label="Competition" value={league} onChange={setLeague} options={Object.entries(LEAGUES) as [string, string][]} light />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn("var(--lime)")} disabled={busy} onClick={() => pull("upcoming")}>Import next 10 days</button>
        <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={() => pull("results")}>Fetch results</button>
      </div>
      {note && <span role="status" style={{ fontSize: 13, fontWeight: 800 }}>{note}</span>}
    </section>
  );
}

function ContestControls({ c, act }: { c: Contest; act: Act }) {
  const opensLater = c.opens_at && Date.parse(c.opens_at) > Date.now();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontWeight: 700, color: "#4a4436" }}>
        {c.owner_id && <span>Run by the sponsor, who pays the winners directly</span>}
        {opensLater && <span>· opens {time(c.opens_at!)}</span>}
        {c.paused && <span>· joining paused</span>}
        {c.hidden && <span style={{ color: "#9a2d1d" }}>· hidden from the public</span>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button style={{ ...btn(c.hidden ? "var(--lime)" : "#fff"), minHeight: 32, padding: "0 10px", fontSize: 12, marginLeft: "auto" }}
          onClick={() => act("admin_hide_contest", { p_id: c.id, p_hidden: !c.hidden }, c.hidden ? `${c.title} is visible again.` : `${c.title} is hidden from the public.`)}>{c.hidden ? "Unhide" : "Hide"}</button>
      </div>
    </div>
  );
}

type SponsorRow = { email: string; name: string; contests: number; added_at: string; blocked: boolean };
type Dispute = { contest_id: string; title: string; sponsor: string | null; rank: number; winner: string; zec: number; txid: string | null; status_at: string | null };

/** Winners who say a sponsor's payment never arrived. The admin checks and rules. */
function Disputes({ act }: { act: Act }) {
  const [rows, setRows] = useState<Dispute[] | null>(null), [n, setN] = useState(0);
  const net = useNetwork();
  useEffect(() => { cloudRpc<Dispute[]>("admin_prize_disputes").then(setRows).catch(() => setRows([])); }, [n]);
  if (!rows?.length) return null;
  const rule = async (d: Dispute, paid: boolean) => {
    const ok = await askConfirm(paid
      ? { title: `Count #${d.rank} ${d.winner} as paid?`, body: "Do this when the transaction ID shows the payment went through (or the sponsor proved it another way).", confirmLabel: "Count as paid" }
      : { title: `Ask ${d.sponsor ?? "the sponsor"} to pay again?`, body: "The prize goes back to waiting, and the sponsor gets 72 more hours before they are marked overdue.", confirmLabel: "Not paid", danger: true });
    if (ok && await act("admin_resolve_prize", { p_contest_id: d.contest_id, p_rank: d.rank, p_paid: paid }, paid ? "Counted as paid." : "Sent back to the sponsor.")) setN((x) => x + 1);
  };
  return (
    <section className="paper" style={{ ...card, boxShadow: "6px 6px 0 var(--red)" }}>
      <span className="eyebrow" style={{ color: "#9a2d1d" }}>Payment disputes · {rows.length}</span>
      {rows.map((d) => (
        <div key={`${d.contest_id}-${d.rank}`} style={{ display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px dashed #d8cfb8", paddingBottom: 8, fontSize: 13 }}>
          <b>{d.title} · #{d.rank} {d.winner} · {d.zec} ZEC</b>
          <span style={{ color: "#4a4436" }}>{d.sponsor ?? "Sponsor"} marked it sent{d.txid ? "" : " without a transaction ID"}; the winner says it hasn&apos;t arrived.</span>
          {d.txid && <a href={`https://blockexplorer.one/zcash/${net === "testnet" ? "testnet" : "mainnet"}/tx/${d.txid}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, overflowWrap: "anywhere", textDecoration: "underline" }}>Check transaction {d.txid}</a>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={btn("var(--lime)")} onClick={() => rule(d, true)}>It was paid</button>
            <button style={btn("#fff")} onClick={() => rule(d, false)}>Not paid</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Sponsors({ act }: { act: Act }) {
  const [list, setList] = useState<SponsorRow[] | null>(null);
  const [email, setEmail] = useState(""), [name, setName] = useState("");
  const load = useCallback(() => { cloudRpc<SponsorRow[]>("admin_sponsors").then(setList).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  async function set(e: string, n: string, on: boolean) {
    if (await act("admin_set_sponsor", { p_email: e, p_name: n, p_on: on }, on ? `${n} can sponsor again.` : `${n} is blocked: they can't create or change contests. Hide their contests below if needed.`)) { setEmail(""); setName(""); load(); }
  }
  const f = { height: 40, borderRadius: 10, border: "2px solid var(--line)", background: "var(--ink)", color: "var(--text)", padding: "0 10px", fontSize: 14, flex: "1 1 160px", minWidth: 0 } as const;
  return (
    <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      <span className="display" style={{ fontSize: 18 }}>Sponsors</span>
      <span style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>Anyone signed in can start sponsoring from /sponsor; their contests go public without approval, and sponsors pay their winners directly from their own wallets. New sponsors can promise up to 0.5 ZEC, rising with every ZEC their winners confirm. A sponsor with winners unpaid after 72 hours can&apos;t start new contests, and their record shows it on every contest. Block a sponsor to stop them creating or changing contests.</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input aria-label="Sponsor sign-in email" placeholder="Block by sign-in email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" style={f} />
        <button className="btn" disabled={!email.trim()} onClick={() => set(email, name, false)} style={{ width: "auto", minHeight: 40, padding: "0 14px", background: "var(--pink)", color: "#111" }}>Block</button>
      </div>
      {list?.map((r) => (
        <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap", opacity: r.blocked ? 0.6 : 1 }}>
          <b>{r.name}</b><span style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>{r.email} · {r.contests} contest{r.contests === 1 ? "" : "s"}{r.blocked ? " · blocked" : ""}</span>
          <button className="btn btn-quiet" onClick={() => set(r.email, r.name, r.blocked)} style={{ width: "auto", minHeight: 32, padding: "0 10px", marginLeft: "auto", fontSize: 12 }}>{r.blocked ? "Unblock" : "Block"}</button>
        </div>
      ))}
    </section>
  );
}


function ContestsTab({ act, onReload }: { act: Act; onReload?: () => void }) {
  const network = useNetwork();
  const contests = useAllContests(), fixtures = useFixtures();
  const [contestMsg, setContestMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Disputes act={act} />
        <Sponsors act={act} />
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Contests</h2>
        {contestMsg && (
          <div role="status" style={{ padding: "8px 12px", borderRadius: 10, background: contestMsg.bad ? "#ffefef" : "#f0fadc", border: `1px solid ${contestMsg.bad ? "#ffb3b3" : "#c4e680" }`, color: contestMsg.bad ? "#9a2d1d" : "#2d5200", fontSize: 13, fontWeight: 700 }}>
            {contestMsg.text}
          </div>
        )}
        {contests.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No contests yet. Create one on the right.</p>}
        {contests.map((c) => (
          <div key={c.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div><div className="display" style={{ fontSize: 18 }}>{c.title}</div><div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{c.sponsor ? `Sponsored by ${c.sponsor} · ` : ""}{c.prize_zec} ZEC pot · {c.fixture_ids.length} fixture{c.fixture_ids.length === 1 ? "" : "s"}</div></div>
              <Chip text={c.status === "open" ? "OPEN" : "CLOSED"} bg={c.status === "open" ? "var(--sky)" : "var(--lime)"} />
            </div>
            <ContestControls c={c} act={act} />
            {c.winners && (c.winners.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Winners & Payouts</div>
                {c.winners.map((w) => (
                  <div key={w.rank} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 8, flexWrap: "wrap", borderBottom: "1px dashed #d8cfb8", paddingBottom: 6 }}>
                    <div>
                      <span><b>#{w.rank} {w.name}</b> · {w.points} pts</span>
                      {w.address ? <div style={{ fontSize: 11, color: "var(--muted)" }} className="mono">{short(w.address)}</div> : null}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <b style={{ color: "var(--lime)" }}>{w.zec} ZEC</b>
                      {w.status === "paid" ? (
                        <span className="chip" style={{ background: "var(--lime)", fontSize: 11, padding: "2px 8px" }}>PAID ✓ {w.txid ? short(w.txid) : ""}</span>
                      ) : c.owner_id ? (
                        <span className="chip" style={{ background: w.status === "disputed" || (c.pay_by && Date.parse(c.pay_by) < Date.now()) ? "var(--red)" : "var(--amber)", fontSize: 11, padding: "2px 8px" }}>
                          SPONSOR PAYS · {w.status === "sent" ? "SENT, AWAITING WINNER" : w.status === "disputed" ? "WINNER SAYS NOT RECEIVED" : w.status === "unclaimed" ? "UNCLAIMED" : c.pay_by && Date.parse(c.pay_by) < Date.now() ? "OVERDUE" : "PENDING"}
                        </span>
                      ) : (
                        <>
                          <span className="chip" style={{ background: "var(--amber)", fontSize: 11, padding: "2px 8px" }}>{w.status === "sending" ? "SENDING · CHECK WALLET" : "PENDING"}</span>
                          {w.status === "sending" && (
                            <button style={{ ...btn("#fff"), minHeight: 28, padding: "0 8px", fontSize: 11 }} title="Only if your wallet shows this payment never went out"
                              onClick={() => act("payout_release_winner", { p_contest_id: c.id, p_rank: w.rank }, `Rank #${w.rank} is back in the payout queue.`)}>Not sent: retry later</button>
                          )}
                          {w.address && w.status !== "sending" ? (
                            <a
                              href={zip321(w.address, w.zec, `Called It: ${c.title} (#${w.rank})`)}
                              title={`Pay ${w.zec} ZEC to ${w.address}`}
                              style={{ ...btn("var(--lime)"), minHeight: 28, padding: "0 8px", fontSize: 11, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                            >
                              Pay in Wallet ↗
                            </a>
                          ) : null}
                          {w.status !== "sending" && <button
                            style={{ ...btn("#111", "var(--lime)"), minHeight: 28, padding: "0 8px", fontSize: 11 }}
                            onClick={async () => {
                              if (!(await askConfirm({ title: `Pay #${w.rank} ${w.name}?`, body: `Sends ${w.zec} ${network === "mainnet" ? "ZEC" : "TAZ"} on ${network} through the payout tool. It can't be sent twice.`, confirmLabel: "Send payout" }))) return;
                              setContestMsg({ text: `Dispatching cloud payout for #${w.rank}…` });
                              try {
                                const tok = await accessToken();
                                const res = await fetch("/api/admin/payouts", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                                  body: JSON.stringify({ contest_id: c.id, rank: w.rank, network }),
                                });
                                const data = await res.json();
                                setContestMsg({ text: data.message || data.error, bad: !res.ok || data.ok === false });
                                if (onReload) onReload();
                              } catch (e) {
                                setContestMsg({ text: String(e), bad: true });
                              }
                            }}
                          >
                            ⚡ Release #{w.rank}
                          </button>}
                          <button
                            style={{ ...btn("#fff"), minHeight: 28, padding: "0 8px", fontSize: 11 }}
                            onClick={async () => {
                              const tx = await askText({ title: `Mark #${w.rank} ${w.name} as paid`, body: "Only do this after you've sent the prize from your wallet. Paste the transaction ID if you have it.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark paid" });
                              if (tx === null) return;
                              act("admin_mark_contest_winner_paid", { p_contest_id: c.id, p_rank: w.rank, p_txid: tx }, `Rank #${w.rank} marked paid.`);
                            }}
                          >
                            Mark paid
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : <span style={{ fontSize: 13, color: "#4a4436" }}>Closed with no ranked players.</span>)}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a href={`/contest/${c.id}`} style={{ ...btn("var(--paper)"), display: "inline-flex", alignItems: "center" }}>View page</a>
              {c.status === "open" && (c.fixture_ids.every((id) => fixtures.some((f) => f.id === id && f.homeGoals != null))
                ? <button style={btn("var(--amber)")} onClick={async () => { if (await askConfirm({ title: `Close "${c.title}"?`, body: c.owner_id ? "All its matches are finished. Closing ranks the players; the sponsor then has 72 hours to pay them directly." : "All its matches are finished. Closing ranks the players and credits the prizes to the winners' balances.", confirmLabel: "Close and award" })) act("admin_close_contest", { p_id: c.id }, c.owner_id ? "Contest closed. The sponsor has 72 hours to pay the winners." : "Contest closed. Winners can withdraw from the Vault."); }}>Close and award</button>
                : <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436", alignSelf: "center" }}>Closes automatically after its last match</span>)}
              {c.status === "closed" && !(c.winners && c.winners.length) && <button style={btn("#fff")} onClick={async () => { if (await askConfirm({ title: `Reopen "${c.title}"?`, body: "It closed with no winners, so nothing was credited. Reopening lets players join again.", confirmLabel: "Reopen" })) act("admin_reopen_contest", { p_id: c.id }, `${c.title} is open again.`); }}>Reopen</button>}
              {c.status === "closed" && !c.owner_id && c.winners && c.winners.some((w) => w.zec > 0) && (
                <button
                  style={btn("#111", "var(--lime)")}
                  onClick={async () => {
                    if (!(await askConfirm({ title: `Pay all winners of "${c.title}"?`, body: `Sends each unpaid winner's prize on ${network} through the payout tool. Paid winners are skipped, and nobody is paid twice.`, confirmLabel: "Send payouts" }))) return;
                    setContestMsg({ text: "Triggering cloud payout runner…" });
                    try {
                      const tok = await accessToken();
                      const res = await fetch("/api/admin/payouts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                        body: JSON.stringify({ contest_id: c.id, network }),
                      });
                      const data = await res.json();
                      setContestMsg({ text: data.message || data.error, bad: !res.ok || data.ok === false });
                      if (onReload) onReload();
                    } catch (e) {
                      setContestMsg({ text: String(e), bad: true });
                    }
                  }}
                >
                  ⚡ Release contest payouts
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="paper" style={{ ...card, boxShadow: "6px 6px 0 var(--lime)" }}>
        <span className="eyebrow" style={{ color: "#5b6b12" }}>New contest</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#4a4436", lineHeight: 1.5 }}>Create contests from your Sponsor dashboard, with the same form every sponsor uses: football or a game, prize and dates. You pay the winners from your own wallet with one tap, exactly like sponsors do, so there is no payout tool to run.</span>
        <a href="/sponsor" style={{ ...btn("#111", "var(--lime)"), display: "inline-flex", alignItems: "center", alignSelf: "flex-start" }}>Open Sponsor dashboard</a>
      </section>
    </div>
  );
}

// ─── Admin platform wallet ────────────────────────────────────────────────────
// Lives entirely in the browser (same zcash.js as the player vault).
// The admin opens/creates/restores a platform wallet once; it persists in OPFS keyed to
// the network. No CLI, no GitHub Actions needed.

function AdminWalletCard({ network, act, onPayAll }: {
  network: string;
  act: Act;
  onPayAll: (wallet: WalletClient, phrase: string) => Promise<void>;
}) {
  const walletRef = useRef<WalletClient | null>(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreWords, setRestoreWords] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [logs, setLogs] = useState<{ text: string; bad?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const net = network as "mainnet" | "testnet";
  const coin = net === "mainnet" ? "ZEC" : "TAZ";

  const say = (text: string, bad = false) => setLogs((l) => [...l.slice(-40), { text, bad }]);

  const open = async () => {
    setBusy(true);
    try {
      const w = await openWallet(net);
      walletRef.current = w;
      const [acct] = await w.accounts.list();
      if (acct) {
        const addr = await addressOf(w, acct.id);
        setAddress(addr);
        const bal = await balanceOf(w, acct.id);
        if (bal) setBalance(`${zecOf(bal.spendable)} ${coin} spendable · ${zecOf(bal.total)} total`);
        say(`✓ Wallet opened (${addr.slice(0, 18)}…)`);
      } else {
        say("No account yet — create a new platform wallet or restore from 24 words.");
      }
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const setup = async () => {
    const p1 = await askText({ title: "Set wallet passphrase", body: "Encrypts your platform wallet backup to your account (min 8 chars).", placeholder: "Passphrase", confirmLabel: "Continue", type: "password" });
    if (!p1 || p1.length < 8) { if (p1 !== null) say("Passphrase must be at least 8 characters.", true); return; }
    setBusy(true);
    try {
      const p = savedPhrase(net) ?? newPhrase();
      const w = walletRef.current ?? await openWallet(net);
      walletRef.current = w;
      const acct = await createAccount(w, net, p, false);
      const addr = await addressOf(w, acct.id);
      const enc = await encryptPhrase(p, p1);
      await saveWalletBackup(net, enc.ciphertext, enc.iv, enc.salt, enc.kdf);
      await verifyWalletBackup(net);
      setAddress(addr);
      setPhrase(p);
      say(`✓ Platform wallet created & backed up. Fund address: ${addr.slice(0, 20)}…`);
      say("⚠ Write down your 24 recovery words below!");
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const restore = async () => {
    const clean = restoreWords.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isPhrase(clean)) { say("Enter a valid 24-word Zcash recovery phrase.", true); return; }
    if (pass1.length < 8 || pass1 !== pass2) { say("Passphrases must match and be at least 8 characters.", true); return; }
    setBusy(true);
    try {
      const w = walletRef.current ?? await openWallet(net);
      walletRef.current = w;
      const acct = await createAccount(w, net, clean, false);
      const addr = await addressOf(w, acct.id);
      const enc = await encryptPhrase(clean, pass1);
      await saveWalletBackup(net, enc.ciphertext, enc.iv, enc.salt, enc.kdf);
      await verifyWalletBackup(net);
      setAddress(addr);
      setPhrase(clean);
      setShowRestore(false);
      setRestoreWords(""); setPass1(""); setPass2("");
      say(`✓ Wallet restored & backed up (${addr.slice(0, 18)}…)`);
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const sync = async () => {
    if (!walletRef.current) { say("Open wallet first.", true); return; }
    setBusy(true); say("Syncing to chain tip…");
    try {
      await syncWallet(walletRef.current, (s) => {
        const st = s as { retrying?: number };
        if (st?.retrying) say(`Retrying sync (#${st.retrying})…`);
      });
      const [acct] = await walletRef.current.accounts.list();
      if (!acct) { say("No account yet.", true); setBusy(false); return; }
      const bal = await balanceOf(walletRef.current, acct.id);
      const display = bal ? `${zecOf(bal.spendable)} ${coin} spendable · ${zecOf(bal.total)} total` : `0 ${coin}`;
      setBalance(display);
      setSynced(true);
      say(`✓ Synced: ${display}`);
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const payAll = async () => {
    if (!walletRef.current) { say("Open and sync wallet first.", true); return; }
    if (!synced) { say("Sync the wallet first to check balance.", true); return; }
    const p = phrase ?? await unlockWalletPhrase(net, "pay out prize winners");
    if (!p) return;
    setBusy(true);
    try { await onPayAll(walletRef.current, p); } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  return (
    <div className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, boxShadow: "4px 4px 0 var(--lime)" }}>
      <span className="eyebrow" style={{ color: "#5b6b12" }}>Platform Prize Wallet · {net === "mainnet" ? "Mainnet" : "Testnet"}</span>
      {address ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="display" style={{ fontSize: 24 }}>{balance || "Open — tap Sync to check balance"}</span>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>Fund address (send {coin} here to top up prizes)</div>
          <div className="mono" style={{ fontSize: 11, background: "#f7f3ea", border: "2px solid #111", borderRadius: 10, padding: "6px 10px", overflowWrap: "anywhere" }}>{address}</div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
          No wallet open yet. Open or set up a platform wallet to pay winners directly from this browser — no CLI needed.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn("#fff")} disabled={busy} onClick={open}>Open wallet</button>
        {!address && <button style={btn("var(--lime)")} disabled={busy} onClick={setup}>New platform wallet</button>}
        {!address && <button style={btn("#fff")} disabled={busy} onClick={() => setShowRestore((v) => !v)}>{showRestore ? "Cancel restore" : "Restore 24 words"}</button>}
        {address && <button style={btn("var(--lime)")} disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync & check balance"}</button>}
        {address && <button style={btn("#fff")} disabled={busy} onClick={async () => { await act("admin_set_setting", { p_key: "fund_address", p_value: address }, "Platform fund address updated."); refreshFundAddress(); }}>Set as fund address</button>}
        {address && synced && <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={payAll}>{busy ? "Sending…" : "⚡ Pay all pending"}</button>}
      </div>
      {showRestore && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "#f7f3ea", borderRadius: 14, border: "2px solid #111" }}>
          <textarea rows={2} style={{ ...field, height: "auto", padding: 10, fontSize: 13 }} placeholder="Enter 24 recovery words separated by spaces" value={restoreWords} onChange={(e) => setRestoreWords(e.target.value)} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="password" style={{ ...field, flex: 1, minWidth: 160 }} placeholder="New passphrase (min 8)" value={pass1} onChange={(e) => setPass1(e.target.value)} />
            <input type="password" style={{ ...field, flex: 1, minWidth: 160 }} placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </div>
          <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={restore}>Restore & save backup</button>
        </div>
      )}
      {phrase && (
        <details style={{ fontSize: 12 }}>
          <summary style={{ fontWeight: 800, cursor: "pointer" }}>⚠ Show 24 recovery words (write these down!)</summary>
          <div className="mono" style={{ marginTop: 6, padding: "8px 10px", background: "#fff3cd", border: "2px solid #856404", borderRadius: 10, overflowWrap: "anywhere" }}>{phrase}</div>
        </details>
      )}
      {logs.length > 0 && (
        <pre style={{ background: "#000", color: "#cfe", padding: 10, borderRadius: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", margin: 0 }}>
          {logs.map((l, i) => <span key={i} style={{ color: l.bad ? "#f99" : "#cfe" }}>{l.text}{"\n"}</span>)}
        </pre>
      )}
    </div>
  );
}

function PayoutsTab({ ov, act, onReload }: { ov: Overview | null; act: Act; onReload?: () => void }) {
  const network = useNetwork();
  const [payMsg, setPayMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const net = network as "mainnet" | "testnet";
  const coin = net === "mainnet" ? "ZEC" : "TAZ";
  const walletRef = useRef<{ wallet: WalletClient; phrase: string } | null>(null);

  const getWalletAndPhrase = async () => {
    if (walletRef.current) return walletRef.current;
    try {
      const w = await openWallet(net);
      const p = await unlockWalletPhrase(net, "send this prize payment");
      if (!p) return null;
      walletRef.current = { wallet: w, phrase: p };
      return walletRef.current;
    } catch (e) { setPayMsg({ text: String(e), bad: true }); return null; }
  };

  const handlePayAll = async (wallet: WalletClient, phrase: string) => {
    const pending = (ov?.withdrawals ?? []).filter((w) => w.status === "requested");
    if (pending.length === 0) { setPayMsg({ text: "No pending requests." }); return; }
    setPayMsg({ text: `Paying ${pending.length} request(s)…` });
    let paid = 0, failed = 0;
    for (const w of pending) {
      try {
        const claimed = await cloudRpc<boolean>("payout_claim_withdrawal", { p_id: w.id });
        if (!claimed) { setPayMsg({ text: `Skipped ${w.name} — already claimed.` }); continue; }
        setPayMsg({ text: `Sending ${w.amount} ${coin} to ${w.name}…` });
        const [acct] = await wallet.accounts.list();
        if (!acct) throw new Error("No wallet account");
        const txid = await sendZec(wallet, acct.id, phrase, w.address, zatsOf(Number(w.amount)), `Called It prize: ${w.name}`, (s) => setPayMsg({ text: s }));
        await cloudRpc<boolean>("payout_finish_withdrawal", { p_id: w.id, p_txid: txid ?? "" });
        paid++;
        setPayMsg({ text: `✓ Paid ${w.name} · txid: ${txid?.slice(0, 20) ?? "—"}…` });
      } catch (e) {
        failed++;
        await cloudRpc<boolean>("payout_release_withdrawal", { p_id: w.id }).catch(() => null);
        setPayMsg({ text: `✗ Failed for ${w.name}: ${String(e)}`, bad: true });
      }
    }
    setPayMsg({ text: `Done: ${paid} paid, ${failed} failed.`, bad: failed > 0 });
    if (onReload) onReload();
  };

  const handlePayOne = async (w: Overview["withdrawals"][0]) => {
    const wp = await getWalletAndPhrase();
    if (!wp) return;
    setPayMsg({ text: `Claiming payout for ${w.name}…` });
    const claimed = await cloudRpc<boolean>("payout_claim_withdrawal", { p_id: w.id });
    if (!claimed) { setPayMsg({ text: "Already claimed by another process.", bad: true }); return; }
    try {
      setPayMsg({ text: `Sending ${w.amount} ${coin} to ${w.name}…` });
      const [acct] = await wp.wallet.accounts.list();
      if (!acct) throw new Error("No wallet account");
      const txid = await sendZec(wp.wallet, acct.id, wp.phrase, w.address, zatsOf(Number(w.amount)), `Called It prize: ${w.name}`, (s) => setPayMsg({ text: s }));
      await cloudRpc<boolean>("payout_finish_withdrawal", { p_id: w.id, p_txid: txid ?? "" });
      setPayMsg({ text: `✓ Paid! txid: ${txid?.slice(0, 20) ?? "—"}…` });
      if (onReload) onReload();
    } catch (e) {
      await cloudRpc<boolean>("payout_release_withdrawal", { p_id: w.id }).catch(() => null);
      setPayMsg({ text: `✗ Failed: ${String(e)}`, bad: true });
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Payouts</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Pay prize winners directly from your browser wallet — no CLI or GitHub Actions needed.
          </p>
        </div>

        <div style={{ display: "flex", borderRadius: 12, border: "2px solid #111", overflow: "hidden", background: "#fff" }}>
          <button
            onClick={async () => { if (network !== "mainnet" && await askConfirm({ title: "Switch to mainnet?", body: "Prizes become real ZEC: winners need mainnet addresses and sponsors pay from mainnet wallets.", confirmLabel: "Switch to mainnet", danger: true })) { await act("admin_set_setting", { p_key: "network", p_value: "mainnet" }, "The app now runs on mainnet."); refreshFundAddress(); } }}
            style={{
              padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800,
              background: network === "mainnet" ? "var(--lime)" : "#fff",
              color: "#111", cursor: "pointer",
            }}
          >
            Mainnet (ZEC)
          </button>
          <button
            onClick={async () => { if (network !== "testnet" && await askConfirm({ title: "Switch to testnet?", body: "For a practice run with test coins (TAZ). Players see a test-mode banner and only testnet addresses are accepted.", confirmLabel: "Switch to testnet" })) { await act("admin_set_setting", { p_key: "network", p_value: "testnet" }, "The app now runs on testnet (test mode)."); refreshFundAddress(); } }}
            style={{
              padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800,
              background: network === "testnet" ? "var(--amber)" : "#fff",
              color: "#111", cursor: "pointer",
            }}
          >
            Testnet (TAZ)
          </button>
        </div>
      </div>

      <AdminWalletCard network={network} act={act} onPayAll={handlePayAll} />

      {payMsg && (
        <div
          role="status"
          style={{
            padding: "10px 14px", borderRadius: 12,
            background: payMsg.bad ? "#ffefef" : "#f0fadc",
            border: `2px solid ${payMsg.bad ? "#ffb3b3" : "#c4e680"}`,
            color: payMsg.bad ? "#9a2d1d" : "#2d5200",
            fontSize: 13, fontWeight: 700,
          }}
        >
          {payMsg.text}
        </div>
      )}

      <PointSettingsCard act={act} />

      <h3 className="display" style={{ margin: 0, fontSize: 18 }}>Pending requests ({(ov?.withdrawals ?? []).filter((w) => w.status === "requested").length})</h3>

      {ov && ov.withdrawals.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No requests yet.</p>}
      {ov?.withdrawals.map((w) => (
        <div key={w.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="display" style={{ fontSize: 18 }}>{w.name} · {Number(w.amount).toFixed(4)} {coin}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>to <span className="mono">{short(w.address)}</span> · {time(w.created_at)} · tx <Tx id={w.txid} /></div>
          </div>
          <Chip text={w.status === "sending" ? "SENDING · CHECK WALLET" : w.status.toUpperCase()} bg={w.status === "paid" ? "var(--lime)" : w.status === "rejected" ? "var(--pink)" : "var(--amber)"} />
          {w.status === "sending" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436", flexBasis: "100%" }}>A payout run claimed this. Check your wallet history before acting: it will never be sent again automatically.</span>
              <button style={btn("#111", "var(--lime)")} onClick={async () => { const tx = await askText({ title: "Mark this payout as paid", body: "Only if your wallet shows it went out. Paste the transaction ID from your wallet.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark paid" }); if (tx !== null) act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>It was paid</button>
              <button style={btn("#fff")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "requested", p_txid: null }, "Back in the payout queue.")}>Not sent: retry later</button>
            </div>
          )}
          {w.status === "requested" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn("#111", "var(--lime)")} onClick={() => handlePayOne(w)}>⚡ Pay from wallet</button>
              <a
                href={zip321(w.address, Number(w.amount), "Called It prize payout")}
                style={{ ...btn("var(--lime)"), display: "inline-flex", alignItems: "center", fontSize: 12, textDecoration: "none" }}
              >
                Pay in Zashi ↗
              </a>
              <button style={btn("#111", "var(--lime)")} onClick={async () => { const tx = await askText({ title: `Mark ${w.name}'s withdrawal as paid`, body: "Only after you've sent it from your wallet. Paste the transaction ID if you have it.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark paid" }); if (tx !== null) act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>Mark paid</button>
              <button style={btn("var(--pink)")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "rejected", p_txid: null }, "Rejected.")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function CreditTab({ act }: { act: Act }) {
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<{ id: string; name: string; address: string; avatar: number; ranked_points: number; earned_zec: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zec, setZec] = useState("");
  const [points, setPoints] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const loadPlayers = useCallback(async (q: string) => {
    try {
      const list = await cloudRpc<typeof players>("admin_list_all_players", { p_search: q || null });
      setPlayers(list || []);
    } catch {}
  }, []);

  useEffect(() => { loadPlayers(search); }, [loadPlayers, search]);

  const toggleAll = () => {
    if (selected.size === players.length && players.length > 0) setSelected(new Set());
    else setSelected(new Set(players.map((p) => p.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const credit = async () => {
    if (selected.size === 0) return setMsg({ text: "Select at least one player to credit", bad: true });
    const amountZec = Number(zec) || 0;
    const amountPts = Number(points) || 0;
    if (amountZec <= 0 && amountPts <= 0) return setMsg({ text: "Enter ZEC amount or points to award", bad: true });

    setBusy(true);
    setMsg({ text: `Crediting ${selected.size} player(s)…` });
    try {
      const ok = await act("admin_credit_players_batch", {
        p_user_ids: Array.from(selected),
        p_zec: amountZec,
        p_points: amountPts,
        p_label: label.trim() || "Admin Award",
      }, `Awarded ${selected.size} player(s) successfully!`);
      if (ok) {
        setZec("");
        setPoints("");
        setLabel("");
        setSelected(new Set());
        loadPlayers(search);
      }
    } catch (e) {
      setMsg({ text: String(e), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Credit Players</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Select any player or group of players to directly grant ZEC prize balances or points.
          </p>
        </div>

        <input
          placeholder="Search players by name or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={field}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
            {players.length} player(s) · {selected.size} selected
          </span>
          <button onClick={toggleAll} style={{ background: "none", border: 0, color: "var(--lime)", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            {selected.size === players.length && players.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
          {players.map((p) => {
            const on = selected.has(p.id);
            return (
              <div
                key={p.id}
                onClick={() => toggleOne(p.id)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 14, border: `2px solid ${on ? "var(--lime)" : "var(--line)"}`,
                  background: on ? "var(--panel)" : "#fff", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={on} onChange={() => {}} style={{ width: 18, height: 18, cursor: "pointer" }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.address ? short(p.address) : "no wallet"}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700 }}>
                  <div>{p.ranked_points} pts</div>
                  <div style={{ color: "var(--lime)" }}>{Number(p.earned_zec).toFixed(4)} ZEC</div>
                </div>
              </div>
            );
          })}
          {players.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No players found.</p>}
        </div>
      </section>

      <section className="paper" style={{ ...card, boxShadow: "6px 6px 0 var(--lime)" }}>
        <span className="eyebrow" style={{ color: "#5b6b12" }}>Grant Prize / Credit</span>

        <label style={{ fontSize: 12, fontWeight: 800 }}>Prize in ZEC (withdrawable)
          <input
            placeholder="e.g. 0.50"
            inputMode="decimal"
            value={zec}
            onChange={(e) => setZec(e.target.value.replace(/[^0-9.]/g, ""))}
            style={{ ...field, marginTop: 4 }}
          />
        </label>

        <label style={{ fontSize: 12, fontWeight: 800 }}>Ranked Points (optional)
          <input
            placeholder="e.g. 100"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ ...field, marginTop: 4 }}
          />
        </label>

        <label style={{ fontSize: 12, fontWeight: 800 }}>Reason / Award Label
          <input
            placeholder="e.g. Sponsor Bonus Award"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ ...field, marginTop: 4 }}
          />
        </label>

        {msg && (
          <div role="status" style={{ padding: "8px 12px", borderRadius: 10, background: msg.bad ? "#ffefef" : "#f0fadc", border: `1px solid ${msg.bad ? "#ffb3b3" : "#c4e680"}`, color: msg.bad ? "#9a2d1d" : "#2d5200", fontSize: 13, fontWeight: 700 }}>
            {msg.text}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ minHeight: 52, boxShadow: "0 5px 0 #111" }}
          disabled={busy || selected.size === 0}
          onClick={credit}
        >
          {busy ? "Crediting…" : `⚡ Credit ${selected.size} Player(s)`}
        </button>
      </section>
    </div>
  );
}

function TransactionsTab({ txs }: { txs: Txs | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section className="paper" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Timestamp batches</h2>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>{txs?.anchors.length ?? "…"} transactions · click an id to copy</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: "#111" }}>
            <thead><tr style={{ textAlign: "left", fontSize: 12, color: "#4a4436" }}><th style={{ padding: 8 }}>Transaction</th><th style={{ padding: 8 }}>Block</th><th style={{ padding: 8 }}>Seals</th><th style={{ padding: 8 }}>Players</th><th style={{ padding: 8 }}>Batch root</th><th style={{ padding: 8 }}>Last seal</th></tr></thead>
            <tbody>
              {txs?.anchors.map((a) => (
                <tr key={a.txid} style={{ borderTop: "2px dashed #d8cfb8" }}>
                  <td style={{ padding: 8 }}><Tx id={a.txid} /></td><td style={{ padding: 8, fontWeight: 700 }}>{a.height?.toLocaleString() ?? "pending"}</td>
                  <td style={{ padding: 8 }}>{a.seals}</td><td style={{ padding: 8 }}>{a.players}</td>
                  <td style={{ padding: 8 }} className="mono">{short(a.root)}</td><td style={{ padding: 8 }}>{time(a.last_seal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {txs && txs.anchors.length === 0 && <p style={{ margin: 0, fontSize: 14, color: "#4a4436" }}>No anchors synced yet. They appear once signed-in players’ seals are on-chain.</p>}
      </section>
      <section className="paper" style={card}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Prize payouts</h2>
        {txs?.payouts.map((p, i) => (
          <div key={(p.txid ?? "") + i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: "2px dashed #d8cfb8", paddingBottom: 8, fontSize: 14 }}>
            <b>{p.name}</b><span>{Number(p.amount).toFixed(4)} ZEC → <span className="mono">{short(p.address)}</span></span><Tx id={p.txid} /><span style={{ color: "#4a4436" }}>{time(p.created_at)}</span>
          </div>
        ))}
        {txs && txs.payouts.length === 0 && <p style={{ margin: 0, fontSize: 14, color: "#4a4436" }}>No payouts sent yet.</p>}
      </section>
    </div>
  );
}

function PointSettingsCard({ act }: { act: Act }) {
  const network = useNetwork();
  const unit = network === "mainnet" ? "ZEC" : "TAZ";
  const { pointZec, generalGameZec, platformFeeBps } = usePointSettings();
  const [val, setVal] = useState(String(pointZec));
  const [feePct, setFeePct] = useState(String((platformFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")));
  useEffect(() => { setVal(String(pointZec)); }, [pointZec]);
  useEffect(() => { setFeePct(String((platformFeeBps / 100).toFixed(2).replace(/\.?0+$/, ""))); }, [platformFeeBps]);
  const num = Number(val);
  const feeBps = Math.round(Number(feePct) * 100);
  return (
    <section className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow" style={{ color: "#5b6b12" }}>Point rewards &amp; platform fee</span>
          <div style={{ fontSize: 13, color: "#4a4436", fontWeight: 600 }}>Set what 1 ranked point is worth in {unit}, whether general games earn {unit}, and the platform fee % on payouts.</div>
        </div>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "general_game_zec", p_value: generalGameZec ? "false" : "true" }, `General game ZEC rewards turned ${generalGameZec ? "OFF" : "ON"}.`)) refreshFundAddress(); }}
          style={{ ...btn(generalGameZec ? "var(--lime)" : "#fff"), minHeight: 38, fontSize: 12 }}>
          General games in {unit}: {generalGameZec ? "ON" : "OFF"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span>{unit} per point</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="0.00001" className="mono" style={{ ...field, width: 140, height: 38 }} />
        </label>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "point_zec", p_value: val }, `Updated: 1 point = ${val} ${unit}.`)) refreshFundAddress(); }} style={{ ...btn("#111", "var(--lime)"), minHeight: 38, fontSize: 13 }}>Save rate</button>
        <span style={{ fontSize: 12, color: "#4a4436", fontWeight: 700 }}>{Number.isFinite(num) && num >= 0 ? `50 pts = ${(50 * num).toFixed(5)} ${unit}` : "Enter a valid number (0 to 0.01)"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 6, borderTop: "2px dashed #d8cfb8" }}>
        <label style={{ fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Platform payout fee (%)</span>
          <input value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="0" className="mono" style={{ ...field, width: 90, height: 38 }} />
        </label>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "platform_fee_bps", p_value: String(Number.isFinite(feeBps) ? feeBps : 0) }, `Updated platform payout fee to ${feePct || 0}%.`)) refreshFundAddress(); }} style={{ ...btn("#111", "var(--lime)"), minHeight: 38, fontSize: 13 }}>Save fee</button>
        <span style={{ fontSize: 12, color: "#4a4436", fontWeight: 700 }}>{Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= 2500 ? `Retained by platform on withdrawal (${feeBps} bps)` : "Enter 0% to 25%"}</span>
      </div>
    </section>
  );
}

// On phones the admin tabs take the place of the app's bottom bar (same look; hidden on desktop,
// where the tabs sit under the title).
const ICON: Record<Tab, string> = {
  Overview: "M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-4H4z",
  Fixtures: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7l4 3-1.5 4.5h-5L8 10z",
  Contests: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  Payouts: "M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM12 9.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  Credit: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  Transactions: "M4 7h13l-3-3M20 17H7l3 3",
};
const LABEL: Record<Tab, string> = { Overview: "Overview", Fixtures: "Fixtures", Contests: "Contests", Payouts: "Payouts", Credit: "Credit", Transactions: "Txs" };
function AdminTabBar({ tab, setTab, pending }: { tab: Tab; setTab: (t: Tab) => void; pending: number }) {
  return (
    <>
      <div className="navspace" />
      <nav aria-label="Main" className="tabbar" style={{ height: 70, background: "var(--paper)", borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "space-around", color: "#111" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); window.scrollTo({ top: 0 }); }} aria-current={tab === t ? "page" : undefined} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 800, minWidth: 54, minHeight: 50, justifyContent: "center", border: 0, borderRadius: 14, background: tab === t ? "var(--lime)" : "transparent", color: tab === t ? "#111" : "#6b6455" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[t]} /></svg>
            {LABEL[t]}
            {t === "Payouts" && pending > 0 && <span style={{ position: "absolute", top: 2, right: 6, minWidth: 18, height: 18, borderRadius: 9, background: "var(--red)", color: "#111", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{pending}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}
