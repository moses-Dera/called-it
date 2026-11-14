# Called It

Seal your call now. Prove it later. A free-to-play social game app where every prediction,
vote and game move is sealed before the outcome is known, so nobody can cheat or change their answer.

## How sealing works

1. **On your device:** the app hashes `player + round + move + random salt` (SHA-256). Only the hash leaves the phone.
2. **Batching:** `/api/anchor` collects hashes into a Merkle tree and anchors the single root in a shielded Zcash memo.
3. **Reveal:** the move and salt are re-hashed and the Merkle proof is checked against the anchored root.

Anchoring runs in **simulated mode** unless `ANCHOR_URL` (and `ANCHOR_TOKEN`) point at the anchor
service (zingo-cli on Zcash testnet). The hashing, Merkle proofs and verification are real in both modes.

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

## Zcash testnet anchoring

`services/anchor/server.mjs` is a small Node service (no dependencies) that wraps `zingo-cli` and
writes each batch root into a shielded testnet memo (`CI1|<root>`). It needs a machine that can run
the wallet, so it does not run on Vercel.

1. Build zingo-cli from [zingolib](https://github.com/zingolabs/zingolib) (`makers run-cli --build-only`).
2. Create the wallet and note its address:
   `zingo-cli --chain testnet --server https://testnet.zec.rocks:443 --data-dir ~/.called-it/testnet-wallet addresses`
3. Fund that `utest1…` address from a testnet faucet. Fees come out of this wallet.
4. Start the service:
   `ANCHOR_TOKEN=<long random secret> ANCHOR_ADDRESS=<utest1…> ZINGO_CLI=/path/to/zingo-cli node services/anchor/server.mjs`
5. Point the app at it with `ANCHOR_URL=http://127.0.0.1:8787` and the same `ANCHOR_TOKEN`.
   For the deployed app, the service has to be reachable from the internet (a small VPS or a tunnel).

Other settings: `ANCHOR_ZATS` (amount per anchor, default 0), `ZINGO_DATA_DIR`, `ZINGO_SERVER`, `PORT`.
If the service is down or errors, the app falls back to simulated mode and labels the seal that way.

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
