"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BottomNav, Img } from "@/components/ui";
import { accessToken, cloudReady, cloudRpc, refreshContests, refreshFixtures, signInWithGoogle, useCloud, useContests, useFixtures } from "@/lib/cloud";
import { short } from "@/lib/store";

type Overview = { players: number; seals: number; ranked_points: number; requested_zec: number; withdrawals: { id: string; address: string; amount: number; status: string; txid: string | null; created_at: string; name: string }[] };
type Txs = { anchors: { txid: string; height: number | null; root: string; seals: number; players: number; last_seal: string }[]; payouts: { txid: string | null; amount: number; address: string; created_at: string; name: string }[] };
type Act = (name: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;
const TABS = ["Overview", "Fixtures", "Contests", "Payouts", "Transactions"] as const;
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
            {tab === "Contests" && <ContestsTab act={act} />}
            {tab === "Payouts" && <PayoutsTab ov={ov} act={act} />}
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

function ContestsTab({ act }: { act: Act }) {
  const contests = useContests(), fixtures = useFixtures();
  const [title, setTitle] = useState(""), [sponsor, setSponsor] = useState(""), [prize, setPrize] = useState(""), [pick, setPick] = useState<string[]>([]);
  const [logo, setLogo] = useState(""), [color, setColor] = useState(""), [surl, setSurl] = useState("");
  const [structure, setStructure] = useState("top3"), [deadline, setDeadline] = useState(""), [desc, setDesc] = useState("");
  async function create() {
    if (!title.trim() || !pick.length) return;
    if (await act("admin_upsert_contest", {
      p_id: slug(title), p_title: title, p_sponsor: sponsor, p_prize: Number(prize) || 0, p_fixtures: pick,
      p_sponsor_logo: logo || null, p_sponsor_color: color || null, p_sponsor_url: surl || null,
      p_prize_structure: structure, p_entry_deadline: deadline ? new Date(deadline).toISOString() : null, p_description: desc || null,
    }, "Contest created. It shows on Home and /contests."))
      { setTitle(""); setSponsor(""); setPrize(""); setPick([]); setLogo(""); setColor(""); setSurl(""); setStructure("top3"); setDeadline(""); setDesc(""); }
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Contests</h2>
        {contests.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No contests yet. Create one on the right.</p>}
        {contests.map((c) => (
          <div key={c.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div><div className="display" style={{ fontSize: 18 }}>{c.title}</div><div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{c.sponsor ? `Sponsored by ${c.sponsor} · ` : ""}{c.prize_zec} ZEC pot · {c.fixture_ids.length} fixture{c.fixture_ids.length === 1 ? "" : "s"}</div></div>
              <Chip text={c.status === "open" ? "OPEN" : "CLOSED"} bg={c.status === "open" ? "var(--sky)" : "var(--lime)"} />
            </div>
            {c.winners && (c.winners.length ? c.winners.map((w) => <div key={w.rank} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>#{w.rank} {w.name}</span><b>{w.points} pts · {w.zec} ZEC</b></div>) : <span style={{ fontSize: 13, color: "#4a4436" }}>Closed with no ranked players.</span>)}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a href={`/contest?c=${c.id}`} style={{ ...btn("var(--paper)"), display: "inline-flex", alignItems: "center" }}>View page</a>
              {c.status === "open" && <button style={btn("var(--amber)")} onClick={() => { if (confirm(`Close "${c.title}" and award the prize?`)) act("admin_close_contest", { p_id: c.id }, "Contest closed. Winners can withdraw from the Vault."); }}>Close and award</button>}
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
            <option value="top10">Top 10 (tiered)</option>
            <option value="all_correct">Split among all exact scores</option>
            <option value="random_draw">Random draw (one winner)</option>
          </select>
        </label>
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

function PayoutsTab({ ov, act }: { ov: Overview | null; act: Act }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 900 }}>
      <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Payout requests</h2>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Run <span className="mono">npm run payouts</span> in services/anchor to pay every request from the anchor wallet (it marks them paid with the transaction id), or mark one by hand.</p>
      {ov && ov.withdrawals.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No requests yet.</p>}
      {ov?.withdrawals.map((w) => (
        <div key={w.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="display" style={{ fontSize: 18 }}>{w.name} · {Number(w.amount).toFixed(4)} ZEC</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>to <span className="mono">{short(w.address)}</span> · {time(w.created_at)} · tx <Tx id={w.txid} /></div>
          </div>
          <Chip text={w.status.toUpperCase()} bg={w.status === "paid" ? "var(--lime)" : w.status === "rejected" ? "var(--pink)" : "var(--amber)"} />
          {w.status === "requested" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btn("#111", "var(--lime)")} onClick={() => { const tx = prompt("Transaction id of the payout (optional)") ?? ""; act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>Mark paid</button>
              <button style={btn("var(--pink)")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "rejected", p_txid: null }, "Rejected.")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function TransactionsTab({ txs }: { txs: Txs | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section className="paper" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Anchors on Zcash testnet</h2>
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
  Transactions: "M4 7h13l-3-3M20 17H7l3 3",
};
const LABEL: Record<Tab, string> = { Overview: "Overview", Fixtures: "Fixtures", Contests: "Contests", Payouts: "Payouts", Transactions: "Txs" };
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
