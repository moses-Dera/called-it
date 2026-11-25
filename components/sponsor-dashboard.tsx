"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cloudRpc, refreshContests, useFixtures, useFundAddress, type SponsorContest, type SponsorDashboard } from "@/lib/cloud";
import { phaseOf } from "@/lib/data";
import { zip321 } from "@/lib/zip321";

const STRUCTURES = [
  ["top3", "Top 3 (50 / 30 / 20)"], ["top5", "Top 5 (40 / 25 / 15 / 10 / 10)"], ["top10", "Top 10 (tiered)"], ["top20", "Top 20 (deep pool)"],
  ["equal_split", "Equal split among the top N"], ["custom", "Custom % per rank"], ["all_correct", "Split among exact scores"], ["random_draw", "Random draw (one winner)"],
] as const;
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

function FundPanel({ c }: { c: SponsorContest }) {
  const fund = useFundAddress();
  const [qr, setQr] = useState("");
  const due = Math.max(0, Number((c.prize_zec - c.funded_zec).toFixed(8)));
  const link = fund && due > 0 ? zip321(fund, due, `fund:${c.id}`) : "";
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr).catch(() => setQr("")); }, [link]);
  if (c.prize_zec <= 0) return null;
  if (due <= 0) return <div style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>Prize fully funded: {c.funded_zec} ZEC</div>;
  if (!fund) return <div style={{ fontSize: 13, color: "var(--muted)" }}>Funding opens once Called It sets its prize wallet. We&apos;ll be in touch.</div>;
  return (
    <div style={{ background: "var(--paper)", color: "#111", borderRadius: 16, padding: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      {qr && <img src={qr} alt="Payment QR code" width={140} height={140} style={{ borderRadius: 10, border: "2px solid #111" }} />}
      <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <b style={{ fontSize: 15 }}>Fund your prize: {due} ZEC</b>
        <span style={{ fontSize: 13, lineHeight: 1.5 }}>Scan with Zashi or Ywallet, or tap the button on your phone. Amount, address and memo are filled in for you. This money is recorded against this contest only.</span>
        <a href={link} className="btn" style={{ background: "#111", color: "var(--lime)", border: 0, alignSelf: "flex-start", width: "auto", padding: "0 16px" }}>Open in wallet</a>
        <span style={{ fontSize: 12, color: "#4a4436" }}>{c.funded_zec > 0 ? `${c.funded_zec} of ${c.prize_zec} ZEC received so far. ` : ""}Payments are confirmed by the Called It team, usually within a day.</span>
      </div>
    </div>
  );
}

function ContestForm({ edit, onDone }: { edit?: SponsorContest; onDone: () => void }) {
  const fixtures = useFixtures();
  const now = useClock();
  const locked = !!edit && edit.entries > 0;
  const [title, setTitle] = useState(edit?.title ?? ""), [desc, setDesc] = useState(edit?.description ?? "");
  const [pick, setPick] = useState<string[]>(edit?.fixture_ids ?? []), [prize, setPrize] = useState(edit ? String(edit.prize_zec) : "");
  const [structure, setStructure] = useState<string>(edit?.prize_structure ?? "top3");
  const [shares, setShares] = useState(edit?.custom_shares?.join(", ") ?? "50, 30, 20"), [topN, setTopN] = useState(String(edit?.prize_structure === "equal_split" ? edit.custom_shares?.[0] ?? 5 : 5));
  const [deadline, setDeadline] = useState(toLocalInput(edit?.entry_deadline));
  const [openMode, setOpenMode] = useState<"now" | "later">(edit?.opens_at && Date.parse(edit.opens_at) > Date.now() ? "later" : "now");
  const [opensAt, setOpensAt] = useState(toLocalInput(edit?.opens_at));
  const [logo, setLogo] = useState(edit?.sponsor_logo ?? ""), [color, setColor] = useState(edit?.sponsor_color ?? "#ffb547"), [url, setUrl] = useState(edit?.sponsor_url ?? "");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const upcoming = now == null ? [] : fixtures.filter((f) => f.id.startsWith("fd-") && phaseOf(f, now) === "upcoming").sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, 40);

  async function save() {
    if (!title.trim()) return setMsg("Give the contest a title.");
    if (!pick.length) return setMsg("Pick at least one match.");
    const zec = Number(prize || 0);
    if (!(zec >= 0)) return setMsg("The prize should be a number of ZEC.");
    let custom: number[] | null = null;
    if (structure === "custom") { custom = shares.split(",").map((x) => Number(x.trim())).filter((n) => n > 0); if (!custom.length) return setMsg("Enter the percentage for each rank, like 50, 30, 20."); }
    if (structure === "equal_split") custom = [Math.max(1, Number(topN) || 5)];
    if (openMode === "later" && !opensAt) return setMsg("Choose when the contest opens.");
    setBusy(true); setMsg("");
    try {
      await cloudRpc("sponsor_save_contest", {
        p_id: edit?.id ?? `${slug(title) || "contest"}-${Math.random().toString(36).slice(2, 6)}`, p_title: title, p_fixtures: pick, p_prize: zec,
        p_structure: structure, p_custom_shares: custom, p_entry_deadline: deadline ? new Date(deadline).toISOString() : null,
        p_opens_at: openMode === "later" ? new Date(opensAt).toISOString() : null, p_description: desc, p_logo: logo, p_color: color, p_url: url,
      });
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }

  const field = { height: 46, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 10px", fontSize: 15, width: "100%", boxSizing: "border-box" } as const;
  const lbl = { fontSize: 12, fontWeight: 800 } as const;
  return (
    <section className="paper" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, color: "#111" }}>
      <h2 className="display" style={{ margin: 0, fontSize: 22 }}>{edit ? "Edit contest" : "New contest"}</h2>
      {locked && <div style={{ fontSize: 13, fontWeight: 700, background: "var(--amber)", borderRadius: 10, padding: "8px 10px" }}>Players have joined, so the matches, prize and deadline are locked. You can still change the title, text and branding.</div>}
      <label htmlFor="sc-title" style={lbl}>Title</label>
      <input id="sc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} style={field} />
      <label htmlFor="sc-desc" style={lbl}>Description (optional)</label>
      <textarea id="sc-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={500} style={{ ...field, height: "auto", padding: "8px 10px" }} />
      <span style={lbl}>Matches</span>
      <div style={{ maxHeight: 220, overflowY: "auto", border: "2px solid #111", borderRadius: 12, background: "#fff", opacity: locked ? 0.6 : 1 }}>
        {upcoming.length === 0 && <div style={{ padding: 10, fontSize: 13 }}>No upcoming matches yet.</div>}
        {upcoming.map((f) => (
          <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "1px solid #e5dcc6", fontSize: 14, cursor: locked ? "default" : "pointer" }}>
            <input type="checkbox" disabled={locked} checked={pick.includes(f.id)} onChange={(e) => setPick((p) => e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id))} />
            <span style={{ flex: 1 }}><b>{f.home} vs {f.away}</b> · {f.when}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label htmlFor="sc-prize" style={lbl}>Prize pot (ZEC)</label><input id="sc-prize" disabled={locked} value={prize} onChange={(e) => setPrize(e.target.value)} inputMode="decimal" placeholder="2.5" style={field} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label htmlFor="sc-split" style={lbl}>Prize split</label><select id="sc-split" disabled={locked} value={structure} onChange={(e) => setStructure(e.target.value)} style={field}>{STRUCTURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      {structure === "custom" && <><label htmlFor="sc-shares" style={lbl}>Percent for each rank</label><input id="sc-shares" disabled={locked} value={shares} onChange={(e) => setShares(e.target.value)} style={field} /></>}
      {structure === "equal_split" && <><label htmlFor="sc-topn" style={lbl}>Number of winners</label><input id="sc-topn" disabled={locked} value={topN} onChange={(e) => setTopN(e.target.value)} inputMode="numeric" style={field} /></>}
      <label htmlFor="sc-deadline" style={lbl}>Last time to join (optional)</label>
      <input id="sc-deadline" type="datetime-local" disabled={locked} value={deadline} onChange={(e) => setDeadline(e.target.value)} style={field} />
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6, opacity: locked ? 0.6 : 1 }}>
        <legend style={{ ...lbl, marginBottom: 6 }}>When it goes public</legend>
        <label style={{ display: "flex", gap: 8, fontSize: 14 }}><input type="radio" name="sc-open" disabled={locked} checked={openMode === "now"} onChange={() => setOpenMode("now")} /> As soon as I save</label>
        <label style={{ display: "flex", gap: 8, fontSize: 14 }}><input type="radio" name="sc-open" disabled={locked} checked={openMode === "later"} onChange={() => setOpenMode("later")} /> At a time I choose</label>
        {openMode === "later" && <input aria-label="Opens at" type="datetime-local" disabled={locked} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} style={field} />}
      </fieldset>
      <details>
        <summary style={{ ...lbl, cursor: "pointer" }}>Branding</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
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
          : c.status === "closed" ? "All matches finished. Winners are ranked below."
          : next ? <>Next kickoff in <span className="mono">{left(Date.parse(next.kickoff) - now)}</span> · {next.home} vs {next.away}</> : "Waiting for the last results."}
        {c.entry_deadline && c.status !== "closed" && Date.parse(c.entry_deadline) > now && <> · joining closes in <span className="mono">{left(Date.parse(c.entry_deadline) - now)}</span></>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {[[String(c.entries), "players joined"], [`${c.prize_zec}`, "ZEC prize"], [`${c.funded_zec}`, "ZEC funded"]].map(([v, l]) => (
          <div key={l} style={{ background: "var(--paper)", color: "#111", borderRadius: 12, padding: 10 }}><div className="display" style={{ fontSize: 24 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700 }}>{l}</div></div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="eyebrow" style={{ color: "var(--muted)" }}>Matches</span>
        {c.matches.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <span>{m.home} {m.home_goals != null ? `${m.home_goals}–${m.away_goals}` : "vs"} {m.away}</span>
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{m.sealed} sealed · {m.home_goals != null ? "full time" : when(m.kickoff)}</span>
          </div>
        ))}
      </div>
      {c.status !== "closed" && <FundPanel c={c} />}
      {c.status === "closed" && c.winners && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="eyebrow" style={{ color: "var(--muted)" }}>Winners</span>
          {c.winners.map((w) => <div key={w.rank} style={{ fontSize: 13 }}>#{w.rank} {w.name} · {w.points} pts · {w.zec} ZEC{w.status === "paid" ? " · paid" : ""}</div>)}
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
      {form && <ContestForm key={form === "new" ? "new" : form.id} edit={form === "new" ? undefined : form} onDone={done} />}
      {data.contests.length === 0 && !form && <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>No contests yet. Create your first one: pick matches, set the prize and choose when it goes public.</p>}
      {data.contests.map((c) => <ContestCard key={c.id} c={c} onChange={changed} onEdit={() => { setForm(c); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Your contests settle automatically when their last match finishes. Called It pays the winners in shielded ZEC from the prize you funded. Only you can see and change your contests here.</p>
    </div>
  );
}
