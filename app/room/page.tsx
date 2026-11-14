"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BottomNav, Img, Lock } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { art } from "@/lib/data";
import { useCloud } from "@/lib/cloud";
import { GAME_INFO, forceSettle, hasLocalSeal, nextRound, revealMine, sealMove, setAnswer, startRoom, useRoom, type Room } from "@/lib/rooms";

const STEP: Record<Room["status"], string> = { lobby: "Waiting to start", sealing: "Seal your move", revealing: "Opening the seals", answer: "Waiting for the answer", done: "Result" };
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function RoomPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(new URLSearchParams(location.search).get("id")); }, []);
  const signedIn = !!useCloud().session;
  const { room, error, reload } = useRoom(id);
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);

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

  if (!signedIn) return <Shell><section className="paper" style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, maxWidth: 560 }}><span style={{ flex: 1, fontWeight: 700 }}>Sign in to play this game.</span><SignInPill /></section></Shell>;
  if (error) return <Shell><p style={{ color: "var(--pink)", fontWeight: 700 }}>{error}</p><Link href="/rooms" style={{ color: "var(--lime)", fontWeight: 800 }}>Back to your games</Link></Shell>;
  if (!room) return <Shell><p style={{ color: "var(--muted)" }}>Loading the room…</p></Shell>;

  const info = GAME_INFO[room.game];
  const plays = room.players.filter((p) => p.plays && p.state === "joined");
  const sealed = plays.filter((p) => p.sealed).length, revealed = plays.filter((p) => p.revealed).length;
  const invite = typeof location !== "undefined" ? `${location.origin}/rooms?join=${room.code}` : "";

  return (
    <Shell>
      <div className="room-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: 18, alignItems: "start" }}>
        <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 24, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Img n={info.img} size={56} style={{ borderRadius: 16, border: "2px solid #111" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="eyebrow" style={{ color: "var(--lime)" }}>{info.name}{room.round > 1 ? ` · round ${room.round}` : ""}</span>
              <h1 className="display" style={{ margin: 0, fontSize: 26 }}>{room.title || info.name}</h1>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="chip" style={{ background: "var(--amber)" }}>{STEP[room.status].toUpperCase()}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Host: {room.is_host ? "you" : room.host_name}</span>
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

          {room.status === "sealing" && (me?.plays ? (me.sealed
            ? <Waiting text={`Your move is sealed. Waiting for ${plays.length - sealed} more.`} />
            : <MovePicker room={room} busy={busy} onSeal={(move) => run(() => sealMove(room, move))} />)
            : <Waiting text={`You’re the referee. ${sealed} of ${plays.length} sealed.`} />)}

          {room.status === "revealing" && (
            <>
              <Waiting text={room.game === "capsule" && room.options.opens && Date.parse(room.options.opens) > Date.now()
                ? `Everyone has sealed. The capsule opens ${fmt(room.options.opens)}.`
                : `All moves are sealed. Opening them: ${revealed} of ${plays.length} revealed.`} />
              {me?.sealed && !me.revealed && !hasLocalSeal(room) && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#9a2d1d" }}>You sealed this move on another device. Open this room there to reveal it.</p>}
              {room.is_host && room.reveal_by && Date.parse(room.reveal_by) < Date.now() && room.game !== "capsule" && (
                <button className="btn btn-paper" disabled={busy} onClick={() => run(() => forceSettle(room.id))}>Close the round (players who didn’t reveal forfeit)</button>
              )}
              {room.reveal_by && <span style={{ fontSize: 12, color: "#4a4436" }}>Players who don’t reveal by {fmt(room.reveal_by)} forfeit.</span>}
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
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      <Link href="/rooms" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>← Your games</Link>
      <div style={{ padding: "12px 0 28px" }}>{children}</div>
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
          <h2 className="display" style={{ margin: 0, fontSize: 30 }}>{!r.winner ? "Draw!" : r.winner === room.me ? "You win! +18" : `${r.winner_name} wins`}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {room.players.filter((p) => p.plays).map((p) => (
              <div key={p.user_id} style={{ background: p.user_id === r.winner ? "var(--lime)" : "#fff", border: "3px solid #111", borderRadius: 18, padding: 14, textAlign: "center" }}>
                <div className="display" style={{ fontSize: 24 }}>{p.move ?? "No reveal"}</div><b style={{ fontSize: 13 }}>{p.name}</b>
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
      {room.game === "capsule" && (
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 26 }}>The capsule is open</h2>
          {(r.messages ?? []).map((m, i) => <div key={i} style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 12 }}><b style={{ fontSize: 13 }}>{m.name}</b><p style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.move}</p></div>)}
          {(r.messages ?? []).length === 0 && <p style={{ margin: 0 }}>No messages were revealed.</p>}
        </>
      )}
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#4a4436" }}>✓ Every move was checked against its seal by the server before this result was shown.</p>
      {again && <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} disabled={busy} onClick={onNext}>{room.game === "arcade" ? "Play another round" : "Vote again"}</button>}
    </>
  );
}
