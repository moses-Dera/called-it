"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chips } from "@/components/chips";
import { PlayerSearch } from "@/components/player-search";
import { BottomNav, Img } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { MODES, art } from "@/lib/data";
import { cloudReady, useCloud } from "@/lib/cloud";
import { GAME_INFO, answerInvite, createRoom, joinRoom, listPlayers, useMyRooms, type Game, type RoomSummary } from "@/lib/rooms";

const GAMES = Object.keys(GAME_INFO) as Game[];
const STATUS: Record<RoomSummary["status"], [string, string]> = {
  lobby: ["WAITING TO START", "var(--sky)"], sealing: ["SEALING", "var(--amber)"], revealing: ["REVEALING", "var(--pink)"], report: ["COUNTING HITS", "var(--pink)"],
  answer: ["AWAITING ANSWER", "var(--amber)"], done: ["FINISHED", "var(--lime)"],
};
const field: React.CSSProperties = { height: 46, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 15, fontWeight: 600, minWidth: 0, width: "100%" };

export default function Rooms() {
  const router = useRouter();
  const signedIn = !!useCloud().session;
  const { rooms, reload } = useMyRooms();
  const [msg, setMsg] = useState(""), [code, setCode] = useState("");
  const [game, setGame] = useState<Game>("arcade");

  // Deep links: /rooms?game=vote preselects a game, /rooms?join=CODE joins straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const g = q.get("game") as Game | null;
    if (g && g in GAME_INFO) setGame(g);
    const j = q.get("join");
    if (j) setCode(j.toUpperCase());
  }, []);
  useEffect(() => {
    const j = new URLSearchParams(location.search).get("join");
    if (j && signedIn) joinRoom(j).then((id) => router.push(`/room?id=${id}`), (e) => setMsg(e.message));
  }, [signedIn, router]);

  const invites = rooms?.filter((r) => r.my_state === "invited") ?? [];
  const mine = rooms?.filter((r) => r.my_state === "joined") ?? [];

  async function join() {
    if (!code.trim()) return;
    try { router.push(`/room?id=${await joinRoom(code)}`); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not join"); }
  }

  return (
    <main className="screen wide hub hub-pad">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="eyebrow" style={{ color: "var(--lime)" }}>Real players</span>
        <h1 className="display page-h1" style={{ margin: 0, fontSize: 34 }}>Play with friends</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#c9d3de", lineHeight: 1.5, maxWidth: 640 }}>Pick your opponents, everyone seals a move, then all moves open together. No player can peek or change their mind, not even the host.</p>
        <div style={{ maxWidth: 520, marginTop: 6 }}><PlayerSearch /></div>
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: "var(--pink)" }}>{msg}</div>}

      {!cloudReady ? <p style={{ color: "var(--muted)", margin: 0 }}>Accounts are not configured on this deployment.</p> : !signedIn ? (
        <section className="paper" style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, maxWidth: 560 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>Sign in to invite friends and get invited.</span><SignInPill />
        </section>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {invites.length > 0 && (
              <section style={{ background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", borderRadius: 24, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="eyebrow">Invites for you</span>
                {invites.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--paper)", border: "2px solid #111", borderRadius: 16, padding: 10 }}>
                    <Img n={GAME_INFO[r.game].img} size={40} style={{ borderRadius: 12, border: "2px solid #111" }} />
                    <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 14 }}>{r.host_name} invited you</b><div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{GAME_INFO[r.game].name}{r.title ? ` · ${r.title}` : ""}</div></div>
                    <button className="btn" style={{ minHeight: 40, background: "#111", color: "var(--lime)", border: 0 }} onClick={async () => { try { await answerInvite(r.id, true); router.push(`/room?id=${r.id}`); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } }}>Join</button>
                    <button aria-label="Decline invite" className="btn" style={{ minHeight: 40, background: "transparent", border: "2px solid #111" }} onClick={() => answerInvite(r.id, false).then(reload)}>✕</button>
                  </div>
                ))}
              </section>
            )}

            <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 24, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="eyebrow" style={{ color: "var(--lime)" }}>Join with a code</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input aria-label="Room code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 4F7A2C" maxLength={6} className="mono" style={{ ...field, border: "2px solid var(--line)", background: "#0b0f14", color: "var(--text)", letterSpacing: 3 }} />
                <button className="btn btn-paper" style={{ minHeight: 46 }} onClick={join}>Join</button>
              </div>
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Your games</h2>
              {rooms === null && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
              {rooms && mine.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No games yet. Start a game from the New game card.</div>}
              {mine.map((r) => (
                <Link key={r.id} href={`/room?id=${r.id}`} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--paper)", color: "#111", borderRadius: 16, padding: "10px 12px" }}>
                  <Img n={GAME_INFO[r.game].img} size={42} style={{ borderRadius: 12, border: "2px solid #111" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 16 }}>{r.title || GAME_INFO[r.game].name}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{r.is_host ? "You host" : `Host: ${r.host_name}`} · {r.players} player{r.players === 1 ? "" : "s"} · <span className="mono">{r.code}</span></div>
                  </div>
                  <span className="chip" style={{ background: STATUS[r.status][1] }}>{STATUS[r.status][0]}</span>
                </Link>
              ))}
            </section>
          </div>

          <NewRoom game={game} setGame={setGame} onError={setMsg} onCreated={(id) => router.push(`/room?id=${id}`)} />
        </div>
      )}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 16 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Practice vs bots</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Learn a game on your own first. Practice games don&apos;t count for points or contests.</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 10 }}>
          {MODES.filter((m) => m.key !== "classic").map((m) => (
            <Link key={m.key} href={m.href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--text)" }}>
              <Img n={m.img} size={64} style={{ borderRadius: 16, border: "2px solid #111" }} />
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>{m.name}</span>
            </Link>
          ))}
        </div>
      </section>
      <BottomNav active="/rooms" />
    </main>
  );
}

function NewRoom({ game, setGame, onError, onCreated }: { game: Game; setGame: (g: Game) => void; onError: (m: string) => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(""), [choices, setChoices] = useState(["", ""]), [opens, setOpens] = useState("");
  const [search, setSearch] = useState(""), [people, setPeople] = useState<{ id: string; name: string; avatar: number }[]>([]);
  const [pick, setPick] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState(10), [rounds, setRounds] = useState(5), [turns, setTurns] = useState(6);
  const max = GAME_INFO[game].max - 1;

  useEffect(() => {
    const t = setTimeout(() => { listPlayers(search).then(setPeople).catch(() => setPeople([])); }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPick((p) => p.slice(0, max)); }, [max]);

  async function create() {
    setBusy(true);
    try {
      const base = game === "vote" ? { choices: choices.map((c) => c.trim()).filter(Boolean) } : game === "capsule" ? { opens: opens ? new Date(opens).toISOString() : undefined } : {};
      const options = { ...base, ...(game !== "capsule" ? { timer } : {}), ...(game === "bluff" ? { rounds } : {}), ...(game === "fog" ? { turns } : {}) };
      const r = await createRoom(game, title, options, pick);
      onCreated(r.id);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not create the game"); setBusy(false); }
  }

  return (
    <section className="paper" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, boxShadow: "6px 6px 0 var(--lime)" }}>
      <span className="eyebrow" style={{ color: "#5b6b12" }}>New game</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {GAMES.map((g) => (
          <button key={g} aria-pressed={game === g} onClick={() => setGame(g)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 8, borderRadius: 16, border: `3px solid ${game === g ? "#111" : "transparent"}`, background: game === g ? "var(--lime)" : "transparent", color: "#111" }}>
            <Img n={GAME_INFO[g].img} size={52} style={{ borderRadius: 14, border: "2px solid #111" }} />
            <span style={{ fontSize: 11, fontWeight: 800, textAlign: "center", lineHeight: 1.15 }}>{GAME_INFO[g].name}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#4a4436" }}>{GAME_INFO[game].blurb}</div>

      {(game === "vote" || game === "closest") && <input aria-label="Question" placeholder={game === "vote" ? "Who gets married first?" : "Minute of the first goal?"} value={title} onChange={(e) => setTitle(e.target.value)} style={field} />}
      {game === "capsule" && <input aria-label="Capsule name" placeholder="Class of 2026 reunion" value={title} onChange={(e) => setTitle(e.target.value)} style={field} />}
      {game === "arcade" && <input aria-label="Game name (optional)" placeholder="Name it (optional)" value={title} onChange={(e) => setTitle(e.target.value)} style={field} />}
      {game === "vote" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {choices.map((c, i) => <input key={i} aria-label={`Choice ${i + 1}`} placeholder={`Choice ${i + 1}`} value={c} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? e.target.value : x)))} style={field} />)}
          {choices.length < 6 && <button onClick={() => setChoices([...choices, ""])} style={{ alignSelf: "flex-start", background: "none", border: 0, fontWeight: 800, textDecoration: "underline", color: "#111", minHeight: 36 }}>+ Add a choice</button>}
        </div>
      )}
      {game === "capsule" && <label style={{ fontSize: 12, fontWeight: 800 }}>Opens on<input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} style={{ ...field, marginTop: 4 }} /></label>}

      {game !== "capsule" && (
        <div style={{ display: "grid", gridTemplateColumns: game === "bluff" || game === "fog" ? "1fr 1fr" : "1fr", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800 }}>Time per move<Chips label="Time per move" value={timer} onChange={setTimer} options={[[2, "2 min"], [5, "5 min"], [10, "10 min"], [30, "30 min"], [60, "1 hour"]]} light /></div>
          {game === "bluff" && <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800 }}>Rounds<Chips label="Rounds" value={rounds} onChange={setRounds} options={[[3, "3 rounds"], [5, "5 rounds"], [7, "7 rounds"]]} light /></div>}
          {game === "fog" && <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800 }}>Turns<Chips label="Turns" value={turns} onChange={setTurns} options={[[4, "4 turns"], [6, "6 turns"], [8, "8 turns"]]} light /></div>}
        </div>
      )}
      <span style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>Whoever doesn’t act before the timer runs out loses that round, so a game never gets stuck. Wins with friends count up to 100 ranked points a day.</span>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 13 }}>{game === "arcade" ? "Choose your opponent" : `Invite players (up to ${max})`}{pick.length ? ` · ${pick.length} picked` : ""}</b>
        <input aria-label="Search players" placeholder="Search players by name" value={search} onChange={(e) => setSearch(e.target.value)} style={field} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {people.length === 0 && <span style={{ fontSize: 12, color: "#4a4436" }}>No players found. You can also share the room code after creating it.</span>}
          {people.map((p) => {
            const on = pick.includes(p.id);
            return (
              <button key={p.id} aria-pressed={on} onClick={() => setPick(on ? pick.filter((x) => x !== p.id) : max === 1 ? [p.id] : pick.length < max ? [...pick, p.id] : pick)} style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 12, border: "2px solid #111", background: on ? "var(--lime)" : "#fff", color: "#111", textAlign: "left", minHeight: 44 }}>
                <img src={art(`avatar_${p.avatar}`)} alt="" width={30} height={30} style={{ borderRadius: 9, border: "2px solid #111" }} />
                <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={create} style={{ boxShadow: "0 6px 0 #111" }}>{busy ? "Creating…" : "Create game and send invites"}</button>
    </section>
  );
}
