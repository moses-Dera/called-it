# Called It

Seal your call now. Prove it later. A free-to-play social game app where every prediction,
vote and game move is sealed before the outcome is known, so nobody can cheat or change their answer.

## How sealing works

1. **On your device:** the app hashes `player + round + move + random salt` (SHA-256). Only the hash leaves the phone.
2. **Batching:** `/api/anchor` collects hashes into a Merkle tree and anchors the single root in a shielded Zcash memo.
3. **Reveal:** the move and salt are re-hashed and the Merkle proof is checked against the anchored root.

Anchoring runs in **simulated mode** unless `ANCHOR_URL` (and `ANCHOR_TOKEN`) point at the anchor
service (zingo-cli on Zcash testnet). The hashing, Merkle proofs and verification are real in both modes.

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

Next.js (App Router) + TypeScript, installable as a PWA. Planned next: Supabase (Google sign-in,
contests, sponsor pots, rewards ledger), the Zcash testnet anchor service, live football data.

## Layout

- `app/` screens and the `/api/anchor` route
- `lib/store.ts` sealing, verification and local rewards ledger
- `lib/merkle.ts` Merkle tree and proofs, `lib/zcash.ts` anchor client
- `components/ui.tsx` shared components
- `public/a/` optimised artwork, `design-assets/` original PNGs
