# Called It

Seal your call now. Prove it later. A free-to-play social game app where every prediction,
vote and game move is sealed before the outcome is known, so nobody can cheat or change their answer.

## How sealing works

1. **On your device:** the app hashes `player + round + move + random salt` (SHA-256). Only the hash leaves the phone.
2. **Batching:** `/api/anchor` collects hashes into a Merkle tree and anchors the single root in a shielded Zcash memo.
3. **Reveal:** the move and salt are re-hashed and the Merkle proof is checked against the anchored root.

Anchoring runs in **simulated mode** unless `ANCHOR_URL` (and `ANCHOR_TOKEN`) point at the anchor
service (zcash.js on Zcash testnet). The hashing, Merkle proofs and verification are real in both modes.

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
its hash is already sealed and anchored on Zcash. Set `SEAL_ESCROW_KEY` (`openssl rand -base64 32`) on
Vercel. Points are score only; ZEC comes from contest prizes.

## Ranked points, fixtures and payouts

- **Practice points** come from games against bots. They are counted in the browser, so they never
  reach the leaderboard or carry prize ZEC.
- **Ranked points** come only from the database function `claim_classic()`. At reveal it re-hashes the
  move and salt, checks the seal reached the server before kickoff, and scores it against the official
  result in the `fixtures` table. The leaderboard (`leaderboard()`) and the prize balance count only these.
- **Fixtures** live in the `fixtures` table. Enter a final score in the Supabase SQL editor once a match ends:
  `update fixtures set home_goals = 2, away_goals = 1 where id = 'reds-blues-2026-11-21';`
- **Withdrawals**: signed-in players request a payout from the Vault (`request_withdrawal()`, testnet
  `utest1…` addresses only). Pay them from the anchor wallet with
  `SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run payouts` in `services/anchor`. The secret key is for that
  script only; never put it in the web app or on Vercel.

## Play with friends (real players)

`/rooms`: create a game, pick opponents from the player list or share the room code, and play in
`/room?id=…`. Games: Rock Paper Scissors (1 vs 1), Secret Vote, Closest Wins (the host referees and enters the
true answer), a group Time Capsule (opens on a chosen date), Bluff Vault (2-6 players; everyone holds
the same seven cards, one sealed per round), Fog of War (1 vs 1; sealed unit positions and volleys,
reports re-checked at the end) and Werewolf (5-8 players; a sealed role deal opened and checked at the end).

Each move is sealed on the device (only the hash reaches the server, and it is also anchored on Zcash).
When everyone has sealed, each device reveals its move and salt; the server re-hashes them against the
seals and settles the round. Moves stay hidden until then, even from players who already revealed.
Anyone who doesn't reveal within 10 minutes forfeits. Wins give ranked points but no ZEC. Rooms update
live through Supabase Realtime.

## Admin, contests and sponsors

Open `/admin` while signed in. The first account to press **Claim admin** becomes the admin (only while
there is none), and an Admin link then appears in its sidebar. From there:

- **Fixtures:** add matches (or "Demo match in 10 min" to try the full flow), and enter final scores.
  Signed-in players who sealed a fixture are scored automatically the next time they open the app.
- **Contests and sponsors:** group fixtures into a contest with an optional sponsor, branding (logo,
  colour, URL), a description, an entry deadline, and a ZEC prize pot. Players opt in at
  `/contest?c=<id>` (join/leave). Prize structures: **top3** (50/30/20), **top10**, **all_correct**
  (split among exact-score winners), or **random_draw** (one lucky winner). Closing a contest
  distributes prizes as verified rewards the winners can withdraw from the Vault.
- **Real fixtures:** with `FOOTBALL_DATA_KEY` set (a free key from football-data.org), "Import next
  10 days" adds real matches for a chosen competition and "Fetch results" enters their final scores.
  The key stays on the server (`/api/football`, admin-only).
- **Payout requests:** see every request, mark paid or rejected (or run `npm run payouts`).
- **Transaction record:** every anchor transaction (block, seals, players) and every payout, with ids to copy.

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

Players tap the bell icon on the home screen to subscribe. The service worker (`public/sw.js`)
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

## Zcash testnet anchoring

`services/anchor/` is a small Node service built on [zcash.js](https://zcashlabs.github.io/zcashjs/)
(`@zcashlabs/zcash.js` 0.1.2, installed from its GitHub release because npm still has 0.1.1). It talks to the public light-wallet server `testnet.zec.rocks`, so there is
no full node and nothing to compile. Each anchor is a shielded Ironwood transaction to the wallet's
own address with the memo `CI1|<root>` (up to 7 roots share one transaction). The wallet lives on
disk, so the service runs on a normal machine or VPS, not on Vercel.

```bash
cd services/anchor
npm install
npm run init-wallet   # creates the testnet wallet once and prints the address to fund
```

1. Fund the printed `utest1…` address from a testnet faucet
   ([fauzec.com](https://fauzec.com/) or [zcashfaucet.jinolabs.xyz](https://zcashfaucet.jinolabs.xyz/)).
   Check it arrived with `npm run balance` (3 confirmations before it is spendable).
2. Start the service. Either `npm run online`, which starts it plus a free Cloudflare quick tunnel
   (`cloudflared` must be installed) and prints the `ANCHOR_URL` and token for Vercel, or
   `ANCHOR_TOKEN=<long random secret> npm start` on a server you expose yourself.
3. Point the app at it with `ANCHOR_URL=http://127.0.0.1:8787` and the same `ANCHOR_TOKEN` in `.env.local`.
   For the deployed app, the service has to be reachable from the internet (a small VPS or a tunnel).

Notes on the SDK (handled automatically):

- The built-in testnet preset stops at NU6.3, so `wallet.mjs` defines testnet with NU7 (block 4,465,026,
  from librustzcash `zcash_protocol`).
- `npm install` runs `patch-sdk.mjs`, which accepts light-server protocol v0.6.0 (upstream PR #28) and
  stops standing transparent-address polls from blocking every send.

**Deploying on an always-on server (recommended for launch).** `services/anchor` ships a `Dockerfile`
and a `docker-compose.yml` that runs the service behind Caddy with automatic HTTPS. Any small Linux
server works (a $5 VPS, or Oracle Cloud's Always Free tier). Steps are at the top of
`docker-compose.yml`: set `ANCHOR_DOMAIN` and `ANCHOR_TOKEN` in `.env`, run `init` once, fund the
address, `docker compose up -d`, then point `ANCHOR_URL` in Vercel at `https://<domain>`.

The wallet's 24-word phrase is saved in `~/.called-it/anchor-wallet/mnemonic.txt` (or supply
`ANCHOR_MNEMONIC`). It is a testnet wallet; never send real ZEC to it.

Other settings: `ANCHOR_ZATS` (amount sent to itself per anchor, default 10000 zats; only the fee is
spent), `ANCHOR_WAIT_MS` (wait for the first confirmation, default 90000), `ANCHOR_DATA_DIR`,
`ZCASH_SERVER`, `PORT`. Without `ANCHOR_URL` (a local demo) the app labels seals "simulated". With `ANCHOR_URL` set, seals made while the service is down stay pending
("SEALED · ANCHORING…") and the browser retries every minute, so they are anchored once it is back. zcash.js is an experimental 0.1.x release: fine for testnet, not for real funds.

## Onboarding, streaks and badges

First-time visitors see a 3-step onboarding walkthrough (dismissible, remembered in localStorage).
`/how` explains how sealing works with technical details.

**Streaks:** consecutive days with at least one seal. Shown on the profile and desk panel.
A 3-day streak gets a fire badge, 7-day gets "Iron Will".

**Badges** (profile page): First Seal, Called It!, Sniper (5 exact), Early Bird, Regular (10 seals),
Veteran (50 seals), Century (100+ ranked pts), Oracle (10 exact), On Fire (3-day streak),
Iron Will (7-day streak). Stats come from the `player_stats()` database function.

## Screens

Home, Seal (Classic Call), Waiting room, Reveal, Ranks, Vault, Contests, How It Works,
Profile, and eight game modes under `/play`: Live Arena, Closest Wins, Secret Vote, Bluff Vault,
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
pipeline (football-data.org), sponsor contests with flexible prize structures, and a Zcash anchor
service for tamper-proof seal timestamps.

## Layout

- `app/` screens, `/api/anchor` route, `/api/cron` auto fixtures, `/api/notify` push, `/api/og` OG images
- `lib/store.ts` sealing, verification and local rewards ledger
- `lib/merkle.ts` Merkle tree and proofs, `lib/zcash.ts` anchor client
- `lib/cloud.ts` Supabase sign-in, sync, contest hooks and player stats
- `supabase/migrations/` tables, RLS, scoring functions and contest logic
- `services/anchor/` the Zcash anchor service
- `components/ui.tsx` shared components, `components/notifications.tsx` push bell, `components/onboarding.tsx`
- `public/sw.js` service worker (push + offline cache)
- `public/a/` optimised artwork, `design-assets/` original PNGs
