"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MARKETS, describePick, fixtureOf, phaseOf } from "@/lib/data";
import { announceTip, myTipsterProfile, useCloud, useFixtures } from "@/lib/cloud";
import { Img, Lock, SealStatus, TeamBadge, TopBar } from "@/components/ui";
import { createSeal, useStore } from "@/lib/store";

export default function TipPage() {
  const fixtures = useFixtures();
  const store = useStore();
  const session = useCloud().session;
  const [fid, setFid] = useState<string | null>(null), [now, setNow] = useState<number | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [sealId, setSealId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  useEffect(() => { setFid(new URLSearchParams(location.search).get("f")); setNow(Date.now()); }, []);
  useEffect(() => {
    if (!session) { setHandle(null); return; }
    myTipsterProfile().then((p) => setHandle(p?.public_record ? p.handle : null));
  }, [session]);

  const nextOpen = now == null ? undefined : fixtures.filter((f) => phaseOf(f, now) === "upcoming").sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  const fx = (fid ? fixtures.find((f) => f.id === fid) : undefined) ?? nextOpen ?? fixtureOf(fid, fixtures);
  const closed = now !== null && Date.parse(fx.kickoff) <= now;
  const earlier = store.seals.find((s) => s.round === fx.id && (s.game === "tip" || s.game === "classic") && s.id !== sealId);
  const seal = store.seals.find((s) => s.id === sealId);

  async function doSeal() {
    if (!pick || closed || busy) return;
    setBusy(true);
    const s = await createSeal("tip", fx.id, pick, `${fx.home} vs ${fx.away} · ${describePick(pick, fx.home, fx.away)}`);
    setSealId(s.id); setBusy(false);
    announceTip(s.id);
  }

  return (
    <main className="screen">
      <TopBar eyebrow="Seal a tip" title={`${fx.home} vs ${fx.away}`} />
      <div style={{ padding: "4px 20px 0", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        <div style={{ background: closed ? "var(--pink)" : "var(--amber)", color: "#111", borderRadius: 14, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>
          {closed ? <><b>Sealing closed.</b> This match kicked off {fx.when}.</> : <><b>Kickoff {fx.when}.</b> Your tip stays hidden until after full time.</>}
        </div>
        {earlier && !closed && (
          <div role="status" style={{ background: "var(--panel)", border: "2px solid var(--red)", borderRadius: 14, padding: "10px 14px", fontSize: 13, fontWeight: 700 }}>
            You already sealed a call on this match. Only your first one counts on your record.
          </div>
        )}
        <div className="paper" style={{ borderRadius: 24, padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-around", boxShadow: "6px 6px 0 var(--lime)" }}>
          <TeamBadge name={fx.home} size={52} side="home" /><span className="display" style={{ fontSize: 24, color: "#111" }}>vs</span><TeamBadge name={fx.away} size={52} side="away" />
        </div>
        {MARKETS.map((m) => (
          <fieldset key={m.key} style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend style={{ fontSize: 13, fontWeight: 800, padding: 0, marginBottom: 8 }}>{m.name}</legend>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${m.options.length}, minmax(0, 1fr))`, gap: 8 }}>
              {m.options.map((o) => {
                const value = `${m.key}:${o.key}`, on = pick === value;
                const label = m.key === "1x2" && o.key !== "draw" ? (o.key === "home" ? fx.home : fx.away) : o.label;
                return (
                  <button key={value} type="button" aria-pressed={on} onClick={() => setPick(on ? null : value)} style={{ minHeight: 52, padding: "6px 8px", borderRadius: 14, border: `2px solid ${on ? "#111" : "var(--line)"}`, background: on ? "var(--lime)" : "var(--panel)", color: on ? "#111" : "var(--text)", fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>{label}</button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          {handle === undefined ? "" : handle
            ? <>This tip goes on your public record <Link href={`/tipster?h=${handle}`}>@{handle}</Link>, and your followers are told you sealed one.</>
            : <>Want a record people can check? <Link href="/profile">Make your tipster record public</Link> in Profile.</>}
        </div>
      </div>
      <div style={{ padding: "14px 20px 30px" }}>
        <button className="btn btn-primary" style={{ width: "100%", opacity: closed || !pick ? 0.5 : 1 }} disabled={closed || !pick || busy} onClick={doSeal}>
          <Lock />{closed ? "Kickoff passed" : busy ? "Sealing…" : pick ? `Seal: ${describePick(pick, fx.home, fx.away)}` : "Pick one tip"}
        </button>
      </div>

      {seal && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(11,15,20,.95)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 30, textAlign: "center" }}>
          <Img n="seal" size={180} alt="Wax seal" className="stamp" />
          <div className="display" style={{ fontSize: 40 }}>Sealed.</div>
          <div style={{ fontSize: 14, color: "#c9d3de", lineHeight: 1.5 }}>{seal.label}<br />Nobody can see or change it before full time.</div>
          <SealStatus seal={seal} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
            {handle ? <Link href={`/tipster?h=${handle}`} className="btn" style={{ background: "var(--lime)", color: "#111" }}>My record</Link> : <Link href="/profile" className="btn" style={{ background: "var(--lime)", color: "#111" }}>Go public</Link>}
            <Link href="/" className="btn btn-paper">Home</Link>
          </div>
        </div>
      )}
    </main>
  );
}
