"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BottomNav, Img } from "@/components/ui";
import { zip321 } from "@/lib/zip321";
import { isShieldedFor } from "@/lib/zaddr";
import { accessToken, cloudReady, cloudRpc, refreshContests, refreshFixtures, refreshFundAddress, signInWithGoogle, useCloud, useAllContests, useFixtures, useFundAddress, useNetwork, type Contest } from "@/lib/cloud";
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
            {tab === "Overview" && <OverviewTab ov={ov} txs={txs} act={act} go={setTab} />}
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

type WalletHealth = { ok: boolean; address: string; spendable: number | null; height: number; queued: number };

function useWalletHealth() {
  const [health, setHealth] = useState<WalletHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/anchor/health", { headers: { authorization: `Bearer ${await accessToken()}` } });
      if (!r.ok) { setError(r.status === 501 ? "Anchor service not configured" : `Error ${r.status}`); return; }
      setHealth(await r.json());
      setError(null);
    } catch { setError("Could not reach anchor service"); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { health, error, refresh };
}

function OverviewTab({ ov, txs, act, go }: { ov: Overview | null; txs: Txs | null; act: Act; go: (t: Tab) => void }) {
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

      <section style={{ borderRadius: 26, background: "#111", color: "var(--paper)", border: "3px solid var(--line)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>Anchor wallet</span>
          <button onClick={wallet.refresh} style={{ background: "none", border: 0, fontWeight: 800, fontSize: 12, color: "var(--muted)" }}>Refresh</button>
        </div>
        {wallet.error ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{wallet.error}</div>
        ) : !wallet.health ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="display" style={{ fontSize: 36, color: "var(--lime)" }}>{wallet.health.spendable != null ? wallet.health.spendable.toFixed(4) : "—"}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>ZEC spendable</span>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 700, color: "var(--muted)", flexWrap: "wrap" }}>
              <span>Block {wallet.health.height?.toLocaleString()}</span>
              {wallet.health.queued > 0 && <span style={{ color: "var(--amber)" }}>{wallet.health.queued} anchor{wallet.health.queued === 1 ? "" : "s"} queued</span>}
              <button onClick={() => { navigator.clipboard?.writeText(wallet.health!.address); }} className="mono" style={{ background: "rgba(198,244,50,.15)", color: "var(--lime)", border: 0, borderRadius: 8, padding: "2px 8px", fontSize: 11, cursor: "copy" }} title={wallet.health.address}>
                {short(wallet.health.address)}
              </button>
            </div>
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
          <button style={btn("var(--lime)")} onClick={() => demoMatch(act)}>Demo match in 10 min</button>
          <button style={btn("var(--paper)")} onClick={() => go("Contests")}>New contest</button>
        </div>
      </section>

      <section className="paper" style={{ ...card, gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="eyebrow" style={{ color: "#5b6b12" }}>Latest Zcash anchors</span>
          <button onClick={() => go("Transactions")} style={{ background: "none", border: 0, fontWeight: 800, textDecoration: "underline", color: "#111" }}>All transactions</button>
        </div>
        {!txs?.anchors.length && <p style={{ margin: 0, fontSize: 14, color: "#4a4436" }}>No anchors synced yet.</p>}
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

  async function add() {
    if (!home.trim() || !away.trim() || !kick) return;
    const iso = new Date(kick).toISOString();
    if (await act("admin_upsert_fixture", { p_id: slug(`${home}-${away}-${iso.slice(0, 16)}`), p_home: home, p_away: away, p_kickoff: iso }, "Fixture added. It shows on Home until kickoff.")) { setHome(""); setAway(""); setKick(""); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Fixtures</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Sealing closes at kickoff. Enter the final score after the match: everyone who sealed it while signed in is scored automatically.</p>
        {fixtures.map((f) => {
          const s = scores[f.id] ?? [f.homeGoals?.toString() ?? "", f.awayGoals?.toString() ?? ""];
          const state = f.homeGoals != null ? ["FINAL", "var(--lime)"] : now && Date.parse(f.kickoff) <= now ? ["NEEDS RESULT", "var(--amber)"] : ["OPEN FOR SEALS", "var(--sky)"];
          return (
            <div key={f.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div><div className="display" style={{ fontSize: 18 }}>{f.home} vs {f.away}</div><div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>Kickoff {f.when}</div></div>
                <Chip text={state[0]} bg={state[1]} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input aria-label={`${f.home} goals`} inputMode="numeric" value={s[0]} onChange={(e) => setScores({ ...scores, [f.id]: [e.target.value.replace(/\D/g, ""), s[1]] })} className="display" style={{ ...field, width: 64, textAlign: "center", fontSize: 22 }} />
                <span className="display" style={{ fontSize: 22 }}>:</span>
                <input aria-label={`${f.away} goals`} inputMode="numeric" value={s[1]} onChange={(e) => setScores({ ...scores, [f.id]: [s[0], e.target.value.replace(/\D/g, "")] })} className="display" style={{ ...field, width: 64, textAlign: "center", fontSize: 22 }} />
                <button style={btn("#111", "var(--lime)")} disabled={s[0] === "" || s[1] === ""} onClick={() => act("admin_set_result", { p_id: f.id, p_home: Number(s[0]), p_away: Number(s[1]) }, `Result saved: ${f.home} ${s[0]}–${s[1]} ${f.away}.`)}>Save result</button>
                {f.homeGoals != null && <button style={btn("transparent")} onClick={() => act("admin_set_result", { p_id: f.id, p_home: null, p_away: null }, "Result cleared.")}>Clear</button>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="paper" style={{ ...card, boxShadow: "6px 6px 0 var(--lime)" }}>
        <span className="eyebrow" style={{ color: "#5b6b12" }}>Add a fixture</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input aria-label="Home team" placeholder="Home team" value={home} onChange={(e) => setHome(e.target.value)} style={field} />
          <input aria-label="Away team" placeholder="Away team" value={away} onChange={(e) => setAway(e.target.value)} style={field} />
        </div>
        <label style={{ fontSize: 12, fontWeight: 800 }}>Kickoff (your local time)<input type="datetime-local" value={kick} onChange={(e) => setKick(e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ flex: 1, minHeight: 52, fontSize: 16, boxShadow: "0 5px 0 #111" }} onClick={add}>Add fixture</button>
          <button style={{ ...btn("var(--amber)"), minHeight: 52 }} onClick={() => demoMatch(act)}>Demo match in 10 min</button>
        </div>
      </section>
      <ImportCard />
    </div>
  );
}

const LEAGUES: [string, string][] = [["PL", "Premier League"], ["CL", "Champions League"], ["PD", "La Liga"], ["SA", "Serie A"], ["BL1", "Bundesliga"], ["FL1", "Ligue 1"], ["DED", "Eredivisie"], ["PPL", "Primeira Liga"], ["ELC", "Championship"], ["BSA", "Brasileirão"], ["EC", "Euros"], ["WC", "World Cup"]];
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
        if (kind === "upcoming" && !have.has(m.id)) { await cloudRpc("admin_upsert_fixture", { p_id: m.id, p_home: m.home, p_away: m.away, p_kickoff: m.kickoff }); n++; }
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
      <select aria-label="Competition" value={league} onChange={(e) => setLeague(e.target.value)} style={field}>
        {LEAGUES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn("var(--lime)")} disabled={busy} onClick={() => pull("upcoming")}>Import next 10 days</button>
        <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={() => pull("results")}>Fetch results</button>
      </div>
      {note && <span role="status" style={{ fontSize: 13, fontWeight: 800 }}>{note}</span>}
    </section>
  );
}

function ContestControls({ c, act }: { c: Contest; act: Act }) {
  const [funded, setFunded] = useState<string | null>(null);
  const v = funded ?? String(c.funded_zec ?? 0);
  const opensLater = c.opens_at && Date.parse(c.opens_at) > Date.now();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontWeight: 700, color: "#4a4436" }}>
        {c.owner_id && <span>Run by the sponsor</span>}
        {opensLater && <span>· opens {time(c.opens_at!)}</span>}
        {c.paused && <span>· joining paused</span>}
        {c.hidden && <span style={{ color: "#9a2d1d" }}>· hidden from the public</span>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor={`funded-${c.id}`} style={{ fontWeight: 800 }}>ZEC received for prizes</label>
        <input id={`funded-${c.id}`} value={v} onChange={(e) => setFunded(e.target.value)} inputMode="decimal" style={{ width: 90, height: 32, borderRadius: 8, border: "2px solid #111", padding: "0 6px" }} />
        <button style={{ ...btn("#111", "var(--lime)"), minHeight: 32, padding: "0 10px", fontSize: 12 }} disabled={funded === null}
          onClick={async () => { if (await act("admin_set_funded", { p_id: c.id, p_amount: Number(v) }, `Recorded ${v} ZEC for ${c.title}.`)) setFunded(null); }}>Save</button>
        <span style={{ color: "#4a4436" }}>of {c.prize_zec} ZEC · memo fund:{c.id}</span>
        <button style={{ ...btn(c.hidden ? "var(--lime)" : "#fff"), minHeight: 32, padding: "0 10px", fontSize: 12, marginLeft: "auto" }}
          onClick={() => act("admin_hide_contest", { p_id: c.id, p_hidden: !c.hidden }, c.hidden ? `${c.title} is visible again.` : `${c.title} is hidden from the public.`)}>{c.hidden ? "Unhide" : "Hide"}</button>
      </div>
    </div>
  );
}

type SponsorRow = { email: string; name: string; contests: number; added_at: string; blocked: boolean };
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
      <span style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>Anyone signed in can start sponsoring from /sponsor; their contests go public without approval. Unfunded contests show &ldquo;Prize not funded yet&rdquo; and never pay out automatically. Block a sponsor to stop them creating or changing contests.</span>
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

function FundWallet() {
  const current = useFundAddress();
  const network = useNetwork();
  const [value, setValue] = useState<string | null>(null), [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null), [busy, setBusy] = useState(false);
  const v = value ?? current ?? "";
  async function save(next: string) {
    if (next.trim() && !isShieldedFor(next, network)) return setMsg({ text: `That isn't a complete ${network} shielded address. Copy it again from your wallet.`, bad: true });
    setBusy(true); setMsg(null);
    try {
      await cloudRpc("admin_set_setting", { p_key: "fund_address", p_value: next });
      await refreshFundAddress(); setValue(null);
      setMsg({ text: next.trim() ? "Saved. Boost the Pot now sends to this wallet." : "Cleared. Boost the Pot is hidden." });
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : "Could not save", bad: true }); }
    setBusy(false);
  }
  return (
    <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      <label htmlFor="fund-address" className="display" style={{ fontSize: 18 }}>Prize fund wallet</label>
      <span style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>Your own shielded address for Boost the Pot donations. Leave it empty to hide Boost the Pot. Add each boost to the contest&apos;s prize pot after it arrives.</span>
      <input id="fund-address" value={v} onChange={(e) => setValue(e.target.value)} placeholder="u1…" spellCheck={false} autoComplete="off" className="mono" style={{ height: 44, borderRadius: 12, border: "2px solid var(--line)", background: "var(--ink)", color: "var(--text)", padding: "0 10px", fontSize: 12 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={busy || v.trim() === (current ?? "")} onClick={() => save(v)} style={{ width: "auto", minHeight: 40, padding: "0 16px", background: "var(--lime)", color: "#111" }}>Save</button>
        {current && <button className="btn btn-quiet" disabled={busy} onClick={() => save("")} style={{ width: "auto", minHeight: 40, padding: "0 16px" }}>Clear</button>}
      </div>
      {msg && <div role={msg.bad ? "alert" : "status"} style={{ fontSize: 13, fontWeight: 700, color: msg.bad ? "var(--red)" : "var(--lime)" }}>{msg.text}</div>}
    </section>
  );
}

function ContestsTab({ act, onReload }: { act: Act; onReload?: () => void }) {
  const network = useNetwork();
  const contests = useAllContests(), fixtures = useFixtures();
  const [contestMsg, setContestMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [title, setTitle] = useState(""), [sponsor, setSponsor] = useState(""), [prize, setPrize] = useState(""), [pick, setPick] = useState<string[]>([]);
  const [logo, setLogo] = useState(""), [color, setColor] = useState(""), [surl, setSurl] = useState("");
  const [structure, setStructure] = useState("top3"), [deadline, setDeadline] = useState(""), [desc, setDesc] = useState("");
  const [customSharesStr, setCustomSharesStr] = useState("50, 30, 20");
  const [equalCount, setEqualCount] = useState("5");
  async function create() {
    if (!title.trim() || !pick.length) return;
    let customShares: number[] | null = null;
    if (structure === "custom") {
      customShares = customSharesStr.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
      if (!customShares.length) {
        setContestMsg({ text: "Enter at least one percentage share (e.g. 50, 30, 20)", bad: true });
        return;
      }
    } else if (structure === "equal_split") {
      customShares = [Number(equalCount) || 5];
    }
    if (await act("admin_upsert_contest", {
      p_id: slug(title), p_title: title, p_sponsor: sponsor, p_prize: Number(prize) || 0, p_fixtures: pick,
      p_sponsor_logo: logo || null, p_sponsor_color: color || null, p_sponsor_url: surl || null,
      p_prize_structure: structure, p_entry_deadline: deadline ? new Date(deadline).toISOString() : null, p_description: desc || null,
      p_custom_shares: customShares,
    }, "Contest created. It shows on Home and /contests."))
      { setTitle(""); setSponsor(""); setPrize(""); setPick([]); setLogo(""); setColor(""); setSurl(""); setStructure("top3"); setDeadline(""); setDesc(""); }
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <FundWallet />
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
                              if (!confirm(`Release payout for #${w.rank} (${w.name}) on ${network}?`)) return;
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
                            onClick={() => {
                              const tx = prompt("Transaction ID of the payout (optional)") ?? "";
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
              <a href={`/contest?c=${c.id}`} style={{ ...btn("var(--paper)"), display: "inline-flex", alignItems: "center" }}>View page</a>
              {c.status === "open" && <button style={btn("var(--amber)")} onClick={() => { if (confirm(`Close "${c.title}" and award the prize?`)) act("admin_close_contest", { p_id: c.id }, "Contest closed. Winners can withdraw from the Vault."); }}>Close and award</button>}
              {c.status === "closed" && c.winners && c.winners.some((w) => w.zec > 0) && (
                <button
                  style={btn("#111", "var(--lime)")}
                  onClick={async () => {
                    if (!confirm(`Run automated cloud payout for "${c.title}"?`)) return;
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
        <input aria-label="Contest title" placeholder="Matchday 12 Pool" value={title} onChange={(e) => setTitle(e.target.value)} style={field} />
        <textarea aria-label="Description (optional)" placeholder="Description shown on the contest page (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...field, height: "auto", padding: "10px 12px", resize: "vertical" }} />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <input aria-label="Sponsor name (optional)" placeholder="Sponsor name" value={sponsor} onChange={(e) => setSponsor(e.target.value)} style={field} />
          <input aria-label="Prize pot in ZEC" placeholder="Prize ZEC" inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value.replace(/[^0-9.]/g, ""))} style={field} />
        </div>
        <details style={{ fontSize: 13, fontWeight: 700 }}>
          <summary style={{ cursor: "pointer", color: "#5b6b12" }}>Sponsor branding (optional)</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
            <input aria-label="Logo URL" placeholder="Logo image URL" value={logo} onChange={(e) => setLogo(e.target.value)} style={field} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input aria-label="Brand color" placeholder="Brand color (hex)" value={color} onChange={(e) => setColor(e.target.value)} style={field} />
              <input aria-label="Sponsor website" placeholder="Sponsor URL" value={surl} onChange={(e) => setSurl(e.target.value)} style={field} />
            </div>
          </div>
        </details>
        <label style={{ fontSize: 12, fontWeight: 800 }}>Prize structure
          <select value={structure} onChange={(e) => setStructure(e.target.value)} style={{ ...field, marginTop: 4 }}>
            <option value="top3">Top 3 (50 / 30 / 20)</option>
            <option value="top5">Top 5 (40 / 25 / 15 / 10 / 10)</option>
            <option value="top10">Top 10 (Tiered)</option>
            <option value="top20">Top 20 (Deep Pool)</option>
            <option value="custom">Custom % shares per rank</option>
            <option value="equal_split">Equal split (Top N winners)</option>
            <option value="all_correct">Split among all exact scores</option>
            <option value="random_draw">Random draw (one winner)</option>
          </select>
        </label>
        {structure === "custom" && (
          <label style={{ fontSize: 12, fontWeight: 800 }}>Custom shares (% per rank, comma-separated)
            <input
              placeholder="e.g. 50, 25, 15, 10 or 60, 25, 15"
              value={customSharesStr}
              onChange={(e) => setCustomSharesStr(e.target.value)}
              style={{ ...field, marginTop: 4 }}
            />
          </label>
        )}
        {structure === "equal_split" && (
          <label style={{ fontSize: 12, fontWeight: 800 }}>Number of equal winners
            <input
              placeholder="e.g. 5 or 10"
              type="number"
              min="1"
              max="50"
              value={equalCount}
              onChange={(e) => setEqualCount(e.target.value)}
              style={{ ...field, marginTop: 4 }}
            />
          </label>
        )}
        <label style={{ fontSize: 12, fontWeight: 800 }}>Entry deadline (optional)
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ ...field, marginTop: 4 }} />
        </label>
        <b style={{ fontSize: 13 }}>Fixtures in this contest</b>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fixtures.map((f) => {
            const on = pick.includes(f.id);
            return (
              <button key={f.id} aria-pressed={on} onClick={() => setPick(on ? pick.filter((x) => x !== f.id) : [...pick, f.id])} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 46, padding: "0 12px", borderRadius: 14, border: "2px solid #111", background: on ? "var(--lime)" : "#fff", color: "#111", fontWeight: 700, fontSize: 14, textAlign: "left" }}>
                <span>{f.home} vs {f.away}</span><span style={{ fontSize: 12, fontWeight: 600 }}>{on ? "✓ in contest" : f.when}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary" style={{ minHeight: 56, boxShadow: "0 5px 0 #111" }} onClick={create}>Create contest</button>
      </section>
    </div>
  );
}

function PayoutsTab({ ov, act, onReload }: { ov: Overview | null; act: Act; onReload?: () => void }) {
  const network = useNetwork();
  const [running, setRunning] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const triggerCloudPayouts = async () => {
    setRunning(true);
    setCloudMsg({ text: `Dispatching automated ${network} payouts…` });
    try {
      const tok = await accessToken();
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ network }),
      });
      const data = await res.json();
      setCloudMsg({ text: data.message || data.error || "Done", bad: !res.ok || data.ok === false });
      if (onReload) onReload();
    } catch (e) {
      setCloudMsg({ text: String(e), bad: true });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Payout requests</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Release prize winnings directly to players’ shielded Zcash addresses.
          </p>
        </div>

        {/* Network & Automated Cloud Trigger */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 12, border: "2px solid #111", overflow: "hidden", background: "#fff" }}>
            <button
              onClick={() => network !== "mainnet" && confirm("Switch the whole app to MAINNET? Prizes and withdrawals become real ZEC, and the prize wallet setting is cleared.") && act("admin_set_setting", { p_key: "network", p_value: "mainnet" }, "The app now runs on mainnet.").then(() => refreshFundAddress())}
              style={{
                padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800,
                background: network === "mainnet" ? "var(--lime)" : "#fff",
                color: "#111", cursor: "pointer",
              }}
            >
              Mainnet (ZEC)
            </button>
            <button
              onClick={() => network !== "testnet" && confirm("Switch the whole app to TESTNET for a practice run? Players see a test-mode banner, only testnet addresses are accepted, and the prize wallet setting is cleared.") && act("admin_set_setting", { p_key: "network", p_value: "testnet" }, "The app now runs on testnet (test mode).").then(() => refreshFundAddress())}
              style={{
                padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800,
                background: network === "testnet" ? "var(--amber)" : "#fff",
                color: "#111", cursor: "pointer",
              }}
            >
              Testnet (TAZ)
            </button>
          </div>

          <button
            style={btn("#111", "var(--lime)")}
            disabled={running}
            onClick={triggerCloudPayouts}
          >
            {running ? "Dispatching…" : "⚡ Run automated payouts"}
          </button>
        </div>
      </div>

      {cloudMsg && (
        <div
          role="status"
          style={{
            padding: "10px 14px", borderRadius: 12,
            background: cloudMsg.bad ? "#ffefef" : "#f0fadc",
            border: `2px solid ${cloudMsg.bad ? "#ffb3b3" : "#c4e680"}`,
            color: cloudMsg.bad ? "#9a2d1d" : "#2d5200",
            fontSize: 13, fontWeight: 700,
          }}
        >
          {cloudMsg.text}
        </div>
      )}

      {ov && ov.withdrawals.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No requests yet.</p>}
      {ov?.withdrawals.map((w) => (
        <div key={w.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="display" style={{ fontSize: 18 }}>{w.name} · {Number(w.amount).toFixed(4)} {network === "mainnet" ? "ZEC" : "TAZ"}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>to <span className="mono">{short(w.address)}</span> · {time(w.created_at)} · tx <Tx id={w.txid} /></div>
          </div>
          <Chip text={w.status === "sending" ? "SENDING · CHECK WALLET" : w.status.toUpperCase()} bg={w.status === "paid" ? "var(--lime)" : w.status === "rejected" ? "var(--pink)" : "var(--amber)"} />
          {w.status === "sending" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436", flexBasis: "100%" }}>A payout run claimed this. Check your wallet history before acting: it will never be sent again automatically.</span>
              <button style={btn("#111", "var(--lime)")} onClick={() => { const tx = prompt("Transaction id from your wallet (optional)") ?? ""; act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>It was paid</button>
              <button style={btn("#fff")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "requested", p_txid: null }, "Back in the payout queue.")}>Not sent: retry later</button>
            </div>
          )}
          {w.status === "requested" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                href={zip321(w.address, Number(w.amount), "Called It prize payout")}
                style={{ ...btn("var(--lime)"), display: "inline-flex", alignItems: "center", fontSize: 12, textDecoration: "none" }}
              >
                Pay in Wallet ↗
              </a>
              <button style={btn("#111", "var(--lime)")} onClick={() => { const tx = prompt("Transaction id of the payout (optional)") ?? ""; act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>Mark paid</button>
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
