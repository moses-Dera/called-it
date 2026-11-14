"use client";
import { useCallback, useEffect, useState } from "react";
import { cloudReady, cloudRpc, refreshContests, refreshFixtures, signInWithGoogle, useCloud, useContests, useFixtures } from "@/lib/cloud";
import { short } from "@/lib/store";

type Overview = { players: number; seals: number; ranked_points: number; requested_zec: number; withdrawals: { id: string; address: string; amount: number; status: string; txid: string | null; created_at: string; name: string }[] };
type Txs = { anchors: { txid: string; height: number | null; root: string; seals: number; players: number; last_seal: string }[]; payouts: { txid: string | null; amount: number; address: string; created_at: string; name: string }[] };

const panel: React.CSSProperties = { background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 };
const input: React.CSSProperties = { height: 42, borderRadius: 12, border: "2px solid var(--line)", background: "#0b0f14", color: "var(--text)", padding: "0 10px", fontSize: 14, minWidth: 0 };
const small: React.CSSProperties = { minHeight: 38, padding: "0 12px", borderRadius: 10, border: "2px solid #111", fontWeight: 800, fontSize: 13 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Tx({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span style={{ color: "var(--muted)" }}>–</span>;
  return (
    <button title={id} onClick={() => { navigator.clipboard?.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="mono" style={{ background: "transparent", border: 0, color: "var(--lime)", padding: 0, fontSize: 12, cursor: "copy" }}>
      {copied ? "copied" : short(id)}
    </button>
  );
}

export default function Admin() {
  const cloud = useCloud();
  const signedIn = !!cloud.session;
  const [status, setStatus] = useState<{ is_admin: boolean; has_admins: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [ov, setOv] = useState<Overview | null>(null);
  const [txs, setTxs] = useState<Txs | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await cloudRpc<{ is_admin: boolean; has_admins: boolean }>("admin_status");
      setStatus(s);
      if (s.is_admin) {
        const [o, t] = await Promise.all([cloudRpc<Overview>("admin_overview"), cloudRpc<Txs>("admin_transactions")]);
        setOv(o); setTxs(t);
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => { if (cloudReady) load(); }, [load, signedIn]);

  async function act(name: string, args: Record<string, unknown>, ok: string) {
    setMsg("Working…");
    try { await cloudRpc(name, args); setMsg(ok); await Promise.all([load(), refreshFixtures(), refreshContests()]); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  let gate: React.ReactNode = null;
  if (!cloudReady) gate = "Accounts are not configured on this deployment.";
  else if (!signedIn) gate = <><span>Sign in with the account that runs Called It.</span><button className="btn btn-paper" onClick={signInWithGoogle}>Sign in with Google</button></>;
  else if (!status) gate = "Checking access…";
  else if (!status.is_admin && !status.has_admins) gate = <><span>No admin yet. The first account to claim it becomes the admin.</span><button className="btn btn-primary" onClick={() => act("claim_first_admin", {}, "You are now the admin.")}>Claim admin</button></>;
  else if (!status.is_admin) gate = "Admins only.";

  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Admin</h1>
        {msg && <span role="status" style={{ fontSize: 13, fontWeight: 700, color: "var(--lime)" }}>{msg}</span>}
      </div>
      {gate ? <section style={{ ...panel, maxWidth: 520 }}><div style={{ fontSize: 14, color: "#c9d3de", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 12 }}>{gate}</div></section> : (
        <div className="admin-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 18, alignItems: "start" }}>
          <Stats ov={ov} />
          <Fixtures act={act} />
          <Contests act={act} />
          <Withdrawals ov={ov} act={act} />
          <Transactions txs={txs} />
        </div>
      )}
    </main>
  );
}

function Stats({ ov }: { ov: Overview | null }) {
  const items: [string, string | number][] = [["Players", ov?.players ?? "…"], ["Seals synced", ov?.seals ?? "…"], ["Ranked points", ov?.ranked_points ?? "…"], ["Payouts requested", ov ? `${Number(ov.requested_zec).toFixed(4)} ZEC` : "…"]];
  return (
    <section style={{ ...panel, background: "var(--amber)", color: "#111", border: "3px solid #111" }}>
      <span className="eyebrow">Overview</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {items.map(([k, v]) => <div key={k} style={{ background: "#111", color: "var(--paper)", borderRadius: 14, padding: "10px 12px" }}><div className="display" style={{ fontSize: 24 }}>{v}</div><div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{k}</div></div>)}
      </div>
    </section>
  );
}

function Fixtures({ act }: { act: (n: string, a: Record<string, unknown>, ok: string) => Promise<void> }) {
  const fixtures = useFixtures();
  const [home, setHome] = useState(""), [away, setAway] = useState(""), [kick, setKick] = useState("");
  const [scores, setScores] = useState<Record<string, [string, string]>>({});
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [fixtures]);

  function add(h = home, a = away, k = kick) {
    if (!h.trim() || !a.trim() || !k) return;
    const iso = new Date(k).toISOString();
    act("admin_upsert_fixture", { p_id: slug(`${h}-${a}-${iso.slice(0, 16)}`), p_home: h, p_away: a, p_kickoff: iso }, "Fixture saved.").then(() => { setHome(""); setAway(""); setKick(""); });
  }
  function demo() {
    const k = new Date(Date.now() + 10 * 60_000);
    act("admin_upsert_fixture", { p_id: slug(`demo-${k.toISOString().slice(0, 16)}`), p_home: "Demo United", p_away: "Test City", p_kickoff: k.toISOString() }, "Demo match added: it kicks off in 10 minutes.");
  }

  return (
    <section style={panel}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Fixtures and results</span>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Sealing closes at kickoff. Enter the final score after the match: every signed-in player who sealed it is scored automatically.</div>
      {fixtures.map((f) => {
        const s = scores[f.id] ?? [f.homeGoals?.toString() ?? "", f.awayGoals?.toString() ?? ""];
        const state = f.homeGoals != null ? "Final" : now && Date.parse(f.kickoff) <= now ? "Awaiting result" : "Open for seals";
        return (
          <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <b style={{ fontSize: 14 }}>{f.home} vs {f.away}</b>
              <span className="chip" style={{ background: state === "Final" ? "var(--lime)" : state === "Open for seals" ? "var(--sky)" : "var(--amber)" }}>{state.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Kickoff {f.when} · <span className="mono">{f.id}</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input aria-label={`${f.home} goals`} inputMode="numeric" value={s[0]} onChange={(e) => setScores({ ...scores, [f.id]: [e.target.value, s[1]] })} style={{ ...input, width: 64 }} />
              <span>–</span>
              <input aria-label={`${f.away} goals`} inputMode="numeric" value={s[1]} onChange={(e) => setScores({ ...scores, [f.id]: [s[0], e.target.value] })} style={{ ...input, width: 64 }} />
              <button style={{ ...small, background: "var(--lime)" }} onClick={() => act("admin_set_result", { p_id: f.id, p_home: Number(s[0]), p_away: Number(s[1]) }, "Result saved. Players are scored as they open the app.")} disabled={s[0] === "" || s[1] === ""}>Save result</button>
              {f.homeGoals != null && <button style={{ ...small, background: "var(--panel)", color: "var(--text)", borderColor: "var(--line)" }} onClick={() => act("admin_set_result", { p_id: f.id, p_home: null, p_away: null }, "Result cleared.")}>Clear</button>}
            </div>
          </div>
        );
      })}
      <div style={{ borderTop: "2px dashed var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 14 }}>Add a fixture</b>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input placeholder="Home team" value={home} onChange={(e) => setHome(e.target.value)} style={input} />
          <input placeholder="Away team" value={away} onChange={(e) => setAway(e.target.value)} style={input} />
        </div>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Kickoff (your local time)
          <input type="datetime-local" value={kick} onChange={(e) => setKick(e.target.value)} style={{ ...input, width: "100%", colorScheme: "dark", marginTop: 4 }} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...small, background: "var(--lime)" }} onClick={() => add()}>Add fixture</button>
          <button style={{ ...small, background: "var(--amber)" }} onClick={demo}>Demo match in 10 min</button>
        </div>
      </div>
    </section>
  );
}

function Contests({ act }: { act: (n: string, a: Record<string, unknown>, ok: string) => Promise<void> }) {
  const contests = useContests(), fixtures = useFixtures();
  const [title, setTitle] = useState(""), [sponsor, setSponsor] = useState(""), [prize, setPrize] = useState("0"), [pick, setPick] = useState<string[]>([]);
  function create() {
    if (!title.trim() || !pick.length) return;
    act("admin_upsert_contest", { p_id: slug(title), p_title: title, p_sponsor: sponsor, p_prize: Number(prize) || 0, p_fixtures: pick }, "Contest created. It shows on Home.")
      .then(() => { setTitle(""); setSponsor(""); setPrize("0"); setPick([]); });
  }
  return (
    <section style={panel}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Contests and sponsors</span>
      {contests.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No contests yet.</div>}
      {contests.map((c) => (
        <div key={c.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b style={{ fontSize: 14 }}>{c.title}</b>
            <span className="chip" style={{ background: c.status === "open" ? "var(--sky)" : "var(--lime)" }}>{c.status.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.sponsor ? `Sponsor: ${c.sponsor} · ` : ""}Prize {c.prize_zec} ZEC · {c.fixture_ids.length} fixture(s)</div>
          {c.winners && c.winners.length > 0 && <div style={{ fontSize: 12, color: "#c9d3de" }}>{c.winners.map((w) => `#${w.rank} ${w.name} (${w.points} pts, ${w.zec} ZEC)`).join(" · ")}</div>}
          {c.winners && c.winners.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Closed with no ranked players.</div>}
          {c.status === "open" && <button style={{ ...small, background: "var(--amber)", alignSelf: "flex-start" }} onClick={() => { if (confirm(`Close "${c.title}" and award the prize to the top 3?`)) act("admin_close_contest", { p_id: c.id }, "Contest closed. Winners can withdraw from the Vault."); }}>Close and award prizes</button>}
        </div>
      ))}
      <div style={{ borderTop: "2px dashed var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 14 }}>New contest</b>
        <input placeholder="Title, e.g. Matchday 12 Pool" value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <input placeholder="Sponsor (optional)" value={sponsor} onChange={(e) => setSponsor(e.target.value)} style={input} />
          <input aria-label="Prize pot in testnet ZEC" inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value)} style={input} />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Prize pot in testnet ZEC, split 50/30/20 between the top three. Fixtures in this contest:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fixtures.map((f) => (
            <label key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, minHeight: 32 }}>
              <input type="checkbox" checked={pick.includes(f.id)} onChange={(e) => setPick(e.target.checked ? [...pick, f.id] : pick.filter((x) => x !== f.id))} />
              {f.home} vs {f.away} <span style={{ color: "var(--muted)" }}>· {f.when}</span>
            </label>
          ))}
        </div>
        <button style={{ ...small, background: "var(--lime)", alignSelf: "flex-start" }} onClick={create}>Create contest</button>
      </div>
    </section>
  );
}

function Withdrawals({ ov, act }: { ov: Overview | null; act: (n: string, a: Record<string, unknown>, ok: string) => Promise<void> }) {
  return (
    <section style={panel}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Payout requests</span>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Pay them all from the anchor wallet with <span className="mono">npm run payouts</span> in services/anchor (it marks them paid), or mark one by hand.</div>
      {ov && ov.withdrawals.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No requests yet.</div>}
      {ov?.withdrawals.map((w) => (
        <div key={w.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <b>{w.name} · {Number(w.amount).toFixed(4)} ZEC</b>
            <span className="chip" style={{ background: w.status === "paid" ? "var(--lime)" : w.status === "rejected" ? "var(--pink)" : "var(--amber)" }}>{w.status.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}><span className="mono">{short(w.address)}</span> · {time(w.created_at)} · tx <Tx id={w.txid} /></div>
          {w.status === "requested" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...small, background: "var(--lime)" }} onClick={() => { const tx = prompt("Transaction id of the payout (optional)") ?? ""; act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>Mark paid</button>
              <button style={{ ...small, background: "var(--pink)" }} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "rejected", p_txid: null }, "Rejected.")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Transactions({ txs }: { txs: Txs | null }) {
  return (
    <section style={{ ...panel, gridColumn: "1 / -1" }}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Transaction record</span>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Every Zcash testnet transaction the app made. Click an id to copy it.</div>
      <b style={{ fontSize: 14 }}>Anchors ({txs?.anchors.length ?? "…"})</b>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th style={{ padding: 6 }}>Transaction</th><th style={{ padding: 6 }}>Block</th><th style={{ padding: 6 }}>Seals</th><th style={{ padding: 6 }}>Players</th><th style={{ padding: 6 }}>Batch root</th><th style={{ padding: 6 }}>Last seal</th></tr></thead>
          <tbody>
            {txs?.anchors.map((a) => (
              <tr key={a.txid} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: 6 }}><Tx id={a.txid} /></td><td style={{ padding: 6 }}>{a.height?.toLocaleString() ?? "–"}</td>
                <td style={{ padding: 6 }}>{a.seals}</td><td style={{ padding: 6 }}>{a.players}</td>
                <td style={{ padding: 6 }} className="mono">{short(a.root)}</td><td style={{ padding: 6 }}>{time(a.last_seal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {txs && txs.anchors.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>No anchors synced yet. Anchors appear here once signed-in players&apos; seals are on-chain.</div>}
      </div>
      <b style={{ fontSize: 14 }}>Payouts ({txs?.payouts.length ?? "…"})</b>
      {txs?.payouts.map((p, i) => (
        <div key={(p.txid ?? "") + i} style={{ fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          {p.name} · {Number(p.amount).toFixed(4)} ZEC → <span className="mono">{short(p.address)}</span> · tx <Tx id={p.txid} /> · {time(p.created_at)}
        </div>
      ))}
      {txs && txs.payouts.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No payouts sent yet.</div>}
    </section>
  );
}
