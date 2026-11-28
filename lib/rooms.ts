"use client";
// Real multiplayer rooms. The server only ever receives seals (hashes); each device keeps its move and
// salt until the reveal, exactly like solo seals. Rooms update live through Supabase Realtime on the
// `rooms` row, with a slow poll as a fallback.
import { useCallback, useEffect, useState } from "react";
import { cloudRpc, sb, useCloud } from "./cloud";
import { createSeal, getState, markRevealed } from "./store";

export type Game = "arcade" | "vote" | "closest" | "capsule" | "bluff" | "fog" | "werewolf";
export const GAME_INFO: Record<Game, { name: string; img: string; blurb: string; min: number; max: number; capLabel: string }> = {
  arcade: { name: "Rock Paper Scissors", img: "cover_arcade", blurb: "1 vs 1. Both moves sealed, then opened together.", min: 2, max: 2, capLabel: "2 players (1v1)" },
  vote: { name: "Secret Vote", img: "cover_vote", blurb: "Ask the group. Every vote sealed until all are in.", min: 2, max: 8, capLabel: "2 to 8 players" },
  closest: { name: "Closest Wins", img: "cover_closest", blurb: "Players guess a number; host referees and enters the real answer.", min: 2, max: 8, capLabel: "Host + 2 to 7 players" },
  capsule: { name: "Time Capsule", img: "cover_capsule", blurb: "Seal messages together. They open on a date you pick.", min: 1, max: 8, capLabel: "1 to 8 players" },
  bluff: { name: "Bluff Vault", img: "cover_bluff", blurb: "2 to 6 players. Same seven cards each, one sealed per round.", min: 2, max: 6, capLabel: "2 to 6 players" },
  fog: { name: "Fog of War", img: "cover_fog", blurb: "1 vs 1. Hide five units on a 6x6 grid, then fire sealed shots.", min: 2, max: 2, capLabel: "2 players (1v1)" },
  werewolf: { name: "Werewolf", img: "cover_werewolf", blurb: "5 to 8 players. Secret roles from a sealed deal; nights and day votes.", min: 5, max: 8, capLabel: "5 to 8 players" },
};

export const ROOM_RULES: Record<Game, { steps: string[]; scoring: string }> = {
  arcade: {
    steps: [
      "Exactly 2 players join (1 vs 1).",
      "Both pick Rock, Paper, or Scissors. Your move is sealed until both lock in.",
      "Moves open automatically. Rock beats Scissors, Scissors beats Paper, Paper beats Rock.",
    ],
    scoring: "Win a round +18 ranked points (up to 100 pts/day from friend games). Anyone who fails to seal or reveal before the move timer forfeits.",
  },
  vote: {
    steps: [
      "2 to 8 players join and the host sets the question and choices.",
      "Everyone seals a vote privately before anyone can see the crowd.",
      "Once everyone locks in (or the timer ends), all votes reveal together.",
    ],
    scoring: "Just for fun — no points awarded. Most votes wins (ties show multiple winners).",
  },
  closest: {
    steps: [
      "Host acts as referee (doesn't guess) + 2 to 7 players guess a number.",
      "All guesses stay sealed until every player locks in.",
      "Once guesses open, the host enters the real answer to settle the round.",
    ],
    scoring: "Closest absolute guess wins +40 ranked points (ties share the win). Guesses from players who miss the timer forfeit.",
  },
  capsule: {
    steps: [
      "1 to 8 players write and seal a private message (up to 600 chars).",
      "Text stays on your device until the chosen opening date & time; only the seal hash goes to the server.",
      "On opening day, devices reveal their messages together.",
    ],
    scoring: "Memories only — no ranked points. Keep the device/browser you sealed on until opening day.",
  },
  bluff: {
    steps: [
      "2 to 6 players each get the same 7 cards: 2, 4, 6, 8, 10, Steal, and Shield (each card works once).",
      "Play 3, 5, or 7 rounds (set by host). Seal one card per round.",
      "Shield beats Steal; Steal beats any number card; otherwise the highest number takes the 10-chip pot (ties split).",
    ],
    scoring: "Most chips after the final round wins +30 ranked points (up to 100 pts/day). Miss the timer and you sit out that round.",
  },
  fog: {
    steps: [
      "Exactly 2 players (1 vs 1) on 6x6 grids.",
      "First hide 5 units secretly, then alternate turns firing 1 to 3 sealed shots (4, 6, or 8 turns total).",
      "After each volley, devices automatically report hits; final placements verify every report.",
    ],
    scoring: "Most hits wins +40 ranked points. Misreporting hits or missing the placement/report timer forfeits the match.",
  },
  werewolf: {
    steps: [
      "5 to 8 players: 5–6 players get 1 Werewolf + 1 Seer + Villagers; 7–8 players get 2 Werewolves + 1 Seer + Villagers.",
      "Night: Wolves pick a victim, Seer inspects someone, Villagers tap Sleep (everyone seals so nobody spots who is acting).",
      "Day: Everyone discusses and votes out one suspect (a tie or all skips means nobody leaves).",
    ],
    scoring: "Village wins (+35 pts) when all wolves are out. Wolves win (+35 pts) when they equal or outnumber the rest. Role deal hash is verifiable at the end.",
  },
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
  const seal = getState().seals.find((s) => s.round === roundKey(room.id, room.round) && !!s.move);
  if (!seal) return false;
  await cloudRpc("reveal_move", { p_room: room.id, p_player: seal.player ?? getState().player, p_move: seal.move, p_salt: seal.salt });
  markRevealed(seal.id);
  return true;
}
/** Fog of War: this device's sealed unit positions (round 0), if it holds them. */
export function myPlacement(room: Room): number[] | null {
  const seal = getState().seals.find((s) => s.round === roundKey(room.id, 0) && !!s.move);
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
export const hasLocalSeal = (room: Room) => getState().seals.some((s) => s.round === roundKey(room.id, room.round) && !!s.move);

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
