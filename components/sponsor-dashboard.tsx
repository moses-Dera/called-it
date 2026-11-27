"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { cloudRpc, refreshContests, sponsorMarkSent, sponsorPayees, useFixtures, useNetwork, type ContestGame, type Payee, type SponsorContest, type SponsorDashboard } from "@/lib/cloud";
import { askText } from "./dialog";
import { explorerTx } from "@/lib/explorer";
import { CONTEST_GAMES, contestGame, phaseOf } from "@/lib/data";
import { OTHER_LEAGUE } from "@/lib/leagues";
import { Chips } from "./chips";
import { Img } from "./ui";
import { zip321 } from "@/lib/zip321";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const toLocalInput = (iso: string | null | undefined) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function useClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}
function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
}

function state(c: SponsorContest, now: number) {
  if (c.hidden) return { label: "Hidden by Called It", bg: "var(--red)" };
  if (c.status === "closed") return { label: "Finished", bg: "var(--panel)" };
  if (c.opens_at && Date.parse(c.opens_at) > now) return { label: "Scheduled", bg: "var(--sky)" };
  if (c.paused) return { label: "Paused", bg: "var(--amber)" };
  return { label: "Live", bg: "var(--lime)" };
}

function PayeeRow({ c, p, onSent }: { c: SponsorContest; p: Payee; onSent: () => void }) {
  const network = useNetwork();
  const [qr, setQr] = useState(""), [err, setErr] = useState("");
  const link = p.address ? zip321(p.address, p.zec, `Called It · ${c.title} · #${p.rank} prize`) : "";
  async function sent() {
    const tx = await askText({ title: `Sent ${p.zec} ZEC to ${p.name}?`, body: "Paste the transaction ID from your wallet (in the payment's details). With it, the prize counts as received after 7 days even if the winner forgets to confirm, and anyone can look the payment up on a block explorer.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark as sent" });
    if (tx === null) return;
    setErr("");
    try { await sponsorMarkSent(c.id, p.rank, tx.trim() || null); onSent(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
  }
  const due = p.status === "pending" || p.status === "disputed";
  return (
    <div style={{ background: "var(--paper)", color: "#111", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>#{p.rank} {p.name} · {p.zec} ZEC</b>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{p.status === "paid" ? "✓ Received" : p.status === "unclaimed" ? "Unclaimed (no wallet added in 30 days)" : p.status === "sent" ? (p.txid ? "Sent · counts as received after 7 days unless the winner objects" : "Sent · waiting for the winner to confirm") : p.status === "disputed" ? "⚠ Winner says it hasn't arrived" : "To pay"}</span>
      </div>
      {p.txid && <a href={explorerTx(p.txid, network)} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, overflowWrap: "anywhere", color: "#4a4436", textDecoration: "underline" }}>Transaction {p.txid} ↗</a>}
      {due && !p.address && <span style={{ fontSize: 13, lineHeight: 1.5 }}>Waiting for {p.name} to add a shielded Zcash address in their Vault. The payment link appears here as soon as they do.</span>}
      {due && p.address && (
        <>
          {p.status === "disputed" && <span style={{ fontSize: 13, lineHeight: 1.5 }}>Check your wallet: if the payment failed or went to another address, send it again with the link below.</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={link} className="btn" style={{ background: "#111", color: "var(--lime)", border: 0, width: "auto", padding: "0 16px", minHeight: 40 }}>Pay in wallet</a>
            <button className="btn btn-paper" style={{ width: "auto", padding: "0 14px", minHeight: 40 }} onClick={() => qr ? setQr("") : QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr).catch(() => setErr("Could not draw the QR code."))}>{qr ? "Hide QR" : "Show QR"}</button>
            <button className="btn" style={{ width: "auto", padding: "0 14px", minHeight: 40, background: "var(--lime)", color: "#111", border: "2px solid #111" }} onClick={sent}>I&apos;ve sent it</button>
          </div>
          {qr && <img src={qr} alt={`Payment QR code for ${p.name}`} width={180} height={180} style={{ borderRadius: 10, border: "2px solid #111" }} />}
          <span className="mono" style={{ fontSize: 11, overflowWrap: "anywhere", color: "#4a4436" }}>{p.address}</span>
        </>
      )}
      {err && <span role="alert" style={{ fontSize: 13, fontWeight: 700, color: "#b3261e" }}>{err}</span>}
    </div>
  );
}

function PayPanel({ c, now, onChange }: { c: SponsorContest; now: number; onChange: () => void }) {
  const network = useNetwork();
  const [payees, setPayees] = useState<Payee[] | null>(null), [err, setErr] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    sponsorPayees(c.id).then((r) => live && setPayees(r)).catch((e) => live && setErr(e instanceof Error ? e.message : "Could not load the winners."));
    return () => { live = false; };
  }, [c.id, n, c.winners]);
  if (!c.winners?.some((w) => w.zec > 0)) return null;
  const open = payees?.filter((p) => p.zec > 0 && p.status !== "paid" && p.status !== "unclaimed").length ?? 0;
  const late = c.pay_by && Date.parse(c.pay_by) < now;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="eyebrow" style={{ color: open ? "var(--amber)" : "var(--lime)" }}>{open ? "Pay your winners" : "All winners paid"}</span>
      {open > 0 && c.pay_by && (
        <span style={{ fontSize: 13, fontWeight: 700, color: late ? "var(--red)" : "var(--text)" }}>
          {late ? "The 72-hour payment window has passed. Your contest shows as unpaid, and you can't start a new one until every winner confirms."
            : <>Pay within <span className="mono">{left(Date.parse(c.pay_by) - now)}</span>. Each payment opens your wallet with the address, amount and memo filled in{network === "testnet" ? " (testnet coins)" : ""}.</>}
        </span>
      )}
      {err && <span role="alert" style={{ fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{err}</span>}
      {payees?.filter((p) => p.zec > 0).map((p) => <PayeeRow key={p.rank} c={c} p={p} onSent={() => { setN((x) => x + 1); onChange(); }} />)}
    </div>
  );
}

const SPLITS = [["top3", "Top 3"], ["winner", "Winner takes all"], ["top5", "Top 5"], ["random_draw", "Lucky draw"]] as const;
const MORE_SPLITS = [["top10", "Top 10"], ["top20", "Top 20"], ["equal_split", "Equal split"], ["custom", "Custom %"], ["all_correct", "Exact scores share"]] as const;
const LENGTHS = [[1, "1 hour"], [3, "3 hours"], [24, "1 day"], [72, "3 days"], [168, "1 week"]] as const;

function ContestForm({ edit, limit, onDone }: { edit?: SponsorContest; limit: number; onDone: () => void }) {
  const fixtures = useFixtures();
  const now = useClock();
  const locked = !!edit && edit.entries > 0;
  const isWinner = edit?.prize_structure === "custom" && edit.custom_shares?.length === 1 && Number(edit.custom_shares[0]) === 100;
  const [game, setGame] = useState<ContestGame>(edit?.game ?? "football");
  const [title, setTitle] = useState(edit?.title ?? ""), [desc, setDesc] = useState(edit?.description ?? "");
  const [pick, setPick] = useState<string[]>(edit?.fixture_ids ?? []), [prize, setPrize] = useState(edit ? String(edit.prize_zec) : "");
  const [split, setSplit] = useState<string>(isWinner ? "winner" : edit?.prize_structure ?? "top3");
  const [shares, setShares] = useState(edit?.custom_shares?.join(", ") ?? "50, 30, 20"), [topN, setTopN] = useState(String(edit?.prize_structure === "equal_split" ? edit.custom_shares?.[0] ?? 5 : 5));
  const [hours, setHours] = useState<number>(edit?.ends_at ? Math.max(1, Math.round((Date.parse(edit.ends_at) - Date.parse(edit.opens_at ?? edit.created_at)) / 3_600_000)) : 24);
  const [deadline, setDeadline] = useState(toLocalInput(edit?.entry_deadline));
  const [openMode, setOpenMode] = useState<"now" | "later">(edit?.opens_at && Date.parse(edit.opens_at) > Date.now() ? "later" : "now");
  const [opensAt, setOpensAt] = useState(toLocalInput(edit?.opens_at));
  const [logo, setLogo] = useState(edit?.sponsor_logo ?? ""), [color, setColor] = useState(edit?.sponsor_color ?? "#ffb547"), [url, setUrl] = useState(edit?.sponsor_url ?? "");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);

  // Upcoming matches, grouped by league so long lists stay manageable.
  const ready = now != null;
  const upcoming = useMemo(() => ready ? fixtures.filter((f) => phaseOf(f, Date.now()) === "upcoming").sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)) : [], [fixtures, ready]);
  const leagues = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of upcoming) m.set(f.league || OTHER_LEAGUE, (m.get(f.league || OTHER_LEAGUE) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] === OTHER_LEAGUE ? 1 : 0) - (b[0] === OTHER_LEAGUE ? 1 : 0) || b[1] - a[1]);
  }, [upcoming]);
  const [league, setLeague] = useState<string | null>(null);
  const shown = league ?? leagues[0]?.[0] ?? null;
  const inLeague = upcoming.filter((f) => (f.league || OTHER_LEAGUE) === shown);
  const allPicked = inLeague.length > 0 && inLeague.every((f) => pick.includes(f.id));

  async function save() {
    if (!title.trim()) return setMsg("Give the contest a title.");
    if (game === "football" && !pick.length) return setMsg("Pick at least one match.");
    const zec = Number(prize || 0);
    if (!(zec >= 0)) return setMsg("The prize should be a number of ZEC.");
    let structure = split, custom: number[] | null = null;
    if (split === "winner") { structure = "custom"; custom = [100]; }
    if (split === "custom") { custom = shares.split(",").map((x) => Number(x.trim())).filter((n) => n > 0); if (!custom.length) return setMsg("Enter the percentage for each rank, like 50, 30, 20."); }
    if (split === "equal_split") custom = [Math.max(1, Number(topN) || 5)];
    if (openMode === "later" && !opensAt) return setMsg("Choose when the contest opens.");
    const start = openMode === "later" ? Date.parse(new Date(opensAt).toISOString()) : Date.now();
    setBusy(true); setMsg("");
    try {
      await cloudRpc("sponsor_save_contest", {
        p_id: edit?.id ?? `${slug(title) || "contest"}-${Math.random().toString(36).slice(2, 6)}`, p_title: title,
        p_fixtures: game === "football" ? pick : [], p_prize: zec, p_structure: structure, p_custom_shares: custom,
        p_entry_deadline: deadline ? new Date(deadline).toISOString() : null,
        p_opens_at: openMode === "later" ? new Date(opensAt).toISOString() : null, p_description: desc, p_logo: logo, p_color: color, p_url: url,
        p_game: game, p_ends_at: game === "football" ? null : (locked && edit?.ends_at ? edit.ends_at : new Date(start + hours * 3_600_000).toISOString()),
      });
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }

  const field = { height: 46, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 10px", fontSize: 15, width: "100%", boxSizing: "border-box" } as const;
  const lbl = { fontSize: 12, fontWeight: 800 } as const;
  const step = (n: number, text: string) => <span className="eyebrow" style={{ color: "#5b6b12" }}>{n}. {text}</span>;
  return (
    <section className="paper" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, color: "#111" }}>
      <h2 className="display" style={{ margin: 0, fontSize: 22 }}>{edit ? "Edit contest" : "New contest"}</h2>
      {locked && <div style={{ fontSize: 13, fontWeight: 700, background: "var(--amber)", borderRadius: 10, padding: "8px 10px" }}>Players have joined, so the game, matches, prize and dates are locked. You can still change the title, text and branding.</div>}

      {step(1, "What do players play?")}
      <div role="radiogroup" aria-label="Game" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {CONTEST_GAMES.map((g) => {
          const on = game === g.key;
          return (
            <button key={g.key} type="button" role="radio" aria-checked={on} disabled={locked} onClick={() => setGame(g.key)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, textAlign: "left", padding: 10, borderRadius: 14, border: `${on ? 3 : 2}px solid #111`, background: on ? "var(--lime)" : "#fff", color: "#111", boxShadow: on ? "3px 3px 0 #111" : "none", cursor: locked ? "default" : "pointer", opacity: locked && !on ? 0.5 : 1 }}>
              <Img n={g.img} size={40} style={{ borderRadius: 8 }} />
              <b style={{ fontSize: 14 }}>{g.name}</b>
              <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.35 }}>{g.blurb}</span>
            </button>
          );
        })}
      </div>

      {step(2, "Name it")}
      <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={game === "football" ? "Weekend Derby Pool" : `${contestGame(game).name} Night`} style={field} />

      {game === "football" ? (
        <>
          {step(3, `Pick matches${pick.length ? ` · ${pick.length} picked` : ""}`)}
          {leagues.length === 0 && <div style={{ fontSize: 13 }}>No upcoming matches yet. They are imported automatically every day.</div>}
          {leagues.length > 0 && <Chips label="League" value={shown ?? ""} onChange={(v) => setLeague(v)} options={leagues.map(([l, n]) => [l, `${l} (${n})`] as const)} disabled={locked} light />}
          {inLeague.length > 0 && (
            <div style={{ border: "2px solid #111", borderRadius: 12, background: "#fff", opacity: locked ? 0.6 : 1 }}>
              <button type="button" disabled={locked} onClick={() => setPick((p) => allPicked ? p.filter((x) => !inLeague.some((f) => f.id === x)) : [...new Set([...p, ...inLeague.map((f) => f.id)])])}
                style={{ width: "100%", textAlign: "left", padding: "10px", border: 0, borderBottom: "1px solid #e5dcc6", background: "#f6f1e4", fontWeight: 800, fontSize: 13, color: "#111", borderRadius: "10px 10px 0 0" }}>
                {allPicked ? "Unselect" : "Select"} all {inLeague.length} {shown} match{inLeague.length === 1 ? "" : "es"}
              </button>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {inLeague.map((f) => (
                  <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "1px solid #e5dcc6", fontSize: 14, cursor: locked ? "default" : "pointer" }}>
                    <input type="checkbox" disabled={locked} checked={pick.includes(f.id)} onChange={(e) => setPick((p) => e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id))} style={{ width: 18, height: 18 }} />
                    <span style={{ flex: 1 }}><b>{f.home} vs {f.away}</b> · {f.when}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {step(3, "How long does it run?")}
          <Chips label="Contest length" value={hours} onChange={setHours} options={LENGTHS} disabled={locked} light />
          <span style={{ fontSize: 12, color: "#4a4436", lineHeight: 1.5 }}>Players join, then open or join game rooms from the contest page. Every win against another player counts, up to 2 games against the same opponents.</span>
        </>
      )}

      {step(4, "Prize")}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input aria-label="Prize in ZEC" disabled={locked} value={prize} onChange={(e) => setPrize(e.target.value)} inputMode="decimal" placeholder="0.1" style={{ ...field, width: 140 }} />
        <b>ZEC</b>
        <span style={{ fontSize: 12, color: "#4a4436" }}>Your limit: {limit} ZEC</span>
      </div>
      <Chips label="Prize split" value={split} onChange={setSplit} options={[...SPLITS, ...(MORE_SPLITS.some(([k]) => k === split) ? MORE_SPLITS.filter(([k]) => k === split) : [])]} disabled={locked} light />

      <details>
        <summary style={{ ...lbl, cursor: "pointer" }}>More options</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
          <span style={lbl}>Other prize splits</span>
          <Chips label="Other prize splits" value={split} onChange={setSplit} options={MORE_SPLITS.filter(([k]) => game === "football" || k !== "all_correct")} disabled={locked} light />
          {split === "custom" && <><label htmlFor="sc-shares" style={lbl}>Percent for each rank</label><input id="sc-shares" disabled={locked} value={shares} onChange={(e) => setShares(e.target.value)} style={field} /></>}
          {split === "equal_split" && <><label htmlFor="sc-topn" style={lbl}>Number of winners</label><input id="sc-topn" disabled={locked} value={topN} onChange={(e) => setTopN(e.target.value)} inputMode="numeric" style={field} /></>}
          <label htmlFor="sc-desc" style={lbl}>Description</label>
          <textarea id="sc-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={500} style={{ ...field, height: "auto", padding: "8px 10px" }} />
          <span style={lbl}>When it goes public</span>
          <Chips label="When it goes public" value={openMode} onChange={setOpenMode} options={[["now", "When I save"], ["later", "At a time I choose"]]} disabled={locked} light />
          {openMode === "later" && <input aria-label="Opens at" type="datetime-local" disabled={locked} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} style={field} />}
          <label htmlFor="sc-deadline" style={lbl}>Last time to join</label>
          <input id="sc-deadline" type="datetime-local" disabled={locked} value={deadline} onChange={(e) => setDeadline(e.target.value)} style={field} />
          <label htmlFor="sc-logo" style={lbl}>Logo image link (https://…)</label>
          <input id="sc-logo" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://yourbrand.com/logo.png" style={field} />
          <label htmlFor="sc-color" style={lbl}>Brand colour</label>
          <div style={{ display: "flex", gap: 8 }}><input id="sc-color" type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#ffb547"} onChange={(e) => setColor(e.target.value)} style={{ width: 56, height: 46, border: "2px solid #111", borderRadius: 12, padding: 2 }} /><input aria-label="Brand colour code" value={color} onChange={(e) => setColor(e.target.value)} style={field} /></div>
          <label htmlFor="sc-url" style={lbl}>Website (https://…)</label>
          <input id="sc-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbrand.com" style={field} />
        </div>
      </details>

      {msg && <div role="alert" style={{ fontSize: 13, fontWeight: 800, color: "#9a2d1d" }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={busy} onClick={save} style={{ background: "#111", color: "var(--lime)", border: 0 }}>{busy ? "Saving…" : edit ? "Save changes" : openMode === "now" ? "Publish contest" : "Schedule contest"}</button>
        <button className="btn btn-paper" onClick={onDone} style={{ width: "auto", padding: "0 16px" }}>Cancel</button>
      </div>
    </section>
  );
}

function ContestCard({ c, onChange, onEdit }: { c: SponsorContest; onChange: () => void; onEdit: () => void }) {
  const now = useClock();
  const [err, setErr] = useState(""), [note, setNote] = useState("");
  if (now == null) return null;
  const st = state(c, now);
  const next = c.matches.find((m) => Date.parse(m.kickoff) > now);
  const isGame = !!c.game && c.game !== "football";
  async function control(action: "open_now" | "pause" | "resume") {
    setErr("");
    try { await cloudRpc("sponsor_control_contest", { p_id: c.id, p_action: action }); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not update."); }
  }
  const btn = { width: "auto", minHeight: 40, padding: "0 14px" } as const;
  return (
    <article style={{ background: "var(--panel)", border: `2px solid ${c.sponsor_color || "var(--line)"}`, borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {c.sponsor_logo && <img src={c.sponsor_logo} alt="" style={{ height: 28, borderRadius: 6 }} />}
        <b className="display" style={{ fontSize: 20, flex: 1, minWidth: 0 }}>{c.title}</b>
        <span className="chip" style={{ background: st.bg, color: st.bg === "var(--panel)" ? "var(--text)" : "#111" }}>{st.label}</span>
      </div>
      <div role="timer" style={{ fontSize: 14, fontWeight: 700 }}>
        {st.label === "Scheduled" && c.opens_at ? <>Opens in <span className="mono">{left(Date.parse(c.opens_at) - now)}</span> · {when(c.opens_at)}</>
          : c.status === "closed" ? (c.winners?.length ? `${isGame ? "Finished" : "All matches finished"}. Winners are ranked below.` : "Closed with no winners.")
          : isGame && c.ends_at ? (Date.parse(c.ends_at) > now ? <>{contestGame(c.game).name} · ends in <span className="mono">{left(Date.parse(c.ends_at) - now)}</span></> : "Time's up. Ranking the winners…")
          : next ? <>Next kickoff in <span className="mono">{left(Date.parse(next.kickoff) - now)}</span> · {next.home} vs {next.away}</> : "Waiting for the last results."}
        {c.entry_deadline && c.status !== "closed" && Date.parse(c.entry_deadline) > now && <> · joining closes in <span className="mono">{left(Date.parse(c.entry_deadline) - now)}</span></>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {[[String(c.entries), "players joined"], [`${c.prize_zec}`, "ZEC prize"], c.status === "closed" ? [String(c.winners?.filter((w) => w.status === "paid" && w.zec > 0).length ?? 0) + "/" + String(c.winners?.filter((w) => w.zec > 0).length ?? 0), "winners paid"] : isGame ? [String(c.games_played ?? 0), "games played"] : [String(c.matches.length), c.matches.length === 1 ? "match" : "matches"]].map(([v, l]) => (
          <div key={l} style={{ background: "var(--paper)", color: "#111", borderRadius: 12, padding: 10 }}><div className="display" style={{ fontSize: 24 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700 }}>{l}</div></div>
        ))}
      </div>
      {!isGame && <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="eyebrow" style={{ color: "var(--muted)" }}>Matches</span>
        {c.matches.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <span>{m.home} {m.home_goals != null ? `${m.home_goals}–${m.away_goals}` : "vs"} {m.away}</span>
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{m.sealed} sealed · {m.home_goals != null ? "full time" : when(m.kickoff)}</span>
          </div>
        ))}
      </div>}
      {c.status === "closed" && <PayPanel c={c} now={now} onChange={onChange} />}
      {c.status === "closed" && c.winners && !c.winners.some((w) => w.zec > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="eyebrow" style={{ color: "var(--muted)" }}>Winners</span>
          {c.winners.map((w) => <div key={w.rank} style={{ fontSize: 13 }}>#{w.rank} {w.name} · {w.points} pts · {w.zec} ZEC</div>)}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{err}</div>}
      {note && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: "var(--lime)", overflowWrap: "anywhere" }}>{note}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!c.hidden && c.status !== "closed" && st.label === "Scheduled" && <button className="btn" onClick={() => control("open_now")} style={{ ...btn, background: "var(--lime)", color: "#111" }}>Open now</button>}
        {!c.hidden && c.status !== "closed" && st.label !== "Scheduled" && (c.paused
          ? <button className="btn" onClick={() => control("resume")} style={{ ...btn, background: "var(--lime)", color: "#111" }}>Resume joining</button>
          : <button className="btn btn-quiet" onClick={() => control("pause")} style={btn}>Pause joining</button>)}
        {c.status !== "closed" && <button className="btn btn-quiet" onClick={onEdit} style={btn}>Edit</button>}
        <Link href={`/contest?c=${c.id}`} className="btn btn-quiet" style={btn}>Public page</Link>
        <button className="btn btn-quiet" style={btn} onClick={() => { navigator.clipboard?.writeText(`${location.origin}/contest?c=${c.id}`).then(() => setNote("Link copied. Share it anywhere: people who sign in come straight back to this contest."), () => setNote(`Your link: ${location.origin}/contest?c=${c.id}`)); }}>Copy link</button>
      </div>
    </article>
  );
}

export function SponsorDashboardView({ data, reload }: { data: SponsorDashboard; reload: () => void }) {
  const [form, setForm] = useState<"new" | SponsorContest | null>(null);
  const done = () => { setForm(null); reload(); refreshContests(); };
  const changed = () => { reload(); refreshContests(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div><span className="eyebrow" style={{ color: "var(--muted)" }}>Sponsor dashboard</span><h1 className="display" style={{ margin: 0, fontSize: 30 }}>{data.name}</h1></div>
        {!form && <button className="btn" onClick={() => setForm("new")} style={{ width: "auto", padding: "0 18px", background: "var(--lime)", color: "#111" }}>New contest</button>}
      </div>
      <div style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 12, fontSize: 13, lineHeight: 1.5 }}>
        <b>You pay your winners directly</b> from your own Zcash wallet; Called It never holds your money.
        {" "}Prize limit: <b>{data.limit_zec} ZEC</b> across your open contests and unpaid winners{data.owed_zec > 0 ? <> (you owe <b>{data.owed_zec} ZEC</b> now)</> : null}. It grows by every ZEC your winners confirm they received.
      </div>
      {form && <ContestForm key={form === "new" ? "new" : form.id} edit={form === "new" ? undefined : form} limit={data.limit_zec} onDone={done} />}
      {data.contests.length === 0 && !form && <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>No contests yet. Create your first one: pick matches, set the prize and choose when it goes public.</p>}
      {data.contests.map((c) => <ContestCard key={c.id} c={c} onChange={changed} onEdit={() => { setForm(c); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Your contests settle automatically when their last match finishes. You then have 72 hours to pay each winner in shielded ZEC, and each winner confirms when it arrives. Your public record shows how many contests you paid in full. Only you can see and change your contests here.</p>
    </div>
  );
}
