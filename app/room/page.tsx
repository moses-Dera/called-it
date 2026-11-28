"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BottomNav, Img, Lock } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { art } from "@/lib/data";
import { useCloud } from "@/lib/cloud";
import { sha256Hex } from "@/lib/merkle";
import { BLUFF_CARDS, GAME_INFO, ROOM_RULES, forceSettle, hasLocalSeal, myPlacement, myRole, nextRound, reportHits, revealMine, sealMove, setAnswer, startRoom, useRoom, type MyRole, type Room } from "@/lib/rooms";

const STEP: Record<Room["status"], string> = { lobby: "Waiting to start", sealing: "Seal your move", revealing: "Opening the seals", report: "Counting hits", answer: "Waiting for the answer", done: "Result" };
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function RoomPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(new URLSearchParams(location.search).get("id")); }, []);
  const signedIn = !!useCloud().session;
  const { room, error, reload } = useRoom(id);
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [rulesOpen, setRulesOpen] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMsg("");
    try { await fn(); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong"); }
    setBusy(false);
  }

  // Reveal automatically once everyone has sealed (time capsules: once their date has come).
  const revealing = useRef(false);
  const me = room?.players.find((p) => p.user_id === room.me);
  useEffect(() => {
    if (!room || room.status !== "revealing" || !me?.sealed || me.revealed || revealing.current) return;
    if (room.game === "capsule" && room.options.opens && Date.parse(room.options.opens) > Date.now()) return;
    if (!hasLocalSeal(room)) return;
    revealing.current = true;
    revealMine(room).then(reload, (e) => setMsg(e instanceof Error ? e.message : "Reveal failed")).finally(() => { revealing.current = false; });
  }, [room, me, reload]);

  // Deadline passed: any player's app settles the step (whoever didn't act loses that round).
  const settling = useRef(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const late = !!room?.reveal_by && Date.parse(room.reveal_by) < Date.now() && ["sealing", "revealing", "report"].includes(room.status);
  useEffect(() => {
    if (!room || !late || settling.current) return;
    settling.current = true;
    forceSettle(room.id).then(reload, () => {}).finally(() => { settling.current = false; });
  }, [room, late, reload]);

  // Fog of War: report the hits this device's units took, straight after each turn opens.
  const reporting = useRef(false);
  useEffect(() => {
    if (!room || room.game !== "fog" || room.status !== "report" || !me?.plays || me.reported || reporting.current || !myPlacement(room)) return;
    reporting.current = true;
    reportHits(room).then(reload, (e) => setMsg(e instanceof Error ? e.message : "Report failed")).finally(() => { reporting.current = false; });
  }, [room, me, reload]);

  if (!signedIn) return <Shell><section className="paper" style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, maxWidth: 560 }}><span style={{ flex: 1, fontWeight: 700 }}>Sign in to play this game.</span><SignInPill /></section></Shell>;
  if (error) return <Shell><p style={{ color: "var(--pink)", fontWeight: 700 }}>{error}</p><Link href="/rooms" style={{ color: "var(--lime)", fontWeight: 800 }}>Back to your games</Link></Shell>;
  if (!room) return <Shell><p style={{ color: "var(--muted)" }}>Loading the room…</p></Shell>;

  const info = GAME_INFO[room.game];
  const plays = room.players.filter((p) => p.plays && p.state === "joined");
  const joinedCount = room.players.filter((p) => p.state === "joined").length;
  const maxPlayers = Math.min(room.options.max_players ?? info.max, info.max);
  const sealed = plays.filter((p) => p.sealed).length, revealed = plays.filter((p) => p.revealed).length;
  const rpsRoundInMatch = (room.result?.history?.length ?? 0) + (room.status === "done" ? 0 : 1);
  const invite = typeof location !== "undefined" ? `${location.origin}/rooms?join=${room.code}` : "";

  return (
    <Shell>
      <div className="room-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 18, alignItems: "start" }}>
        <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 24, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Img n={info.img} size={56} style={{ borderRadius: 16, border: "2px solid #111" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="eyebrow" style={{ color: "var(--lime)" }}>{info.name}{room.game === "werewolf" && room.status !== "lobby" && room.status !== "done" ? ` · ${room.result?.phase === "night" ? "night" : "day"} ${room.result?.day ?? 1}` : ""}{room.game === "arcade" && room.status !== "lobby" ? ` · round ${Math.min(rpsRoundInMatch, room.options.rounds ?? 3)} of ${room.options.rounds ?? 3}` : room.game === "bluff" ? ` · round ${room.round} of ${room.options.rounds ?? 5}` : room.game === "fog" ? (room.round > 0 && room.status !== "done" ? ` · turn ${room.round} of ${room.options.turns ?? 6}` : "") : room.round > 1 ? ` · round ${room.round}` : ""}</span>
              <h1 className="display" style={{ margin: 0, fontSize: 26 }}>{room.title || info.name}</h1>
            </div>
            <button type="button" aria-label="Game rules" onClick={() => setRulesOpen(true)} className="iconbtn display" style={{ background: "var(--paper)", color: "#111", fontSize: 18 }}>?</button>
          </div>
          {rulesOpen && (
            <div role="dialog" aria-modal="true" aria-label={`${info.name} rules`} onClick={() => setRulesOpen(false)} className="guide" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,7,10,.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div className="sheet paper" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, borderRadius: "28px 28px 0 0", padding: "22px 20px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="eyebrow" style={{ color: "#6b6455" }}>Game rules</span>
                  <span className="chip" style={{ background: "var(--amber)" }}>{info.capLabel}</span>
                </div>
                <div className="display" style={{ fontSize: 28 }}>{info.name}</div>
                {ROOM_RULES[room.game].steps.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span className="display" style={{ width: 28, height: 28, borderRadius: 9, background: "#111", color: "var(--lime)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, paddingTop: 3 }}>{s}</span>
                  </div>
                ))}
                <div style={{ borderTop: "2px dashed #c9bfa6", paddingTop: 10, fontSize: 13, lineHeight: 1.5 }}><b>Scoring &amp; forfeits:</b> {ROOM_RULES[room.game].scoring}</div>
                <button type="button" className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} onClick={() => setRulesOpen(false)}>Got it</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="chip" style={{ background: "var(--amber)" }}>{STEP[room.status].toUpperCase()}</span>
            <span className="chip" style={{ background: "var(--panel)", color: "var(--text)", border: "1px solid var(--line)" }}>{joinedCount}/{maxPlayers} players</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Host: {room.is_host ? "you" : room.host_name}</span>
            {room.reveal_by && ["sealing", "revealing", "report"].includes(room.status) && <Countdown until={room.reveal_by} />}
          </div>
          {room.status === "lobby" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#0b0f14", borderRadius: 16, padding: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Invite more people with this code or link</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="display mono" style={{ fontSize: 28, letterSpacing: 4, color: "var(--lime)" }}>{room.code}</span>
                <button className="btn btn-quiet" style={{ minHeight: 38, fontSize: 13, marginLeft: "auto" }} onClick={() => { navigator.clipboard?.writeText(invite); setMsg("Invite link copied."); }}>Copy link</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {room.players.map((p) => (
              <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", borderTop: "1px solid var(--line)", opacity: p.state === "invited" ? 0.6 : 1 }}>
                <img src={art(`avatar_${p.avatar}`)} alt="" width={34} height={34} style={{ borderRadius: 10, border: "2px solid #111" }} />
                <b style={{ flex: 1, fontSize: 14 }}>{p.name}{p.user_id === room.me ? " (you)" : ""}{p.user_id === room.host ? " · host" : ""}</b>
                <span style={{ fontSize: 12, fontWeight: 800, color: p.revealed ? "var(--lime)" : p.sealed ? "var(--amber)" : "var(--muted)" }}>
                  {p.state === "invited" ? "invited" : !p.plays ? "referee" : p.revealed ? "✓ revealed" : p.sealed ? "✓ sealed" : room.status === "lobby" ? "ready" : "thinking…"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="paper" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, boxShadow: "6px 6px 0 var(--lime)" }}>
          {room.status === "lobby" && (room.is_host ? (
            <>
              <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Ready when they are</h2>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#4a4436", lineHeight: 1.5 }}>{room.game === "arcade" ? "Start once your opponent has joined." : room.game === "closest" ? "You are the referee: you don’t guess, you enter the true answer at the end. Start once at least two players have joined." : "Start once everyone you want has joined. Late invites can’t join after the start."}</p>
              <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} disabled={busy} onClick={() => run(() => startRoom(room.id))}>Start the game</button>
            </>
          ) : <><h2 className="display" style={{ margin: 0, fontSize: 24 }}>You’re in</h2><p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#4a4436" }}>Waiting for {room.host_name} to start.</p></>)}

          {room.game === "werewolf" && room.status !== "lobby" && <WolfStory room={room} />}
          {room.game === "arcade" && (room.result?.history?.length ?? 0) > 0 && <ArcadeBoard room={room} />}
          {room.game === "bluff" && (room.result?.history?.length ?? 0) > 0 && <BluffBoard room={room} />}
          {room.game === "fog" && room.status !== "lobby" && <FogBoard room={room} />}

          {room.status === "sealing" && (me?.plays ? (me.sealed
            ? <Waiting text={`Your move is sealed. Waiting for ${plays.length - sealed} more.`} />
            : <MovePicker room={room} busy={busy} onSeal={(move) => run(() => sealMove(room, move))} />)
            : <Waiting text={`You’re the referee. ${sealed} of ${plays.length} sealed.`} />)}

          {room.status === "revealing" && (
            <>
              <Waiting text={room.game === "capsule" && room.options.opens && Date.parse(room.options.opens) > Date.now()
                ? `Everyone has sealed. The capsule opens ${fmt(room.options.opens)}.`
                : room.game === "fog" && room.round === 0 ? `Battle over. Opening both unit positions to check every report: ${revealed} of ${plays.length}.`
                : `All moves are sealed. Opening them: ${revealed} of ${plays.length} revealed.`} />
              {me?.sealed && !me.revealed && !hasLocalSeal(room) && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#9a2d1d" }}>You sealed this move on another device. It is being fetched from your account; if this persists, open the room on that device.</p>}
              {room.reveal_by && Date.parse(room.reveal_by) < Date.now() && room.game !== "capsule" && (
                <button className="btn btn-paper" disabled={busy} onClick={() => run(() => forceSettle(room.id))}>Close the round (players who didn’t reveal forfeit)</button>
              )}
              {room.reveal_by && <span style={{ fontSize: 12, color: "#4a4436" }}>Players who don’t reveal by {fmt(room.reveal_by)} forfeit.</span>}
            </>
          )}

          {room.status === "report" && (
            <>
              <Waiting text={`Both volleys are open. Counting hits: ${plays.filter((p) => p.reported).length} of ${plays.length} reported.`} />
              {me?.plays && !me.reported && !myPlacement(room) && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#9a2d1d" }}>Your unit positions are on another device. Open this game there to report.</p>}
              {room.reveal_by && Date.parse(room.reveal_by) < Date.now() && <button className="btn btn-paper" disabled={busy} onClick={() => run(() => forceSettle(room.id))}>End the game (the player who didn’t report forfeits)</button>}
            </>
          )}
          {room.status === "answer" && <AnswerStep room={room} busy={busy} onAnswer={(n) => run(() => setAnswer(room.id, n))} />}
          {room.status === "done" && <Result room={room} busy={busy} onNext={() => run(() => nextRound(room.id))} />}
          {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700 }}>{msg}</div>}
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="screen wide hub hub-pad">
      <Link href="/rooms" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)", alignSelf: "flex-start" }}>← Your games</Link>
      <div style={{ paddingBottom: 24 }}>{children}</div>
      <BottomNav active="/rooms" />
    </main>
  );
}

function Waiting({ text }: { text: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Img n="seal" size={56} className="stamp" /><b style={{ fontSize: 16, lineHeight: 1.4 }}>{text}</b></div>;
}

function MovePicker({ room, busy, onSeal }: { room: Room; busy: boolean; onSeal: (move: string) => void }) {
  const [v, setV] = useState("");
  const big: React.CSSProperties = { minHeight: 76, borderRadius: 20, border: "3px solid #111", boxShadow: "0 5px 0 #111", color: "#111", fontSize: 18 };
  if (room.game === "arcade") return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Pick your move</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {["Rock", "Paper", "Scissors"].map((m) => <button key={m} disabled={busy} className="display" onClick={() => onSeal(m)} style={{ ...big, background: "#fff4c2" }}>{m}</button>)}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>Tapping a move seals it. Your opponent can’t see it until both are sealed.</p>
    </>
  );
  if (room.game === "bluff") {
    const used = new Set((room.result?.history ?? []).flatMap((h) => h.cards.filter((c) => c.user_id === room.me).map((c) => c.move)));
    return (
      <>
        <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Play a card</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {BLUFF_CARDS.map((c) => {
            const gone = used.has(c);
            return (
              <button key={c} disabled={busy || gone} onClick={() => onSeal(c)} aria-label={gone ? `${c}, already played` : c} style={{ height: 96, borderRadius: 14, border: "3px solid #111", boxShadow: gone ? "none" : "0 4px 0 #111", background: c === "Steal" ? "var(--pink)" : c === "Shield" ? "#9FD8FF" : "var(--paper)", color: "#111", opacity: gone ? 0.3 : 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span className="display" style={{ fontSize: c.length > 2 ? 17 : 30 }}>{c}</span>
                <span style={{ fontSize: 9, fontWeight: 800 }}>{gone ? "USED" : c === "Steal" || c === "Shield" ? c.toUpperCase() : "NUMBER"}</span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436", lineHeight: 1.45 }}>Each card works once. Shield beats Steal, Steal beats any number, otherwise the highest number takes the 10 chips.</p>
      </>
    );
  }
  if (room.game === "fog") return <FogPicker room={room} busy={busy} onSeal={onSeal} />;
  if (room.game === "werewolf") return <WolfPicker room={room} busy={busy} onSeal={onSeal} />;
  if (room.game === "vote") return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{room.title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {(room.options.choices ?? []).map((c) => <button key={c} disabled={busy} className="display" onClick={() => onSeal(c)} style={{ ...big, background: "var(--paper)" }}>{c}</button>)}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>Your vote is sealed the moment you tap. Results open when everyone has voted.</p>
    </>
  );
  if (room.game === "closest") return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{room.title}</h2>
      <input aria-label="Your guess" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="Your guess" className="display" style={{ height: 76, fontSize: 40, textAlign: "center", borderRadius: 20, border: "3px solid #111", background: "#111", color: "var(--lime)" }} />
      <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} disabled={busy || v === "" || Number.isNaN(Number(v))} onClick={() => onSeal(String(Number(v)))}><Lock />Seal {v || "guess"}</button>
    </>
  );
  return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Write to the future</h2>
      <textarea aria-label="Your message" rows={4} maxLength={600} value={v} onChange={(e) => setV(e.target.value)} placeholder="Where I think we’ll all be…" style={{ borderRadius: 14, border: "2px solid #111", padding: 12, font: "500 15px var(--font-inter), sans-serif", resize: "vertical", background: "#fff", color: "#111" }} />
      <span style={{ fontSize: 12, color: "#4a4436" }}>Opens {room.options.opens ? fmt(room.options.opens) : "later"}. Until then only its fingerprint exists. Keep this device: the text stays on it until opening day.</span>
      <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} disabled={busy || !v.trim()} onClick={() => onSeal(v.trim())}><Lock />Seal my message</button>
    </>
  );
}

function AnswerStep({ room, busy, onAnswer }: { room: Room; busy: boolean; onAnswer: (n: number) => void }) {
  const [v, setV] = useState("");
  return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>All guesses are open</h2>
      <Guesses list={room.result?.guesses ?? []} />
      {room.is_host ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input aria-label="The true answer" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="True answer" style={{ flex: 1, height: 52, borderRadius: 14, border: "2px solid #111", padding: "0 12px", fontSize: 18, fontWeight: 800, color: "#111", background: "#fff", minWidth: 0 }} />
          <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} disabled={busy || v === "" || Number.isNaN(Number(v))} onClick={() => onAnswer(Number(v))}>Settle</button>
        </div>
      ) : <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#4a4436" }}>Waiting for {room.host_name} to enter the true answer.</p>}
    </>
  );
}

function Guesses({ list, answer }: { list: { name: string; move: string }[]; answer?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[...list].sort((a, b) => (answer === undefined ? 0 : Math.abs(Number(a.move) - answer) - Math.abs(Number(b.move) - answer))).map((g, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px dashed #d8cfb8", padding: "6px 0", fontSize: 15 }}><b>{g.name}</b><span className="display">{g.move}{answer !== undefined ? ` (${Math.abs(Number(g.move) - answer)} off)` : ""}</span></div>
      ))}
    </div>
  );
}

function Result({ room, busy, onNext }: { room: Room; busy: boolean; onNext: () => void }) {
  const r = room.result ?? {};
  const again = room.is_host && (room.game === "arcade" || room.game === "vote");
  return (
    <>
      {room.game === "arcade" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 30 }}>{!r.winner ? "Match drawn!" : r.winner === room.me ? "You win the match! +18" : `${r.winner_name} wins the match`}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {room.players.filter((p) => p.plays).map((p) => (
              <div key={p.user_id} style={{ background: p.user_id === r.winner ? "var(--lime)" : "#fff", border: "3px solid #111", borderRadius: 18, padding: 14, textAlign: "center" }}>
                <div className="display" style={{ fontSize: 28 }}>{r.scores?.[p.user_id] ?? 0}</div><b style={{ fontSize: 13 }}>{p.name}</b>
              </div>
            ))}
          </div>
        </>
      )}
      {room.game === "vote" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{room.title}</h2>
          {(room.options.choices ?? []).map((c) => {
            const n = r.tally?.[c] ?? 0, total = Math.max(1, r.votes ?? 0), top = r.top?.includes(c) && n > 0;
            return (
              <div key={c} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800 }}><span>{c}{top ? " · winner" : ""}</span><span>{n}</span></div>
                <div style={{ height: 16, borderRadius: 99, background: "#e6dcc2", border: "2px solid #111", overflow: "hidden" }}><div style={{ height: "100%", width: `${(n / total) * 100}%`, background: top ? "var(--lime)" : "var(--amber)" }} /></div>
              </div>
            );
          })}
        </>
      )}
      {room.game === "closest" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 26 }}>Answer: {r.answer}</h2>
          <b style={{ fontSize: 15 }}>{(r.winners ?? []).map((w) => w.name).join(" & ") || "Nobody"} {(r.winners?.length ?? 0) > 1 ? "win" : "wins"} +40</b>
          <Guesses list={r.guesses ?? []} answer={r.answer} />
        </>
      )}
      {room.game === "werewolf" && <WolfEnd room={room} />}
      {room.game === "bluff" && <h2 className="display" style={{ margin: 0, fontSize: 28 }}>{(r.champions ?? []).join(" & ") || "Nobody"} {(r.champions?.length ?? 0) > 1 ? "win" : "wins"} the vault</h2>}
      {room.game === "fog" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 28 }}>{!r.winner ? "Draw" : r.winner === room.me ? "You win! +40" : `${r.winner_name} wins`}</h2>
          {(r.liars?.length ?? 0) > 0 && <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#9a2d1d" }}>Caught misreporting hits: {r.liars!.join(", ")}. That player loses.</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{room.players.filter((p) => p.plays).map((p) => <span key={p.user_id} className="chip" style={{ background: "var(--paper)" }}>{p.name}: {r.hits?.[p.user_id] ?? 0} hits</span>)}</div>
        </>
      )}
      {room.game === "capsule" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 26 }}>The capsule is open</h2>
          {(r.messages ?? []).map((m, i) => <div key={i} style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 12 }}><b style={{ fontSize: 13 }}>{m.name}</b><p style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.move}</p></div>)}
          {(r.messages ?? []).length === 0 && <p style={{ margin: 0 }}>No messages were revealed.</p>}
        </>
      )}
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#4a4436" }}>✓ Every move was sealed before the result — nobody could change their answer.</p>
      {again && <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} disabled={busy} onClick={onNext}>{room.game === "arcade" ? "Play new match" : "Vote again"}</button>}
    </>
  );
}

function ArcadeBoard({ room }: { room: Room }) {
  const r = room.result ?? {};
  const last = r.history?.at(-1);
  return (
    <div style={{ background: "#111", color: "var(--paper)", borderRadius: 18, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Score ({r.history?.length ?? 0} of {room.options.rounds ?? 3} rounds)</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {room.players.filter((p) => p.plays).map((p) => (
          <span key={p.user_id} className="chip" style={{ background: p.user_id === room.me ? "var(--lime)" : "var(--paper)" }}>
            {p.name}: {r.scores?.[p.user_id] ?? 0}
          </span>
        ))}
      </div>
      {last && (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Round {last.round}: {last.cards.map((c) => `${c.name} ${c.move}`).join(" vs ") || "no moves"}.{" "}
          <b style={{ color: "var(--lime)" }}>{last.winner_name ? `${last.winner_name} won` : "Draw"}.</b>
        </div>
      )}
    </div>
  );
}

function BluffBoard({ room }: { room: Room }) {
  const r = room.result ?? {};
  const last = r.history?.at(-1);
  const names = Object.fromEntries(room.players.map((p) => [p.user_id, p.name]));
  return (
    <div style={{ background: "#111", color: "var(--paper)", borderRadius: 18, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="eyebrow" style={{ color: "var(--lime)" }}>Chips</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {room.players.filter((p) => p.plays).map((p) => <span key={p.user_id} className="chip" style={{ background: p.user_id === room.me ? "var(--lime)" : "var(--paper)" }}>{names[p.user_id]}: {r.scores?.[p.user_id] ?? 0}</span>)}
      </div>
      {last && <div style={{ fontSize: 13, lineHeight: 1.5 }}>Round {last.round}: {last.cards.map((c) => `${c.name} ${c.move}`).join(" · ") || "no cards"}. <b style={{ color: "var(--lime)" }}>{(last.winners ?? []).join(" & ") || "Nobody"} took it.</b></div>}
    </div>
  );
}

/** 6x6 grid. "place" picks exactly 5 cells for your units; "target" picks 1 to 3 cells to fire at. */
function FogPicker({ room, busy, onSeal }: { room: Room; busy: boolean; onSeal: (move: string) => void }) {
  const placing = room.round === 0;
  const [pick, setPick] = useState<number[]>([]);
  const limit = placing ? 5 : 3;
  const fired = new Set((room.result?.turns ?? []).flatMap((t) => t.targets[room.me] ?? []));
  return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{placing ? "Hide your five units" : "Pick up to three targets"}</h2>
      <Grid cells={(i) => pick.includes(i) ? (placing ? "unit" : "aim") : !placing && fired.has(i) ? "shot" : "empty"} onTap={(i) => setPick(pick.includes(i) ? pick.filter((x) => x !== i) : pick.length < limit ? [...pick, i] : pick)} />
      <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>{placing ? "Your opponent never sees where until the end, when both placements are checked." : "Grey cells are ones you already fired at."}</p>
      <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} disabled={busy || (placing ? pick.length !== 5 : pick.length === 0)} onClick={() => onSeal([...pick].sort((a, b) => a - b).join(","))}>
        <Lock />{placing ? `Seal positions (${pick.length}/5)` : `Seal ${pick.length} shot${pick.length === 1 ? "" : "s"}`}
      </button>
    </>
  );
}

function FogBoard({ room }: { room: Room }) {
  const r = room.result ?? {};
  const mine = r.placements?.[room.me] ?? myPlacement(room) ?? [];
  const turns = r.turns ?? [];
  const takenOnMe = new Set(turns.flatMap((t) => t.hits?.[room.me] ?? []));
  const opp = room.players.find((p) => p.plays && p.user_id !== room.me);
  const myShots = new Set(turns.flatMap((t) => t.targets[room.me] ?? []));
  const myHits = new Set(opp ? turns.flatMap((t) => t.hits?.[opp.user_id] ?? []) : []);
  const theirs = opp ? r.placements?.[opp.user_id] ?? null : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      <div><b style={{ fontSize: 12 }}>Your units ({mine.length - [...takenOnMe].filter((c) => mine.includes(c)).length} left)</b>
        <Grid small cells={(i) => takenOnMe.has(i) && mine.includes(i) ? "hit" : mine.includes(i) ? "unit" : "empty"} /></div>
      <div><b style={{ fontSize: 12 }}>Your shots at {opp?.name ?? "them"} ({myHits.size} hits)</b>
        <Grid small cells={(i) => myHits.has(i) ? "hit" : theirs?.includes(i) ? "unit" : myShots.has(i) ? "shot" : "empty"} /></div>
    </div>
  );
}

const FOG: Record<string, [string, string]> = { empty: ["#1c4a3d", ""], unit: ["var(--mint)", "●"], aim: ["var(--amber)", "+"], shot: ["#5b6878", "·"], hit: ["var(--pink)", "✕"] };
function Grid({ cells, onTap, small = false }: { cells: (i: number) => keyof typeof FOG | string; onTap?: (i: number) => void; small?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: small ? 3 : 5, padding: small ? 6 : 8, borderRadius: 16, background: "#12302a", border: "3px solid #111", marginTop: 4 }}>
      {Array.from({ length: 36 }, (_, i) => {
        const [bg, mark] = FOG[cells(i)] ?? FOG.empty;
        return <button key={i} disabled={!onTap} onClick={() => onTap?.(i)} aria-label={`Cell ${i + 1}: ${cells(i)}`} className="display" style={{ aspectRatio: "1", borderRadius: small ? 5 : 9, border: "2px solid #111", background: bg, color: "#111", fontSize: small ? 11 : 16, padding: 0, minHeight: small ? 0 : 36 }}>{mark}</button>;
      })}
    </div>
  );
}

// ---------- Werewolf ----------
const ROLE_TEXT: Record<MyRole["role"], [string, string, string]> = {
  wolf: ["Werewolf", "var(--pink)", "Each night, pick a villager to attack with your pack. By day, blend in."],
  seer: ["Seer", "var(--lilac)", "Each night, inspect one player to learn if they are a wolf. Use it wisely by day."],
  villager: ["Villager", "var(--mint)", "Sleep at night. By day, find the wolves and vote them out."],
};

function useMyRole(room: Room) {
  const [role, setRole] = useState<MyRole | null>(null);
  useEffect(() => { if (room.status !== "lobby") myRole(room.id).then(setRole).catch(() => {}); }, [room.id, room.status, room.round]);
  return role;
}

function WolfStory({ room }: { room: Room }) {
  const role = useMyRole(room);
  const r = room.result ?? {};
  const alive = new Set(r.alive ?? []);
  const out = room.players.filter((p) => p.state === "joined" && !alive.has(p.user_id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {role && room.status !== "done" && (
        <div style={{ background: "#111", color: "var(--paper)", borderRadius: 18, padding: 12, display: "flex", gap: 12, alignItems: "center", border: `3px solid ${ROLE_TEXT[role.role][1]}` }}>
          <span className="display" style={{ fontSize: 13, background: ROLE_TEXT[role.role][1], color: "#111", borderRadius: 10, padding: "8px 10px" }}>{ROLE_TEXT[role.role][0].toUpperCase()}</span>
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            <b>Only you can see this.</b> {ROLE_TEXT[role.role][2]}
            {role.pack?.length ? <div>Your pack: {role.pack.map((p) => p.name).join(", ")}</div> : null}
            {role.seen.length > 0 && <div>You found: {role.seen.map((s) => `${s.name} is ${s.wolf ? "a WOLF" : "not a wolf"}`).join(" · ")}</div>}
            {!alive.has(room.me) && <div style={{ color: "var(--pink)", fontWeight: 800 }}>You are out. Watch quietly.</div>}
          </div>
        </div>
      )}
      {(r.log?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: 1.45 }}>
          {r.log!.map((e, i) => (
            <div key={i}>{e.phase === "night" ? "🌙" : "☀️"} <b>{e.phase === "night" ? `Night ${e.day}` : `Day ${e.day}`}:</b>{" "}
              {e.out ? `${e.out} ${e.phase === "night" ? "was attacked" : "was voted out"} (${e.role === "wolf" ? "a wolf" : e.role === "seer" ? "the seer" : "a villager"}).` : e.phase === "night" ? "Nobody was attacked." : "No majority. Nobody was voted out."}
              {e.votes && Object.keys(e.votes).length > 0 ? <span style={{ color: "#4a4436" }}> Votes: {Object.entries(e.votes).map(([n, c]) => `${n} ${c}`).join(", ")}</span> : null}
            </div>
          ))}
        </div>
      )}
      {out.length > 0 && room.status !== "done" && <div style={{ fontSize: 12, color: "#4a4436" }}>Out: {out.map((p) => p.name).join(", ")}</div>}
    </div>
  );
}

function WolfPicker({ room, busy, onSeal }: { room: Room; busy: boolean; onSeal: (move: string) => void }) {
  const role = useMyRole(room);
  const night = room.result?.phase === "night";
  const alive = new Set(room.result?.alive ?? []);
  if (!role) return <p style={{ margin: 0 }}>Loading your role…</p>;
  const pack = new Set((role.pack ?? []).map((p) => p.id));
  const choices = room.players.filter((p) => alive.has(p.user_id) && (night
    ? role.role === "wolf" ? p.user_id !== room.me && !pack.has(p.user_id) : role.role === "seer" ? p.user_id !== room.me : false
    : true));
  if (night && role.role === "villager") return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Night falls</h2>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#4a4436", lineHeight: 1.5 }}>Villagers sleep. Everyone seals something at night, so nobody can tell who the wolves are from who is busy.</p>
      <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} disabled={busy} onClick={() => onSeal("sleep")}><Lock />Seal and sleep</button>
    </>
  );
  return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{night ? (role.role === "wolf" ? "Pick tonight’s victim" : "Inspect someone") : "Vote someone out"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {choices.map((p) => (
          <button key={p.user_id} disabled={busy} onClick={() => onSeal(p.user_id)} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: 8, borderRadius: 14, border: "3px solid #111", boxShadow: "0 4px 0 #111", background: night && role.role === "wolf" ? "var(--pink)" : "#fff", color: "#111", textAlign: "left" }}>
            <img src={art(`avatar_${p.avatar}`)} alt="" width={34} height={34} style={{ borderRadius: 10, border: "2px solid #111" }} />
            <b style={{ fontSize: 14 }}>{p.name}{p.user_id === room.me ? " (you)" : ""}</b>
          </button>
        ))}
        {!night && <button disabled={busy} onClick={() => onSeal("skip")} style={{ minHeight: 56, borderRadius: 14, border: "3px dashed #111", background: "transparent", color: "#111", fontWeight: 800 }}>Skip vote</button>}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>{night ? "Sealed until everyone has acted." : "Votes are sealed, so nobody follows the crowd. A tie means nobody goes."}</p>
    </>
  );
}

function WolfEnd({ room }: { room: Room }) {
  const r = room.result ?? {};
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (r.deal && r.salt && r.deal_hash) sha256Hex(`calledit:ww|${r.deal}|${r.salt}`).then((h) => setOk(h === r.deal_hash));
  }, [r.deal, r.salt, r.deal_hash]);
  return (
    <>
      <h2 className="display" style={{ margin: 0, fontSize: 28 }}>{r.team === "village" ? "The village wins!" : "The wolves win!"}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(r.roles ?? []).map((x) => <span key={x.name + x.role} className="chip" style={{ background: x.role === "wolf" ? "var(--pink)" : x.role === "seer" ? "var(--lilac)" : "var(--mint)" }}>{x.name}: {x.role}</span>)}
      </div>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: ok ? "#3d6b00" : ok === false ? "#9a2d1d" : "#4a4436" }}>
        {ok === null ? "Checking the role deal…" : ok ? "✓ The roles match the seal from the start — nobody’s role was changed." : "✗ The roles don’t match the original seal."}
      </p>
    </>
  );
}

/** Time left for the current step. Long waits (time capsules) show the date instead. */
function Countdown({ until }: { until: string }) {
  const left = Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000));
  if (left > 3 * 3600) return <span className="chip" style={{ background: "var(--sky)" }}>UNTIL {fmt(until).toUpperCase()}</span>;
  const m = Math.floor(left / 60), s = left % 60;
  return <span className="chip" style={{ background: left < 60 ? "var(--pink)" : "var(--paper)" }} aria-label={`${m} minutes ${s} seconds left`}>⏱ {left === 0 ? "TIME UP" : `${m}:${String(s).padStart(2, "0")}`}</span>;
}
