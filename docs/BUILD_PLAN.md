# Called It: build plan and handoff

This document is for the engineer (human or AI model) who continues building Called It. Read it fully before
changing anything. It covers what the product is, where the code stands, the rules you must follow, lessons
already learned the hard way, and the work still to do, in order, with acceptance criteria.

Last updated: 2026-11-28.

---

## 0. Ground rules (do not break these)

1. **Never edit a migration that has been applied.** Production already has every file in
   `supabase/migrations/` up to the last push. Always add a new file named `YYYYMMDDHHMMSS_short_name.sql` with a
   timestamp later than the newest one. Editing an applied file caused a real outage (seals rejected in prod).
2. **The owner pushes, not you.** Commit locally. The owner runs `npx supabase db push --remote` and `git push`.
   Never run either yourself.
3. **Secrets.** Never print, log, commit or send anywhere the values in `.env.local`
   (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `FOOTBALL_DATA_KEY`, `TELEGRAM_*`).
   Do not set `SEAL_ESCROW_KEY` locally (it would corrupt production escrow). Never print a wallet recovery phrase.
4. **Called It never holds anyone's money.** Sponsors pay winners directly; the in-app wallet keeps keys on the
   player's device. Do not add any server-side custody of funds or keys.
5. **No paid plans.** The owner has no budget for Supabase Pro or Vercel Pro. The target is one self-hosted
   server (see Phase 2). Do not design anything that requires a paid managed service.
6. **No browser dialogs.** Never use `alert`, `confirm` or `prompt`. Use `askConfirm`, `askText`, `showNotice`
   from `components/dialog.tsx`, and `openShare` from `components/share-sheet.tsx` for sharing.
7. **Next.js here is v16 with Cache Components and Turbopack.** Read the matching guide in
   `node_modules/next/dist/docs/` before using a Next API. Pages that read URL data (params, searchParams,
   `usePathname`) must render that part inside `<Suspense>` (see `app/contest/[id]/page.tsx`).
8. **Write plainly in the UI.** Short sentences, no jargon, no "Error:" prefixes. The owner dislikes clutter:
   fewer lists, fewer cards, one clear action per screen.
9. **Test before you claim it works.** Database changes: `scripts/test-migrations.sh your-test.sql`.
   App: `npx tsc --noEmit`, `npx eslint app components lib`, `npx next build`. Browser features: try them in a
   real browser. Say plainly what you did and did not verify.
10. Commit messages end with the co-author line the owner's tooling specifies.

---

## 1. The product in one page

Called It is a free-to-play football prediction and party-game app.

- **Seal a call:** a player picks a score before kickoff. The pick is hashed on the device (commit-reveal) and
  the hashes are batched into a Merkle root that is timestamped on **Bitcoin via OpenTimestamps**
  (`lib/ots.ts`, `lib/merkle.ts`). After full time the player reveals and the server scores it.
- **Contests:** anyone can become a sponsor (`/sponsor`) and run a contest with a ZEC prize. A contest is either
  **football predictions** (matches picked by league) or **one multiplayer game** (Rock Paper Scissors `arcade`,
  Bluff Vault `bluff`, Fog of War `fog`, Werewolf `werewolf`) played in rooms for a set time.
- **Money model (non-custodial):** when a contest closes, winners are ranked. The **sponsor pays each winner
  directly** in shielded ZEC from their own wallet within 72 hours (ZIP-321 link/QR with address, amount, memo),
  marks it sent with the transaction ID, and the winner taps "I got it". Safeguards: new sponsors can promise at
  most 0.5 ZEC (limit grows as winners confirm), overdue sponsors can't start contests, a public payment record,
  7-day auto-confirm when a txid was given, disputes go to Admin, one prize per wallet per contest.
- **Next big feature:** an **in-app shielded wallet** so nobody needs a second app (Phases 3 to 7).
- Network: the admin switches the whole app between `testnet` (TAZ) and `mainnet` (Admin > Settings).
  It is on **testnet** now.

---

## 2. Current state

### Live (production, vercel.app) vs local
The live site is behind. At the time of writing **13 commits and 7 migrations are committed locally but not
pushed** (`git log origin/main..HEAD`). Until the owner pushes, production still shows old bugs (for example
"Sync problem", because production rejects Bitcoin-mode seals; fixed by
`20261126100000_fix_drift_and_contest_close.sql`).

### Stack
- **App:** Next.js 16 (App Router, Turbopack, Cache Components), React, TypeScript. Hosted on Vercel today.
- **Database/auth/realtime:** Supabase (Postgres with RLS and `SECURITY DEFINER` RPCs, Google OAuth,
  Realtime). Hosted free plan today; target is self-hosted (Phase 2).
- **Football data:** football-data.org free plan, 12 leagues (`lib/leagues.ts`), two requests per run.
- **Scheduling:** `/api/live` (scores, settle contests, auto-settle prizes) is pinged every 15 min by
  `.github/workflows/keepalive.yml`; `/api/cron` daily by Vercel cron (`vercel.json`). Target: 1-minute
  scheduler on the server (Phase 2).
- **Zcash:** `@zcashlabs/zcash.js` 0.1.2 (experimental). Patched on install by `services/anchor/patch-sdk.mjs`
  (applied to both `services/anchor/node_modules` and the app's `node_modules`). Browser wallets reach Zcash
  through **ChainSafe's gRPC-web relays** (`https://zcash-testnet.chainsafe.dev`,
  `https://zcash-mainnet.chainsafe.dev`); Node reaches `testnet.zec.rocks:443` / `zec.rocks:443` over gRPC.

### Where things are
| Area | Files |
|---|---|
| Client data layer (Supabase calls, hooks, types) | `lib/cloud.ts` |
| Local device state (seals, profile, ledger) | `lib/store.ts` |
| In-app wallet (browser) | `lib/in-app-wallet.ts`, test page `app/wallet-lab/page.tsx` (admin-only in production) |
| Wallet engine files | copied on install to `public/zcash/<ENGINE>/wallet/` by `scripts/copy-zcash-assets.mjs` (gitignored) |
| Contests (page, play panel) | `app/contest/[id]/page.tsx`, `components/contest-view.tsx`, `components/contest-play.tsx` |
| Sponsor dashboard, contest form, pay panel | `components/sponsor-dashboard.tsx` |
| Winner prizes (Vault) | `components/sponsor-prizes.tsx` |
| Sponsor public record | `components/sponsor-record.tsx` |
| Contest settling (cron + live + on view) | `lib/settle.ts`, `app/api/settle/route.ts` |
| Health of outside services | `app/api/health/route.ts`, Admin > Overview > Connections |
| Usernames, player cards, search | `app/u/[handle]/page.tsx` (served at `/@handle` via rewrite), `components/player-view.tsx`, `components/player-search.tsx` |
| Dialogs and share panel | `components/dialog.tsx`, `components/share-sheet.tsx` |
| Admin | `app/admin/page.tsx` |
| Wallet advice per network | `lib/wallets.ts` (Zashi on mainnet; Zingo/Zkool + fauzec.com faucet on testnet) |
| Payment links | `lib/zip321.ts`; explorer links `lib/explorer.ts` |
| Migrations | `supabase/migrations/` (38 files) |
| Node wallet tool (legacy payouts, anchoring) | `services/anchor/` |

### Key database functions (latest definitions win; grep the newest migration)
`contest_scores`, `contest_ranked`, `contest_leaderboard`, `admin_close_contest`, `contest_winner`,
`sponsor_save_contest`, `sponsor_dashboard`, `sponsor_payees`, `sponsor_mark_sent`, `confirm_prize`,
`my_sponsor_prizes`, `sponsor_records`, `auto_settle_prizes`, `admin_prize_disputes`, `admin_resolve_prize`,
`create_contest_room`, `contest_quick_match`, `contest_rooms`, `join_room`, `ensure_username`, `set_username`,
`player_card`, `search_players`.

### Environment variables (names only)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`),
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `FOOTBALL_DATA_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`,
`ANCHOR_URL`, `ANCHOR_TOKEN`, `SEAL_ESCROW_KEY` (production only), `GITHUB_PAT`, `GITHUB_REPO`.

---

## 3. Lessons already learned (save yourself the time)

- **zcash.js in the browser:**
  - Turbopack follows Node-only dynamic imports. `patch-sdk.mjs` adds `/* turbopackIgnore: true */` to them.
  - The bundler renames the engine files, which breaks the engine's manifest. Engine files are served unchanged
    from `/zcash/<ENGINE>/` and the library is pointed there with `globalThis.__CALLEDIT_ZCASH_ASSETS__`
    (patched into `bundled-assets.mjs`). The engine still verifies every file by SHA-256.
  - The engine requires `.mjs` served as exactly `text/javascript` (header rule in `next.config.ts`).
  - Browsers cache engine files; the folder is versioned by manifest hash (`ENGINE = "ea08c661"` in both
    `lib/in-app-wallet.ts` and `scripts/copy-zcash-assets.mjs`). Update both when zcash.js is upgraded.
  - Browsers cannot speak plain gRPC; use a gRPC-web relay. `zec.rocks` does not support gRPC-web.
  - No cross-origin isolation: the engine runs single-threaded (fine, slower proving). Do not add COOP/COEP
    headers without checking Google sign-in and third-party images still work.
  - Measured on testnet: open 2.3 s, create account 9.5 s, first sync 33 s, catch-up after 14 h 205 s.
- **zcash.js in Node:** on machines without working IPv6, Node gave up on IPv4; `wallet.mjs` prefers IPv4.
  Flaky links drop gRPC streams; use `syncWithRetry`. Mainnet lightwalletd is `zec.rocks`, not
  `mainnet.zec.rocks`.
- **Postgres functions:** never leave two overloads where a call with only defaults is ambiguous (this broke the
  admin overview and the contest leaderboard). Drop the old signature when changing parameters.
- **Contest close:** `contests_close_guard` blocks closing before every match has a result (or before
  `ends_at` for games). `contests_sponsor_close` strips addresses from public winners and starts the 72 h window.
- **Owner's network is slow and flaky** (DNS drops, slow TLS). npm installs may need `--prefer-offline`.
  Never treat a dropped connection as a server outage without checking.

---

## 4. The work, in order

**Build order right now:** 1.4 Privacy by default → 1.1 Offline-aware sync → 3 Send from the browser wallet →
4 Background sync → 5 The wallet inside the app → 6 One-tap Pay winners → 7 Automatic prize detection →
1.2 Error monitoring and 1.3 Clean wallet pages → 8 Security and launch. Phase 2 (the server) starts as soon as
the owner has the server and domain, in parallel with the wallet work. Phase 0 (push and two-phone test) is the
owner's and should happen first.

Each task has a goal, the steps, and how to know it's done. Do them in order unless a task says otherwise.

### Phase 0: Ship and prove what exists (owner + you)
**0.1 Push** (owner): `npx supabase db push --remote`, then `git push`. Check Admin > Overview > Connections
shows all green and the Sync label on the sidebar shows "Progress backed up".

**0.2 Two-phone testnet run** (owner, you support): Zingo or Zkool on two phones set to Testnet; test coins
from fauzec.com; sponsor creates a 1-hour Rock Paper Scissors contest (prize 0.1); second account (different
Google login) saves its `utest1...` address in Profile, joins, both tap Play now; after the hour the sponsor
taps Pay in wallet, sends, pastes the transaction ID; the winner taps I got it.
**Done when** the contest page shows "✓ received" with a working "payment ↗" explorer link. Record whether
Zingo/Zkool open the `zcash:` link or read the QR with the memo; if not, note it for Phase 6.

### Phase 1: Reliability (small, do first)
**1.1 Offline-aware sync.** In `lib/cloud.ts`, `sync()` sets `status: "error"` on any failure. Change it:
network failures (fetch `TypeError`, "Failed to fetch", timeouts) set a new status `"offline"` and retry with
backoff (5 s, 15 s, 30 s, 60 s, then every 60 s) and immediately on the window `online` event; real database
errors keep `"error"`. Update `components/account.tsx` and `app/profile/page.tsx`: offline shows amber
"Offline, retrying…", error shows red with the message. Apply the same pattern to other polling loaders.
**Done when** turning the network off and on in DevTools shows amber, then recovers on its own with no reload.

**1.2 Error monitoring.** Add error reporting that works on the self-hosted server (GlitchTip self-hosted, or
Sentry's free tier). Scrub anything that looks like a 24-word phrase, a Zcash key or an address from events.
**Done when** a thrown test error in a client page and in an API route both appear in the dashboard, scrubbed.

**1.3 Wallet pages stay clean.** `app/layout.tsx` loads Telegram's web-app script on every page. Load it only
when actually inside Telegram (or only on pages that need it), and never on wallet pages. Add a strict
Content-Security-Policy for wallet routes (self, the relay origin, Supabase). **Done when** wallet pages load no
third-party scripts (check the Network tab) and still work.

**1.4 Privacy by default.** The owner wants total privacy. Today `/@username` (`player_card`) shows points,
contest wins and total ZEC received to anyone, and `search_players` finds anyone by name.
- New migration: `profiles.show_stats boolean not null default false` and `profiles.searchable boolean not null
  default true`. `player_card` returns points and contest wins only when `show_stats` or the viewer is the owner;
  it **never** returns ZEC received to anyone but the owner. `search_players` matches names only for
  `searchable` players (an exact @username still resolves).
- Contest prizes stay public on purpose (the pot and what each place wins, shown on the contest page). Privacy
  protects people: their totals, stats, wallet addresses and findability.
- Profile gets two switches: "Show my stats on my public page" (off by default) and "Hide me from name search".
- Wallet addresses are already never public (`20261128090000_no_public_addresses.sql`); keep it that way.
**Done when** a logged-out visitor to `/@someone` sees only username, name and avatar (unless stats are on), ZEC
received is visible only to its owner, a hidden player is found only by exact @username, and contest pages still
show the prize pot and each place's prize.

### Phase 2: Infrastructure on one server (needs owner: server + domain)
Target: one Hetzner VPS (4 vCPU, 8 GB, Ubuntu LTS), Docker Compose, Cloudflare free plan in front.
**2.1 Server baseline:** non-root user, SSH keys only (the owner adds keys; never ask for passwords), firewall
(22, 80, 443), unattended security upgrades, Docker. Document every command in `docs/SERVER.md`.
**2.2 Self-hosted Supabase:** official `supabase/docker` compose. Configure Google OAuth, site URL and redirect
URLs for the new domain, SMTP optional. Apply all migrations with the Supabase CLI against it.
**2.3 Data move:** `pg_dump` from the hosted project including the `auth` schema (users and identities) and
`public`; restore into the self-hosted database. Verify row counts per table and that an existing user can
sign in. Plan a short switch-over at a quiet hour; keep the hosted project read-only as fallback for a week.
**2.4 App:** build the Next.js app as a Docker image (`output: "standalone"` if needed; check the v16 docs),
behind Caddy or Traefik for HTTPS. Make sure `npm ci` runs the `postinstall` (engine copy and SDK patches).
**2.5 Our own gRPC-web relay:** Envoy (or a small grpc-web proxy) in front of `testnet.zec.rocks:443` and
`zec.rocks:443`, CORS allowing only our domain, at `relay.<domain>`. Make the relay URL configurable with
`NEXT_PUBLIC_ZCASH_RELAY_TESTNET` / `..._MAINNET` (fallback to ChainSafe). Add it to `/api/health`.
✅ Relay env config done: `lib/in-app-wallet.ts` reads env vars with ChainSafe fallback; `.env.example` updated; CSP already uses them.
**2.6 Scheduler:** a small container calling `/api/live` every minute and `/api/cron` daily with
`CRON_SECRET`. Then remove the Vercel cron and disable the GitHub keepalive workflow.
**2.7 Cloudflare:** proxy the domain; cache `/_next/static/*` and `/zcash/*` long-term (they are versioned);
never cache `/api/*` or HTML for signed-in users.
**2.8 Copies (owner declined paid backups):** nightly `pg_dump` kept on the server (7 days). Ask the owner
whether to also push an encrypted copy to Cloudflare R2's free tier; do it only if they say yes.
**2.9 Uptime:** a free external uptime check on `/` and `/api/health`.
**Done when** the app runs on the domain from the server, sign-in works for an existing user, contests settle
within a minute of ending, the wallet lab works through `relay.<domain>`, and Connections is all green.

### Phase 3: Send from the browser wallet (testnet)
**3.1** Owner funds the lab wallet from fauzec.com (address shown on `/wallet-lab`).
**3.2** Add "4. Send" to `/wallet-lab`: address, amount, memo; propose, sign, broadcast with zcash.js
(`wallet.send`, as in `services/anchor/cli.mjs`; unlock with the phrase via `wallet.accounts.restoreSigner`
and `attachSigner`, dispose signer after). Show each stage and timing; show the txid and explorer link.
✅ Send UI built: `lib/in-app-wallet.ts` has `sendZec` (restoreSigner → send → broadcast → wait); `/wallet-lab` has address/amount/memo form and step 4 button. Needs testnet funds to test.
**3.3** Find out whether Ironwood sends need any proving files beyond the bundled engine (Sapling params are
not copied yet; only copy them if a send needs them, and serve them versioned from `/zcash/`).
**Done when** a send from the browser confirms on the explorer, with the time it took recorded here.

### Phase 4: Background sync and storage that lasts
**4.1** Sync quietly while the app is open (on load, then every 1–2 minutes while visible), never blocking UI.
Show a small "Wallet up to date / Syncing" indicator in the wallet screen only.
**4.2** Call `navigator.storage.persist()` when the wallet is created; nudge iPhone users to Add to Home Screen
(Safari can delete site storage after 7 days without a visit).
**Done when** opening the app after a long break catches up in the background while the player uses other
screens, and storage is marked persistent where the browser allows.
✅ Done: `lib/wallet-sync.ts` (useWalletSync hook, 90s interval, visibility-aware, persist() on create), `components/wallet-status.tsx` indicator on Vault.

### Phase 5: The wallet inside the app
**5.1 Create at sign-up** (network-aware): after first sign-in, create the wallet, then require the backup step
before the wallet can receive prizes.
**5.2 Protect the phrase:** never store it in plain text (the lab does today; remove that). Encrypt with
WebCrypto AES-GCM using a key from a passkey (WebAuthn PRF) where supported, else a passcode via PBKDF2
(600,000+ iterations, random salt). Decrypt only in memory to sign, then wipe.
**5.3 Backup check:** show the 24 words once, then ask for 3 random words back.
**5.4 Encrypted cloud backup:** new migration with table `wallet_backups (user_id pk, network, ciphertext, iv,
salt, kdf, created_at)`, RLS so a user can only read/write their own row. Only ciphertext ever leaves the
device. Restore on a new device: sign in, enter passcode or use passkey, wallet returns.
**5.5 Vault wallet screen:** balance, receive address and QR, recent activity, "Move to Zashi" (send all to an
external address). Keep it to one screen.
**5.6 Profile address = in-app wallet address** automatically (players can still paste an external one).
**Done when** a fresh account gets a wallet, backs it up, sees a balance, and can restore it on a second
browser using only the passcode or passkey.
✅ Built: migration `20261128120000_wallet_backups.sql` (encrypted cloud backup table + RPCs), `lib/wallet-crypto.ts` (Argon2id + AES-GCM encrypt/decrypt, quiz), `components/wallet-setup.tsx` (passphrase → create → show phrase → quiz → verify), Vault shows in-app wallet card with balance/address/copy, Profile notes in-app wallet management.

### Phase 6: One-tap Pay winners
In the sponsor's Pay your winners panel, if the sponsor has an in-app wallet with enough balance, show
"Pay all winners" that builds one transaction with one output per winner (memo
`Called It · <title> · #<rank> prize`), signs it, sends it, and calls `sponsor_mark_sent` for each with the
txid automatically. Keep the external-wallet link/QR as the fallback.
**Done when** a sponsor pays two winners in one tap on testnet and both rows show the txid without pasting.
✅ Built: "Pay all winners" button in PayPanel (multi-output transaction with memos, auto sponsor_mark_sent), askConfirm before sending.

### Phase 7: Automatic prize detection
In the winner's wallet, after each sync, read received notes and their memos; when a memo matches a pending
prize of theirs (contest title and rank) with at least the expected amount, call `confirm_prize` for it
automatically and show "Prize received". **Done when** a paid winner never has to tap "I got it" and the
contest shows "✓ received" within a minute of the payment confirming.
Also give each prize a fresh receive address (Zcash diversified addresses from the same wallet), so one shared
address can't link a player's prizes together.
✅ Built: `lib/wallet-prizes.ts` (detectPrizes scans received memos after sync, auto-confirms matching prizes; freshPrizeAddress returns a diversified address). Integrated into wallet-sync after each sync.

### Phase 8: Security and launch
- Security review: RLS on every table, every `SECURITY DEFINER` function checks the caller, no secrets in the
  client bundle, phrase never leaves the device unencrypted, CSP on wallet pages, dependency pins.
- Terms and privacy pages (free entry, sponsors are responsible for their prizes, what data is stored).
- Remove legacy code once unused: Vault balance/withdrawals and the payout workflow, the old admin payout
  buttons, Zcash anchoring in `services/anchor` (seals now use Bitcoin), `/wallet-lab`.
- Mainnet: switch only after Phases 3 to 7 pass on testnet; start with small prizes; warn when an in-app
  wallet holds more than a small amount and suggest moving to Zashi.
✅ Terms and privacy pages built (`/terms`, `/privacy`), linked from the More sheet. Legacy removal and mainnet switch await testnet validation.

### Phase 9: Grant and community (owner, you draft)
- Draft the Zcash Community Grants forum proposal "Called It Wallet: in-app shielded payments for football
  fans": evidence (wallet created and synced in the browser, testnet payment proof), the plan above, budget
  (server ~€13–17/month, domain, security review).
- Short X updates per milestone, tagging @zcash and @ZecHub.

---

## 5. Definition of done for any change
- `npx tsc --noEmit` and `npx eslint app components lib` show no errors; `npx next build` passes.
- New SQL is a new migration file, passes `scripts/test-migrations.sh` with a test file covering the change,
  and leaves no ambiguous function overloads.
- UI uses app components (no browser dialogs), works at phone width, and adds no clutter.
- You tried it in a browser when it is a browser feature, and you report exactly what you verified.
- The commit message explains why, not just what.
