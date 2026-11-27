"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cloudRpc, useVisibleTick, type Contest } from "@/lib/cloud";
import { contestGame } from "@/lib/data";
import { joinRoom } from "@/lib/rooms";
import { Img } from "./ui";

type OpenRoom = { code: string; host_name: string; players: number; created_at: string };

/** For game contests: start a game room or join one another entrant opened. */
export function ContestPlay({ c, joined, now }: { c: Contest; joined: boolean; now: number | null }) {
  const router = useRouter();
  const g = contestGame(c.game);
  const tick = useVisibleTick(15_000);
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const live = c.status === "open" && !!c.ends_at && !!now && Date.parse(c.ends_at) > now && !(c.opens_at && Date.parse(c.opens_at) > now);
  useEffect(() => {
    if (!joined || !live) return;
    let on = true;
    cloudRpc<OpenRoom[]>("contest_rooms", { p_contest: c.id }).then((r) => on && setRooms(r)).catch(() => on && setRooms([]));
    return () => { on = false; };
  }, [c.id, joined, live, tick]);

  async function start() {
    setBusy(true); setMsg("");
    try { const r = await cloudRpc<{ id: string }>("create_contest_room", { p_contest: c.id }); router.push(`/room?id=${r.id}`); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not start a game."); setBusy(false); }
  }
  async function join(code: string) {
    setMsg("");
    try { router.push(`/room?id=${await joinRoom(code)}`); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not join."); }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Img n={g.img} size={48} style={{ borderRadius: 12, border: "2px solid #111" }} />
        <div><h2 className="display" style={{ margin: 0, fontSize: 22 }}>{g.name}</h2><span style={{ fontSize: 13, color: "var(--muted)" }}>{g.blurb}</span></div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Every win against another player in this contest counts{c.ends_at ? ` until ${new Date(c.ends_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}. Your 2 best games against the same opponents count, so play lots of different people.
      </p>
      {!live && <div style={{ fontSize: 14, fontWeight: 700 }}>{c.status === "closed" || (c.ends_at && now && Date.parse(c.ends_at) <= now) ? "This contest has finished." : "Games open when the contest starts."}</div>}
      {live && !joined && <div style={{ fontSize: 14, fontWeight: 700 }}>Join the contest to play.</div>}
      {live && joined && (
        <>
          <button className="btn" disabled={busy} onClick={start} style={{ background: "var(--lime)", color: "#111", border: "3px solid #111" }}>{busy ? "Opening…" : `Start a ${g.name} game`}</button>
          <span className="eyebrow" style={{ color: "var(--muted)" }}>Games waiting for players</span>
          {rooms === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>}
          {rooms?.length === 0 && <span style={{ fontSize: 13, color: "var(--muted)" }}>None right now. Start one and share the contest link so others can join.</span>}
          {rooms?.map((r) => (
            <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--paper)", color: "#111", borderRadius: 14, padding: "10px 12px" }}>
              <div style={{ flex: 1 }}><b>{r.host_name}&apos;s game</b><div style={{ fontSize: 12, color: "#4a4436" }}>{r.players} player{r.players === 1 ? "" : "s"} waiting · code {r.code}</div></div>
              <button className="btn" onClick={() => join(r.code)} style={{ width: "auto", minHeight: 40, padding: "0 16px", background: "#111", color: "var(--lime)", border: 0 }}>Join</button>
            </div>
          ))}
        </>
      )}
      {msg && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{msg}</div>}
    </section>
  );
}
