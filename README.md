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
Moves and salts are never uploaded. Points are reported by the client, so treat them as unverified
until scoring moves to the server.

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
`/room?id=…`. Phase 1 games: Rock Paper Scissors (1 vs 1), Secret Vote, Closest Wins (the host
referees and enters the true answer) and a group Time Capsule (opens on a chosen date).

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
- **Contests and sponsors:** group fixtures into a contest with an optional sponsor and a testnet ZEC
  prize pot. It shows on Home with its own leaderboard at `/contest?c=<id>`. Closing it splits the pot
  50/30/20 between the top three as verified rewards they can withdraw from the Vault.
- **Payout requests:** see every request, mark paid or rejected (or run `npm run payouts`).
- **Transaction record:** every anchor transaction (block, seals, players) and every payout, with ids to copy.

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

The wallet's 24-word phrase is saved in `~/.called-it/anchor-wallet/mnemonic.txt` (or supply
`ANCHOR_MNEMONIC`). It is a testnet wallet; never send real ZEC to it.

Other settings: `ANCHOR_ZATS` (amount sent to itself per anchor, default 10000 zats; only the fee is
spent), `ANCHOR_WAIT_MS` (wait for the first confirmation, default 90000), `ANCHOR_DATA_DIR`,
`ZCASH_SERVER`, `PORT`. Without `ANCHOR_URL` (a local demo) the app labels seals "simulated". With `ANCHOR_URL` set, seals made while the service is down stay pending
("SEALED · ANCHORING…") and the browser retries every minute, so they are anchored once it is back. zcash.js is an experimental 0.1.x release: fine for testnet, not for real funds.

## Screens

Home, Seal (Classic Call), Waiting room, Reveal, Ranks, Vault, and eight game modes under `/play`:
Live Arena, Closest Wins, Secret Vote, Bluff Vault, Fog of War, Werewolf Night, Fair-Play Arcade, Time Capsule.
Each game has a "?" how-to-play guide that opens on first visit.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Stack

Next.js (App Router) + TypeScript, installable as a PWA, with optional Supabase accounts
(Google sign-in) and a Zcash testnet anchor service. Planned next: server-side scoring, contests,
sponsor pots, live football data.

## Layout

- `app/` screens and the `/api/anchor` route
- `lib/store.ts` sealing, verification and local rewards ledger
- `lib/merkle.ts` Merkle tree and proofs, `lib/zcash.ts` anchor client
- `lib/cloud.ts` Supabase sign-in and sync, `supabase/migrations/` tables and row-level security
- `services/anchor/` the Zcash testnet anchor service
- `components/ui.tsx` shared components
- `public/a/` optimised artwork, `design-assets/` original PNGs
