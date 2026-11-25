"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img, Lock, TopBar } from "@/components/ui";
import { followTipster, useCloud, useTipster, type TipsterTip } from "@/lib/cloud";
import { describePick } from "@/lib/data";
import { usePush } from "@/components/notifications";
import { short } from "@/lib/store";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function lead(fromIso: string, toIso: string) {
  const m = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const REASON: Record<TipsterTip["reason"], string> = {
  revealed: "",
  missing: "Not revealed in time, so it counts as lost",
  mismatch: "Did not match its seal, so it counts as lost",
};

function TipRow({ t }: { t: TipsterTip }) {
  const [open, setOpen] = useState(false);
  const won = t.outcome === "won";
  return (
    <div style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "none", border: 0, color: "var(--text)", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}>
        <span aria-label={won ? "Won" : "Lost"} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, background: won ? "var(--lime)" : "var(--red)", border: "2px solid #111", color: "#111", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{won ? "W" : "L"}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <b style={{ fontSize: 14 }}>{t.home} {t.home_goals}–{t.away_goals} {t.away}</b>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            {t.pick ? `Called ${describePick(t.pick, t.home, t.away)}${t.exact ? " · exact" : ""}` : REASON[t.reason]} · sealed {lead(t.received_at, t.kickoff)} early
          </span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--lime)" }}>{open ? "Hide" : "Proof"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: "6px 10px" }}>
            <span style={{ color: "var(--muted)" }}>Match</span><span>{day(t.kickoff)}, kickoff {time(t.kickoff)}</span>
            <span style={{ color: "var(--muted)" }}>Seal received</span><span>{day(t.received_at)}, {time(t.received_at)}</span>
            <span style={{ color: "var(--muted)" }}>Bitcoin</span><span>{t.height ? `Block ${t.height.toLocaleString()}` : t.root ? "Stamped, waiting for a block" : "Not batched yet"}</span>
            <span style={{ color: "var(--muted)" }}>Fingerprint</span><span style={{ fontFamily: "ui-monospace, monospace", overflowWrap: "anywhere" }}>{t.commitment ?? "—"}</span>
          </div>
          {t.root && <a href={`/api/anchor/proof?root=${t.root}`} style={{ alignSelf: "flex-start", fontWeight: 800 }}>Download Bitcoin proof (batch {short(t.root)})</a>}
        </div>
      )}
    </div>
  );
}

export default function TipsterPage() {
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => { setHandle(new URLSearchParams(location.search).get("h")); }, []);
  const { tipster: t } = useTipster(handle);
  const signedIn = !!useCloud().session;
  const push = usePush();
  const [follow, setFollow] = useState<{ on: boolean; count: number } | null>(null);
  const [followMsg, setFollowMsg] = useState("");
  const f = follow ?? (t ? { on: t.following, count: t.followers } : null);
  async function toggleFollow() {
    if (!t || !f) return;
    const next = !f.on;
    setFollow({ on: next, count: f.count + (next ? 1 : -1) }); setFollowMsg("");
    try { await followTipster(t.handle, next); }
    catch (e) { setFollow(f); setFollowMsg(e instanceof Error ? e.message : "Could not update."); }
  }
  const rate = t && t.settled ? Math.round((t.won / t.settled) * 100) : null;
  let run = "";
  if (t?.form.length) {
    const last = t.form[t.form.length - 1];
    let n = 0;
    for (let i = t.form.length - 1; i >= 0 && t.form[i] === last; i--) n++;
    run = `${last === "won" ? "W" : "L"}${n}`;
  }

  return (
    <main className="screen wide hub">
      <TopBar eyebrow="Verified record" title={t ? `@${t.handle}` : "Tipster"} />
      <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {(handle === null || t === undefined) && <div style={{ height: 320, borderRadius: 22, background: "var(--panel)" }} />}
        {handle !== null && t === null && (
          <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 20, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            <b className="display" style={{ fontSize: 22 }}>No public record here</b>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>This handle does not exist, or its owner keeps their record private.</span>
            <Link href="/" className="btn" style={{ alignSelf: "flex-start", width: "auto", padding: "0 18px" }}>Go home</Link>
          </section>
        )}
        {t && (
          <>
            <section style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Img n={`avatar_${t.avatar}`} size={72} alt="" style={{ borderRadius: 22, border: "3px solid #111", boxShadow: "4px 4px 0 var(--text)" }} />
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <h1 className="display" style={{ margin: 0, fontSize: 28 }}>{t.name}</h1>
                {t.bio && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{t.bio}</span>}
              </div>
            </section>

            <section style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}><b className="display" style={{ fontSize: 20 }}>{f?.count ?? 0}</b> follower{f?.count === 1 ? "" : "s"}</span>
              <span style={{ flex: 1 }} />
              {t.is_me
                ? <Link href="/tip" className="btn" style={{ width: "auto", padding: "0 18px", background: "var(--lime)", color: "#111" }}>Seal a tip</Link>
                : signedIn
                  ? <button className="btn" onClick={toggleFollow} aria-pressed={f?.on} style={{ width: "auto", padding: "0 18px", background: f?.on ? "var(--panel)" : "var(--lime)", color: f?.on ? "var(--text)" : "#111", border: f?.on ? "2px solid var(--line)" : undefined }}>{f?.on ? "Following" : "Follow"}</button>
                  : <Link href="/profile" className="btn btn-quiet" style={{ width: "auto", padding: "0 18px" }}>Sign in to follow</Link>}
            </section>
            {followMsg && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: "var(--red)", marginTop: -8 }}>{followMsg}</div>}
            {f?.on && (
              push.on ? <span style={{ fontSize: 12, color: "var(--muted)", marginTop: -8 }}>You&apos;ll get a notification on this device when @{t.handle} seals a tip.</span>
              : push.supported && !push.denied ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel)", border: "2px solid var(--lime)", borderRadius: 14, padding: "10px 12px", marginTop: -8 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Get told when @{t.handle} seals a tip</span>
                  <button className="btn" disabled={push.busy} onClick={push.enable} style={{ width: "auto", minHeight: 40, padding: "0 14px", background: "var(--lime)", color: "#111" }}>Turn on</button>
                </div>
              ) : <span style={{ fontSize: 12, color: "var(--muted)", marginTop: -8 }}>{push.denied ? "Notifications are blocked for this site in your browser settings." : "Notifications aren't available on this device."} Check this page for new tips.</span>
            )}

            <section style={{ display: "flex", gap: 10, alignItems: "center", background: "var(--lime)", color: "#111", border: "3px solid #111", borderRadius: 16, padding: "10px 14px" }}>
              <Lock size={22} />
              <span style={{ fontSize: 13, fontWeight: 700 }}><b>Every tip sealed before kickoff.</b> One tip per match, settled by the server at full time. Losing tips cannot be hidden or deleted.</span>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {[[String(t.settled), "tips settled"], [rate === null ? "—" : `${rate}%`, "right result"], [run || "—", "current run"]].map(([v, l]) => (
                <div key={l} style={{ background: "var(--paper)", color: "#111", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="display" style={{ fontSize: 28 }}>{v}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#4a4436" }}>{l}</span>
                </div>
              ))}
            </section>
            <span style={{ fontSize: 12, color: "var(--muted)", marginTop: -8 }}>{t.exact} exact score{t.exact === 1 ? "" : "s"} · public since {day(t.public_since)}</span>

            {t.form.length > 0 && (
              <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="eyebrow" style={{ color: "var(--muted)" }}>Last {t.form.length} · oldest first</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 5 }}>
                  {t.form.map((o, i) => <span key={i} style={{ height: 30, borderRadius: 8, background: o === "won" ? "var(--lime)" : "var(--red)", color: "#111", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{o === "won" ? "W" : "L"}</span>)}
                </div>
              </section>
            )}

            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Sealed, not settled</h2>
              {t.pending.length === 0 && <span style={{ fontSize: 13, color: "var(--muted)" }}>No open tips right now.</span>}
              {t.pending.map((p) => (
                <div key={p.home + p.kickoff} style={{ display: "flex", alignItems: "stretch", background: "var(--paper)", color: "#111", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ flex: 1, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 3, borderRight: "2px dashed #c9bfa6", minWidth: 0 }}>
                    <b className="display" style={{ fontSize: 17 }}>{p.home} vs {p.away}</b>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>Sealed {day(p.received_at)} {time(p.received_at)} · kickoff {day(p.kickoff)} {time(p.kickoff)}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#6b6455" }}>The call is revealed after full time</span>
                  </div>
                  <div style={{ width: 72, background: "#111", color: "var(--lime)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, fontWeight: 800 }}><Lock size={22} color="var(--lime)" />SEALED</div>
                </div>
              ))}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Settled</h2>
              {t.tips.length === 0 && <span style={{ fontSize: 13, color: "var(--muted)" }}>No settled tips yet. Tips settle a few hours after full time.</span>}
              {t.tips.map((x) => <TipRow key={x.fixture_id} t={x} />)}
            </section>
          </>
        )}
      </div>
      <BottomNav active="/tipster" />
    </main>
  );
}
