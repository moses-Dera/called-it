export const art = (n: string) => `/a/${n}.webp`;
/** Fallback fixtures (used before the database answers, or without accounts). The live list comes
 * from the `fixtures` table, which admins manage at /admin. */
export type Fixture = { id: string; home: string; away: string; kickoff: string; when: string; homeGoals?: number | null; awayGoals?: number | null; status?: string | null; liveHome?: number | null; liveAway?: number | null; league?: string | null };

// Tip markets a tipster can seal. A pick is "<market>:<selection>"; a Classic Call pick is a score like "2-1".
export const MARKETS = [
  { key: "1x2", name: "Match result", options: [{ key: "home", label: "Home win" }, { key: "draw", label: "Draw" }, { key: "away", label: "Away win" }] },
  { key: "ou25", name: "Total goals", options: [{ key: "over", label: "Over 2.5" }, { key: "under", label: "Under 2.5" }] },
  { key: "btts", name: "Both teams score", options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] },
] as const;

/** Did this pick come true for the final score? null when the pick is not a known format. */
export function settlePick(pick: string, homeGoals: number, awayGoals: number): { won: boolean; exact: boolean } | null {
  const score = /^(\d{1,2})-(\d{1,2})$/.exec(pick);
  if (score) {
    const h = Number(score[1]), a = Number(score[2]);
    return { won: Math.sign(h - a) === Math.sign(homeGoals - awayGoals), exact: h === homeGoals && a === awayGoals };
  }
  const [market, sel] = pick.split(":");
  const diff = Math.sign(homeGoals - awayGoals), total = homeGoals + awayGoals, both = homeGoals > 0 && awayGoals > 0;
  const won =
    market === "1x2" ? (sel === "home" ? diff === 1 : sel === "draw" ? diff === 0 : sel === "away" ? diff === -1 : null) :
    market === "ou25" ? (sel === "over" ? total > 2.5 : sel === "under" ? total < 2.5 : null) :
    market === "btts" ? (sel === "yes" ? both : sel === "no" ? !both : null) : null;
  return won === null || won === undefined ? null : { won, exact: false };
}

/** Human wording for a pick, with team names for match-result tips. */
export function describePick(pick: string, home: string, away: string): string {
  if (/^\d{1,2}-\d{1,2}$/.test(pick)) return `${pick.replace("-", "–")} score`;
  const [market, sel] = pick.split(":");
  if (market === "1x2") return sel === "draw" ? "Draw" : `${sel === "home" ? home : away} to win`;
  const m = MARKETS.find((x) => x.key === market);
  const o = m?.options.find((x) => x.key === sel);
  return m && o ? (market === "btts" ? `Both teams to score: ${o.label}` : `${o.label} goals`) : pick;
}

const LIVE_STATUSES =["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT", "LIVE"];
const OFF_STATUSES = ["POSTPONED", "CANCELLED", "SUSPENDED"];
// Without a feed status, assume a match is live for this long after kickoff.
const LIVE_WINDOW_MS = 150 * 60_000;
export type Phase = "upcoming" | "live" | "final" | "off";
export function phaseOf(f: Fixture, now: number): Phase {
  if (f.homeGoals != null) return "final";
  if (f.status && LIVE_STATUSES.includes(f.status)) return "live";
  if (f.status && OFF_STATUSES.includes(f.status)) return "off";
  const k = Date.parse(f.kickoff);
  if (Number.isNaN(k)) return "off";
  if (k > now) return "upcoming";
  return now - k < LIVE_WINDOW_MS ? "live" : "off";
}
export const FIXTURES: Fixture[] = [
  { id: "reds-blues-2026-11-21", home: "Reds", away: "Blues", kickoff: "2026-11-21T17:30:00Z", when: "Sat 21 Nov · 17:30" },
  { id: "lagos-derby-2026-11-22", home: "Lagos Reds", away: "Lagos Blues", kickoff: "2026-11-22T16:00:00Z", when: "Sun 22 Nov · 16:00" },
];
export const fixtureOf = (id?: string | null, list: Fixture[] = FIXTURES) => list.find((f) => f.id === id) ?? FIXTURES.find((f) => f.id === id) ?? list[0] ?? FIXTURES[0];
export const whenOf = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const PLAYERS = ["You", "Ada", "Emeka", "Seyi", "Kemi", "Chi", "Ify", "Bayo"].map((name, i) => ({ name, av: art(`avatar_${i + 1}`) }));
export const MODES = [
  { key: "classic", name: "Classic Call", img: "cover_classic", href: "/seal", r: -3 },
  { key: "closest", name: "Closest Wins", img: "cover_closest", href: "/play/closest", r: 2 },
  { key: "vote", name: "Secret Vote", img: "cover_vote", href: "/play/vote", r: -2 },
  { key: "bluff", name: "Bluff Vault", img: "cover_bluff", href: "/play/bluff", r: 3 },
  { key: "fog", name: "Fog of War", img: "cover_fog", href: "/play/fog", r: 2 },
  { key: "werewolf", name: "Werewolf", img: "cover_werewolf", href: "/play/werewolf", r: -3 },
  { key: "arcade", name: "Arcade", img: "cover_arcade", href: "/play/arcade", r: 3 },
  { key: "capsule", name: "Capsule", img: "cover_capsule", href: "/play/capsule", r: -2 },
];
export type Guide = { title: string; steps: [string, string, string]; scoring: string; fair: string };
export const GUIDES: Record<string, Guide> = {
  classic: { title: "Classic Call", steps: ["Set the final score you expect.", "Tap Seal. Your call is locked and hidden from everyone.", "At full time, flip your card to reveal and score."], scoring: "Right result +10, exact score +40 more. Sealing a day before kickoff doubles it, and a daily streak multiplies it up to 3x.", fair: "Your call is sealed on your phone and stamped with a timestamp nobody can change, so no one can edit it after kickoff." },
  arena: { title: "Live Matchday Arena", steps: ["A quick question pops up during the match.", "Pick an answer before the 15-second timer ends.", "It settles live when the event happens."], scoring: "Each right call adds points and builds your combo.", fair: "Your pick locks instantly and is stamped within seconds." },
  closest: { title: "Closest Wins", steps: ["Everyone guesses a number for the same question.", "Guesses stay sealed so nobody can copy.", "All guesses drop onto the line together. Closest wins."], scoring: "Closest guess +40.", fair: "Every guess is sealed before any is shown." },
  vote: { title: "Secret Vote", steps: ["Pick who you're voting for.", "Seal it. Nobody sees your vote yet.", "When everyone has voted, all votes open together."], scoring: "No points. Just the truth.", fair: "Votes are sealed, so nobody is swayed by the crowd." },
  bluff: { title: "Bluff Vault", steps: ["Tap a card from your hand to seal it face down.", "Bid, bluff and taunt while cards stay hidden.", "Flip all: highest number wins the pot. Steal and Shield cause chaos."], scoring: "Win the pot of chips each round.", fair: "Every card is sealed before bidding, so nobody can swap after seeing the bets." },
  fog: { title: "Fog of War", steps: ["Tap up to 3 cells to target this turn.", "Seal your turn. Your opponent can't see it.", "Both turns reveal together and the fog lifts."], scoring: "Find and beat enemy units to win.", fair: "Every move is checked against its seal at the end." },
  werewolf: { title: "Werewolf Night", steps: ["You get a secret role.", "At night, tap a player and seal your action.", "By day, the village votes. Votes open together."], scoring: "Your team wins or loses together.", fair: "The role deal is sealed at the start and opened at the end, so the host can't cheat." },
  arcade: { title: "Fair-Play Arcade", steps: ["Your opponent's move is sealed first.", "Pick Rock, Paper or Scissors.", "Both moves reveal together and the seal is checked."], scoring: "Win a round +18 rating.", fair: "You can see the opponent's seal before you choose, and it's verified after." },
  capsule: { title: "Time Capsule", steps: ["Choose a letter, voice note or photo.", "Pick the day it opens.", "Seal and bury it. It proves when you made it."], scoring: "No points. It's for the memories.", fair: "Only a fingerprint leaves your phone. Your content stays private until the capsule opens." },
};

// ---------- Contest display ----------
/** What a contest is played with: football predictions or one multiplayer game. */
export const CONTEST_GAMES = [
  { key: "football", name: "Football predictions", img: "cover_classic", blurb: "Players seal a score for each match you pick." },
  { key: "arcade", name: "Rock Paper Scissors", img: "cover_arcade", blurb: "Quick 1-on-1 games. Each win counts." },
  { key: "bluff", name: "Bluff Vault", img: "cover_bluff", blurb: "2 to 6 players bid and bluff with sealed cards." },
  { key: "fog", name: "Fog of War", img: "cover_fog", blurb: "1-on-1 hidden-move battles." },
  { key: "werewolf", name: "Werewolf", img: "cover_werewolf", blurb: "Group game of secret roles. The winning team scores." },
] as const;
export const contestGame = (key?: string | null) => CONTEST_GAMES.find((g) => g.key === (key ?? "football")) ?? CONTEST_GAMES[0];
export const SPLIT_LABEL: Record<string, string> = {
  top3: "Top 3 share", top5: "Top 5 share", top10: "Top 10 share", top20: "Top 20 share", custom: "Custom split",
  equal_split: "Equal split", all_correct: "Exact scores split", random_draw: "Lucky draw",
};
/** Dark or light text, whichever reads better on a sponsor's brand colour. */
export function inkOn(bg: string | null | undefined): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((bg ?? "").trim());
  if (!m) return "var(--paper)";
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? "#111" : "var(--paper)";
}
