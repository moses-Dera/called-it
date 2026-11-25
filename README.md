# Called It

Seal your call now. Prove it later. A free-to-play football prediction and social game app where every
prediction, vote and game move is sealed before the outcome is known, so nobody can cheat or change their answer.
Tipsters publish records nobody can fake, sponsors run contests with ZEC prize pools, and winners are paid in
shielded ZEC.

## How sealing works

1. **On your device:** the app hashes `calledit:v1|player|round|move|salt` (SHA-256). Only this fingerprint is timestamped.
2. **Batching:** `/api/anchor` collects fingerprints into a Merkle tree and submits the root to the public
   OpenTimestamps calendars, which commit it into a Bitcoin block (`lib/ots.ts`). The proof is stored as a
   standard `.ots` file in the `ots_proofs` table and served at `/api/anchor/proof?root=…`.
3. **Confirming:** the browser asks `/api/anchor?root=…` until the calendars return the Bitcoin attestation;
   the seal then shows its block height. Check any proof yourself with `ots verify -d <root> proof.ots`.
4. **Reveal:** the move and salt are re-hashed and the Merkle proof is checked against the timestamped root.

Without `SUPABASE_SERVICE_ROLE_KEY` the app runs in **simulated mode** and labels seals as simulated. Hashing,
Merkle proofs and verification are real in both modes.

## Accounts (Supabase + Google sign-in)

Optional. Without it the app is guest-only and everything stays on the device.

1. Create a Supabase project and apply the migrations: `npx supabase login`, `npx supabase link --project-ref <project-ref>`, then `npx supabase db push --remote`.
2. In Google Cloud, create an OAuth client (type: Web application) with the redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase, open Authentication > Providers > Google and paste the client ID and secret.
   Under Authentication > URL Configuration, set the site URL and add `http://localhost:3000/**`
   and your deployed URL (`https://<app>/**`) to the redirect list.
4. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Add the same two on Vercel.

A signed-in account backs up the profile, the rewards ledger and each seal's hash and proof.
Sealed moves follow the account through a **reveal escrow** (`/api/escrow`): each move is encrypted with
`SEAL_ESCROW_KEY`, a key held only in the server environment, stored in the player's own rows, and
decrypted only for that player, so they can reveal from any device with nothing to remember. Other players
can never read moves early. Trade-off: whoever runs the server could; nobody can change a move, because
its hash is already sealed and timestamped on Bitcoin. Set `SEAL_ESCROW_KEY` (`openssl rand -base64 32`) on
Vercel. Points are score only; ZEC comes from contest prizes.

## Ranked points, fixtures and payouts

- **Practice points** come from games against bots. They are counted in the browser, so they never
  reach the leaderboard or carry prize ZEC.
- **Ranked points** come only from the database function `claim_classic()`. At reveal it re-hashes the
  move and salt, checks the seal reached the server before kickoff, and scores it against the official
  result in the `fixtures` table. The leaderboard (`leaderboard()`) and the prize balance count only these.
- **Fixtures** live in the `fixtures` table. Enter a final score in the Supabase SQL editor once a match ends:
  `update fixtures set home_goals = 2, away_goals = 1 where id = 'reds-blues-2026-11-21';`
- **Withdrawals**: signed-in players request a payout from the Vault (`request_withdrawal()`). Only
  mainnet shielded addresses are accepted (`u1…` or `zs1…`); the app checks the address checksum
  (`lib/zaddr.ts`) so typos and partial pastes are caught, and requests are serialised per player so one
  balance can't be withdrawn twice. Payouts go out from the admin Payouts tab (`services/anchor`).

## Play with friends (real players)

`/rooms`: create a game, pick opponents from the player list or share the room code, and play in
`/room?id=…`. Games: Rock Paper Scissors (1 vs 1), Secret Vote, Closest Wins (the host referees and enters the
true answer), a group Time Capsule (opens on a chosen date), Bluff Vault (2-6 players; everyone holds
the same seven cards, one sealed per round), Fog of War (1 vs 1; sealed unit positions and volleys,
reports re-checked at the end) and Werewolf (5-8 players; a sealed role deal opened and checked at the end).

Each move is sealed on the device (only the hash reaches the server, and it is also timestamped on Bitcoin).
When everyone has sealed, each device reveals its move and salt; the server re-hashes them against the
seals and settles the round. Moves stay hidden until then, even from players who already revealed.
Anyone who doesn't reveal within 10 minutes forfeits. Wins give ranked points but no ZEC. Rooms update
live through Supabase Realtime.

## Verified tipster records

Any signed-in player can publish a public record at `/tipster?h=<handle>` (Profile > Public tipster record).
Tipsters seal Classic Calls or market tips at `/tip` (match result, over/under 2.5 goals, both teams to score).
The record can't be cherry-picked:

- Only tips sealed **after** the record went public count, and only the **first** tip on each match.
- The server settles every tip itself a few hours after full time (`lib/tipsters.ts`, run from `/api/cron` and
  `/api/live`), decrypting it from the reveal escrow. A tip whose escrowed copy is missing or doesn't match its
  seal counts as lost.
- Once a record has been public, its Classic Call and tip seals can't be deleted, even after going private.
- Open tips show only that a tip exists; the pick is revealed after full time. Each settled tip links to its
  Bitcoin `.ots` proof.

Players follow tipsters (`follow_tipster()`) and get a push notification, without the pick, when a followed
tipster seals a tip (`/api/tipsters/announce`).

## Admin, contests and sponsors

Open `/admin` while signed in. The first account to press **Claim admin** becomes the admin (only while there is
none; no other way to add an admin exists in the app). From there:

- **Fixtures:** import real fixtures and results from football-data.org (`FOOTBALL_DATA_KEY`), or add a match by hand.
- **Contests:** group fixtures into a contest with branding (logo, colour, URL), a description, an entry deadline,
  a ZEC prize pot and a prize split (top 3/5/10/20, custom percentages, equal split, all exact scores, random draw).
  Contests settle automatically when their last match finishes (`/api/cron`); winners get verified rewards they
  withdraw from the Vault.
- **Prize fund wallet:** your own shielded address, stored in `app_settings`. Boost the Pot and sponsor funding pay
  it through ZIP-321 payment QR codes (`lib/zip321.ts`). Boost the Pot stays hidden until it is set.
- **Sponsors:** grant the sponsor role by the person's sign-in email (they must sign in once first). Sponsors open
  `/sponsor` to reach their dashboard, where they create contests, schedule when they go public, pause joining,
  watch entries and seals per match live, and fund the prize. Contests go public without approval; the admin can
  hide any contest. Once players join, the matches, prize and deadline are locked.
- **Funding ledger:** sponsors pay the prize wallet with memo `fund:<contest id>`; the admin records the amount
  received against that contest. A sponsor's contest only auto-settles once fully funded, and hidden contests never
  auto-settle. Contest pages show "Prize funded" when the ledger covers the prize.
- **Sponsor requests:** brands that aren't sponsors yet send a request from `/sponsor`; requests appear here.
- **Payouts and Credit:** pay winners and withdrawals in shielded ZEC, and award verified points.

### Auto fixture pipeline (cron)

`/api/cron` imports upcoming fixtures and fetches finished results from football-data.org for
PL, CL, La Liga, Serie A and Bundesliga. `/api/notify` sends push notifications to subscribed
players about fixtures starting in the next hour. Both are protected by `CRON_SECRET`.

Set up a cron job (Vercel Cron, Railway, or plain `curl`) to hit each every 30 minutes:

```
*/30 * * * * curl -s "https://<app>/api/cron?token=$CRON_SECRET"
*/30 * * * * curl -s "https://<app>/api/notify?token=$CRON_SECRET"
```

### Push notifications

Players tap the bell icon on the home screen to subscribe, and new followers of a tipster are offered a one-tap prompt. The service worker (`public/sw.js`)
handles push events and caches the app shell for offline use.

Required env vars:

```bash
# Generate a VAPID key pair:
npx web-push generate-vapid-keys

NEXT_PUBLIC_VAPID_PUBLIC_KEY=   # the public key (goes to the browser)
VAPID_PRIVATE_KEY=              # the private key (server-only)
CRON_SECRET=                    # shared secret for /api/cron and /api/notify
SUPABASE_SERVICE_ROLE_KEY=      # server-side Supabase key (bypasses RLS)
```

The `push_subscriptions` table and RLS policies are created by migration
`20261121130000_streaks_and_push.sql`.

### Contests listing and referrals

`/contests` lists open and past contests. Each contest card shows sponsor branding, prize info,
fixture count and entry status. Players can share a contest link with a referral param
(`?ref=<user_id>`) — the referrer is recorded in `contest_entries.referrer`.

### OG images

`/api/og` generates dynamic Open Graph images for sharing:

- `?type=reveal&home=...&away=...&h=2&a=1&result=exact` — reveal card
- `?type=contest&contest=...&prize=...` — contest card
- `?type=seal&home=...&away=...` — sealed call card
- Default (no params) — generic Called It card

The root `app/opengraph-image.tsx` generates the default OG image for the site.

## Prize payouts (services/anchor)

`services/anchor/` is a small Node service built on [zcash.js](https://zcashlabs.github.io/zcashjs/), a Zcash light
client (no full node). It pays contest winners and withdrawals in shielded ZEC with a memo. Run it with
`ZCASH_NETWORK=mainnet node cli.mjs payouts` (or `contest-payout <id>`), or connect GitHub Actions
(`GITHUB_REPO`, `GITHUB_PAT`) so the admin Payouts tab can trigger `.github/workflows/payouts.yml` with one click.
The wallet's 24-word phrase lives in `~/.called-it/anchor-wallet/mnemonic.txt` (or `ANCHOR_MNEMONIC`); keep it safe.
`services/anchor` also ships a `Dockerfile` and `docker-compose.yml` for an always-on server.

Seal timestamps no longer use this service: they go to Bitcoin through OpenTimestamps (see How sealing works).

## Onboarding, streaks and badges

First-time visitors see a 3-step onboarding walkthrough (dismissible, remembered in localStorage).
`/how` explains how sealing works with technical details.

**Streaks:** consecutive days with at least one seal. Shown on the profile and desk panel.
A 3-day streak gets a fire badge, 7-day gets "Iron Will".

**Badges** (profile page): First Seal, Called It!, Sniper (5 exact), Early Bird, Regular (10 seals),
Veteran (50 seals), Century (100+ ranked pts), Oracle (10 exact), On Fire (3-day streak),
Iron Will (7-day streak). Stats come from the `player_stats()` database function.

## Screens

Home, Seal (Classic Call), Seal a tip, Waiting room, Reveal, Ranks, Vault, Contests, Contest, Sponsor
(request form or sponsor dashboard), Tipster profile, How It Works, Profile, Admin, and eight game modes under `/play`: Live Arena, Closest Wins, Secret Vote, Bluff Vault,
Fog of War, Werewolf Night, Fair-Play Arcade, Time Capsule. Each game has a "?" how-to-play
guide that opens on first visit.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Stack

Next.js (App Router) + TypeScript, installable as a PWA with offline support (service worker),
push notifications (Web Push / VAPID), optional Supabase accounts (Google sign-in), auto fixture
pipeline (football-data.org), verified tipster records, sponsor-run contests with flexible prize
structures, Bitcoin timestamps through OpenTimestamps, and shielded ZEC payouts with zcash.js.

## Layout

- `app/` screens, `/api/anchor` stamping and proofs, `/api/live` live scores, `/api/tipsters/announce` follower alerts, `/api/cron` auto fixtures, `/api/notify` push, `/api/og` OG images
- `lib/store.ts` sealing, verification and local rewards ledger
- `lib/merkle.ts` Merkle tree and proofs, `lib/ots.ts` OpenTimestamps stamping and proof upgrades
- `lib/tipsters.ts` tipster settlement, `lib/zip321.ts` payment links, `lib/zaddr.ts` address checksums
- `lib/cloud.ts` Supabase sign-in, sync, contest hooks and player stats
- `supabase/migrations/` tables, RLS, scoring functions and contest logic
- `services/anchor/` the shielded ZEC payout service
- `components/ui.tsx` shared components, `components/notifications.tsx` push bell, `components/onboarding.tsx`
- `public/sw.js` service worker (push + offline cache)
- `public/a/` optimised artwork, `design-assets/` original PNGs
