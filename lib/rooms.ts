"use client";
// Real multiplayer rooms. The server only ever receives seals (hashes); each device keeps its move and
// salt until the reveal, exactly like solo seals. Rooms update live through Supabase Realtime on the
// `rooms` row, with a slow poll as a fallback.
import { useCallback, useEffect, useState } from "react";
import { cloudRpc, sb, useCloud } from "./cloud";
import { createSeal, getState, markRevealed } from "./store";

export type Game = "arcade" | "vote" | "closest" | "capsule" | "bluff" | "fog" | "werewolf";
export const GAME_INFO: Record<Game, { name: string; img: string; blurb: string; min: number; max: number }> = {
  arcade: { name: "Rock Paper Scissors", img: "cover_arcade", blurb: "1 vs 1. Both moves sealed, then opened together.", min: 2, max: 2 },
  vote: { name: "Secret Vote", img: "cover_vote", blurb: "Ask the group. Every vote sealed until all are in.", min: 2, max: 8 },
  closest: { name: "Closest Wins", img: "cover_closest", blurb: "Everyone guesses a number. You referee and enter the answer.", min: 2, max: 8 },
  capsule: { name: "Time Capsule", img: "cover_capsule", blurb: "Seal messages together. They open on a date you pick.", min: 1, max: 8 },
  bluff: { name: "Bluff Vault", img: "cover_bluff", blurb: "2 to 6 players, 5 rounds. Same seven cards each, one sealed per round.", min: 2, max: 6 },
  fog: { name: "Fog of War", img: "cover_fog", blurb: "1 vs 1. Hide five units, then fire sealed shots for six turns.", min: 2, max: 2 },
  werewolf: { name: "Werewolf", img: "cover_werewolf", blurb: "5 to 8 players. Secret roles from a sealed deal; nights and day votes.", min: 5, max: 8 },
};
export const BLUFF_CARDS = ["2", "4", "6", "8", "10", "Steal", "Shield"];

export type Player = { user_id: string; name: string; avatar: number; state: "invited" | "joined"; plays: boolean; sealed: boolean; revealed: boolean; reported?: boolean; move: string | null };
export type Room = {
  id: string; code: string; game: Game; title: string; options: { choices?: string[]; opens?: string; min?: number; max?: number; rounds?: number; turns?: number; timer?: number };
  status: "lobby" | "sealing" | "revealing" | "report" | "answer" | "done"; round: number; answer: number | null; reveal_by: string | null; updated_at: string;
  result: { moves?: { user_id: string; name: string; move: string }[]; winner?: string | null; winner_name?: string | null; tally?: Record<string, number>; top?: string[]; votes?: number;
    guesses?: { user_id: string; name: string; move: string }[]; answer?: number; winners?: { user_id: string; name: string; move: string }[]; messages?: { user_id: string; name: string; move: string }[];
    scores?: Record<string, number>; history?: { round: number; cards: { user_id: string; name: string; move: string }[]; winners: string[] }[]; champions?: string[]; final?: boolean;
    turns?: { round: number; targets: Record<string, number[]>; hits?: Record<string, number[]> }[]; hits?: Record<string, number>; placements?: Record<string, number[] | null>; liars?: string[];
    phase?: "night" | "day"; day?: number; alive?: string[]; log?: { day: number; phase: "night" | "day"; out: string | null; role: string | null; votes?: Record<string, number> }[];
    team?: "village" | "wolves"; roles?: { name: string; role: string }[]; deal?: string; salt?: string; deal_hash?: string } | null;
  host: string; host_name: string; me: string; is_host: boolean; players: Player[];
};
export type RoomSummary = { id: string; code: string; game: Game; title: string; status: Room["status"]; updated_at: string; my_state: "invited" | "joined"; is_host: boolean; host_name: string; players: number };

export const roundKey = (roomId: string, round: number) => `room:${roomId}:${round}`;

export const listPlayers = (search: string) => cloudRpc<{ id: string; name: string; avatar: number }[]>("list_players", { p_search: search });
export const createRoom = (game: Game, title: string, options: Room["options"], invite: string[]) =>
  cloudRpc<{ id: string; code: string }>("create_room", { p_game: game, p_title: title, p_options: options, p_invite: invite });
export const joinRoom = (code: string) => cloudRpc<string>("join_room", { p_code: code });
export const answerInvite = (room: string, accept: boolean) => cloudRpc("answer_invite", { p_room: room, p_accept: accept });
export const startRoom = (room: string) => cloudRpc("start_room", { p_room: room });
export const forceSettle = (room: string) => cloudRpc("force_settle", { p_room: room });
export const setAnswer = (room: string, answer: number) => cloudRpc("set_room_answer", { p_room: room, p_answer: answer });
export const nextRound = (room: string) => cloudRpc("next_round", { p_room: room });

/** Seal a move on this device (it is also batched and anchored on Zcash), then send only its hash. */
export async function sealMove(room: Room, move: string) {
  const label = `${GAME_INFO[room.game].name} · room ${room.code}${room.round > 1 ? ` · round ${room.round}` : ""}`;
  const seal = await createSeal(`room-${room.game}`, roundKey(room.id, room.round), move, label);
  await cloudRpc("seal_move", { p_room: room.id, p_commitment: seal.commitment });
}

/** Reveal this device's move for the current round, if it holds one. Returns false when it cannot. */
export async function revealMine(room: Room): Promise<boolean> {
  const seal = getState().seals.find((s) => s.round === roundKey(room.id, room.round) && !s.remote && s.move);
  if (!seal) return false;
  await cloudRpc("reveal_move", { p_room: room.id, p_player: getState().player, p_move: seal.move, p_salt: seal.salt });
  markRevealed(seal.id);
  return true;
}
/** Fog of War: this device's sealed unit positions (round 0), if it holds them. */
export function myPlacement(room: Room): number[] | null {
  const seal = getState().seals.find((s) => s.round === roundKey(room.id, 0) && !s.remote && s.move);
  return seal ? seal.move.split(",").map(Number) : null;
}
/** Fog of War: report the hits my units took this turn (the server re-checks them against my placement at the end). */
export async function reportHits(room: Room) {
  const mine = myPlacement(room);
  if (!mine) throw new Error("Your unit positions are on another device. Open this game there.");
  const turn = room.result?.turns?.at(-1);
  const theirs = Object.entries(turn?.targets ?? {}).find(([uid]) => uid !== room.me)?.[1] ?? [];
  await cloudRpc("report_hits", { p_room: room.id, p_hits: theirs.filter((c) => mine.includes(c)) });
}
/** Keep my rooms moving from any page: reveal or report what this device holds, and settle steps whose
 * deadline has passed (whoever didn't act loses that round). Called every 30 s while signed in. */
let working = false;
export async function tendRooms() {
  if (working) return;
  working = true;
  try {
    for (const id of await cloudRpc<string[]>("my_open_rooms")) {
      try {
        const room = await cloudRpc<Room>("room_state", { p_room: id });
        const me = room.players.find((p) => p.user_id === room.me);
        const late = room.reveal_by !== null && Date.parse(room.reveal_by) < Date.now();
        const opened = room.game !== "capsule" || !room.options.opens || Date.parse(room.options.opens) <= Date.now();
        if (room.status === "revealing" && me?.sealed && !me.revealed && opened && hasLocalSeal(room)) await revealMine(room);
        else if (room.status === "report" && me?.plays && !me.reported && myPlacement(room)) await reportHits(room);
        else if (late) await forceSettle(room.id);
      } catch { /* try again next time */ }
    }
  } catch { /* not signed in or offline */ }
  finally { working = false; }
}

export type MyRole = { role: "wolf" | "seer" | "villager"; seen: { name: string; wolf: boolean; night: number }[]; pack: { id: string; name: string }[] | null };
export const myRole = (room: string) => cloudRpc<MyRole | null>("my_role", { p_room: room });
export const hasLocalSeal = (room: Room) => getState().seals.some((s) => s.round === roundKey(room.id, room.round) && !s.remote && !!s.move);

/** Live room state: refetch on every change to the room row, plus a 15 s poll in case realtime drops. */
export function useRoom(id: string | null) {
  const [room, setRoom] = useState<Room | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!id) return;
    try { setRoom(await cloudRpc<Room>("room_state", { p_room: id })); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the room"); }
  }, [id]);
  const signedIn = !!useCloud().session;
  useEffect(() => {
    const c = sb();
    if (!id || !c || !signedIn) return;
    load();
    const channel = c.channel(`room-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${id}` }, () => load())
      .subscribe();
    const poll = setInterval(load, 15_000);
    return () => { clearInterval(poll); c.removeChannel(channel); };
  }, [id, load, signedIn]);
  return { room, error, reload: load };
}

export function useMyRooms() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const signedIn = !!useCloud().session;
  const load = useCallback(async () => { try { setRooms(await cloudRpc<RoomSummary[]>("my_rooms")); } catch { setRooms([]); } }, []);
  useEffect(() => {
    if (!signedIn) return;
    load();
    const poll = setInterval(load, 20_000);
    return () => clearInterval(poll);
  }, [load, signedIn]);
  return { rooms, reload: load };
}
