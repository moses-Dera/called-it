#!/usr/bin/env node
// Wallet CLI for Called It payouts on Zcash (Mainnet or Testnet).
// Uses zcash.js: light client with shielded unified addresses. No full node needed.
//
// Usage:
//   node cli.mjs init                 Generate wallet mnemonic & address
//   node cli.mjs address              Print wallet funding address
//   node cli.mjs balance              Sync chain tip & show spendable balance
//   node cli.mjs payouts              Pay all pending withdrawal requests
//   node cli.mjs contest-payout <id>  Pay ONLY winners of a specific contest (funds cannot leak!)
//
// Env vars:
//   ZCASH_NETWORK=mainnet | testnet   Switch network (default: testnet)
//   ANCHOR_MNEMONIC=...               (Optional) 24-word phrase (for ephemeral CI/GitHub Actions)
//   SUPABASE_URL=...                  Supabase project URL
//   SUPABASE_SECRET_KEY=...           Supabase service role secret key

import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { DATA, SERVER, NETWORK, IS_MAINNET, addressOf, describe, openWallet, readMnemonic, saveMnemonic, syncWithRetry, unlock, zec } from "./wallet.mjs";

const env = process.env;
const cmd = process.argv[2];
const arg = process.argv[3];
const coin = IS_MAINNET ? "ZEC" : "TAZ";

if (!["init", "address", "balance", "payouts", "contest-payout"].includes(cmd)) {
  console.log(`
Called It Zcash Wallet CLI [Network: ${NETWORK.toUpperCase()}]

Commands:
  node cli.mjs init                 Generate new wallet for ${NETWORK}
  node cli.mjs address              Show funding address (${coin})
  node cli.mjs balance              Check synced spendable balance
  node cli.mjs payouts              Pay all requested withdrawals in Supabase
  node cli.mjs contest-payout <id>  Pay only winners of contest <id>
`);
  process.exit(1);
}

const wallet = await openWallet();
try {
  let [account] = await wallet.accounts.list();

  // If running in CI or ephemeral container with mnemonic passed via env, restore account
  if (!account) {
    const phrase = env.ANCHOR_MNEMONIC?.trim() || env.ZCASH_MNEMONIC?.trim();
    if (phrase) {
      console.log(`Restoring ${NETWORK} wallet account from environment mnemonic…`);
      const mnemonic = new TextEncoder().encode(phrase);
      try {
        const created = await wallet.accounts.create({ mnemonic, name: `called-it-${NETWORK}` });
        await created.signer.dispose();
        account = created.account;
      } finally {
        mnemonic.fill(0);
      }
    }
  }

  if (cmd === "init") {
    if (account) throw new Error(`A wallet already exists in ${DATA}. Use "address" or "balance".`);
    console.log(`Syncing chain tip from ${SERVER}…`);
    const synced = await syncWithRetry(wallet);
    if (!synced.targetReached) throw new Error("Sync stopped before reaching the chain tip. Try again.");
    const phrase = generateMnemonic(wordlist, 256);
    const file = await saveMnemonic(phrase);
    const mnemonic = new TextEncoder().encode(phrase);
    try {
      const created = await wallet.accounts.create({ mnemonic, name: `called-it-${NETWORK}` });
      await created.signer.dispose();
      account = created.account;
    } finally {
      mnemonic.fill(0);
    }
    console.log(`\nWallet created on ${NETWORK.toUpperCase()}. Phrase saved in: ${file}`);
    console.log(`Notice: Keep this 24-word phrase safe. It controls your ${coin} payout funds.`);
  }

  if (!account) throw new Error(`No wallet in ${DATA}. Run "node cli.mjs init" or set ANCHOR_MNEMONIC.`);
  const addr = await addressOf(wallet, account.id);

  if (cmd === "address") {
    console.log(`\nFunding address [${NETWORK.toUpperCase()}]:\n${addr}\n`);
    console.log(`Send ${coin} here to fund the contest prize payouts.`);
  }

  if (cmd === "balance") {
    console.log(`\nSyncing ${NETWORK} chain tip from ${SERVER}…`);
    await syncWithRetry(wallet);
    const b = await wallet.getBalance({ accountId: account.id });
    if (!b.amounts) console.log("Balance not available yet.");
    else {
      console.log(`
--------------------------------------------------
 Network:   ${NETWORK.toUpperCase()}
 Address:   ${addr.slice(0, 20)}…${addr.slice(-10)}
 Total:     ${zec(b.amounts.total)} ${coin}
 Spendable: ${zec(b.amounts.ironwood.spendable)} ${coin}
 Pending:   ${zec(b.amounts.ironwood.pendingSpendability + b.amounts.ironwood.changePendingConfirmation)} ${coin}
--------------------------------------------------`);
    }
  }

  if (cmd === "payouts") {
    await payouts(account);
  }

  if (cmd === "contest-payout") {
    const contestId = arg || env.CONTEST_ID;
    if (!contestId) throw new Error("Specify contest ID: node cli.mjs contest-payout <contest_id> [rank]");
    const targetRank = process.argv[4] ? Number(process.argv[4]) : (env.WINNER_RANK ? Number(env.WINNER_RANK) : null);
    await contestPayout(account, contestId, targetRank);
  }
} catch (e) {
  console.error("\nError:", describe(e));
  process.exitCode = 1;
} finally {
  await wallet.close();
}

function getSupabase() {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  return (path, init = {}) =>
    fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
}

// Call a database function as the payout tool; throws with the server's message on failure.
async function rpc(api, name, args) {
  const r = await api(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Payouts go claim -> send -> mark paid. The claim is atomic, so a second run (or a double click) skips
// anything already claimed. A failed send is released for a later run; if marking paid fails after the
// ZEC went out, the payout stays 'sending' and is never sent again: settle it in the admin panel.

// The app decides the network (Admin > Payouts). Refuse to pay on a different one: an address from one
// network can't receive coins from the other.
async function checkNetwork(api) {
  const r = await api("app_settings?key=eq.network&select=value");
  if (!r.ok) throw new Error(`Could not read the app's network setting: ${r.status} ${await r.text()}`);
  const [row] = await r.json();
  const appNetwork = row?.value === "testnet" ? "testnet" : "mainnet";
  if (appNetwork !== NETWORK) throw new Error(`The app is set to ${appNetwork} but this run is on ${NETWORK}. Set ZCASH_NETWORK=${appNetwork} (or switch the network in Admin > Payouts).`);
}

// Pay all general requested withdrawals
async function payouts(account) {
  const api = getSupabase();
  await checkNetwork(api);
  const res = await api("withdrawals?status=eq.requested&order=created_at.asc&select=id,address,amount,user_id");
  if (!res.ok) throw new Error(`Could not list withdrawals: ${res.status} ${await res.text()}`);
  const list = await res.json();
  console.log(`\n${list.length} withdrawal request(s) waiting on ${NETWORK.toUpperCase()}.`);
  if (!list.length) return;

  const { signer, binding } = await unlock(wallet);
  try {
    for (const w of list) {
      const zats = BigInt(Math.round(Number(w.amount) * 1e8));
      let claimed = false;
      try { claimed = (await rpc(api, "payout_claim_withdrawal", { p_id: w.id })) === true; }
      catch (e) { console.error(`✗ Could not claim ${w.id}: ${describe(e)}`); continue; }
      if (!claimed) { console.log(`Skipping ${w.id}: another payout run already took it.`); continue; }
      let txid;
      try {
        await syncWithRetry(wallet);
        console.log(`Sending ${zec(zats)} ${coin} to ${w.address.slice(0, 16)}…`);
        const pending = await wallet.send({
          accountId: account.id,
          to: w.address,
          amount: zats,
          memo: { text: "Called It prize payout" },
          idempotencyKey: "payout-" + w.id,
        });
        txid = (await pending.snapshot()).steps.at(-1)?.txid;
      } catch (e) {
        console.error(`✗ Could not send ${w.id}: ${describe(e)}`);
        try { await rpc(api, "payout_release_withdrawal", { p_id: w.id }); console.error("  Released: it will be retried on the next run."); }
        catch (e2) { console.error(`  Could not release it (${describe(e2)}). It stays 'sending': check the wallet, then settle it in the admin panel.`); }
        continue;
      }
      try {
        if ((await rpc(api, "payout_finish_withdrawal", { p_id: w.id, p_txid: txid ? String(txid) : null })) !== true) throw new Error("not in 'sending' state");
        console.log(`✓ Paid ${zec(zats)} ${coin} — tx ${txid}`);
      } catch (e) {
        console.error(`!! SENT ${zec(zats)} ${coin} (tx ${txid}) but could not mark ${w.id} paid: ${describe(e)}. It stays 'sending' and will not be sent again. Mark it paid in the admin panel.`);
      }
    }
  } finally {
    await binding.dispose();
    await signer.dispose();
  }
}

// Pay winners of a specific contest (funds cannot leak to any other contest).
// Optional targetRank: pay ONLY 1st, 2nd, or 3rd place!
async function contestPayout(account, contestId, targetRank = null) {
  const api = getSupabase();
  await checkNetwork(api);
  const res = await api(`contests?id=eq.${contestId}&select=id,title,prize_zec,winners,status`);
  if (!res.ok) throw new Error(`Could not get contest: ${res.status}`);
  const [contest] = await res.json();
  if (!contest) throw new Error(`Contest "${contestId}" not found.`);
  if (contest.status !== "closed") throw new Error(`Contest "${contestId}" is not closed yet. Close it first.`);
  if (!Array.isArray(contest.winners) || !contest.winners.length) throw new Error(`Contest "${contestId}" has no winners.`);

  const targets = targetRank ? contest.winners.filter((w) => w.rank === targetRank) : contest.winners;
  if (!targets.length) throw new Error(`No winner found for rank ${targetRank} in contest "${contestId}".`);

  console.log(`\nProcessing payout for Contest: "${contest.title}" (${contest.id})`);
  if (targetRank) console.log(`Releasing payout ONLY for Rank #${targetRank}`);
  console.log(`Prize pot: ${contest.prize_zec} ${coin}`);

  const { signer, binding } = await unlock(wallet);
  try {
    for (const w of targets) {
      if (!w.zec || Number(w.zec) <= 0) continue;
      if (w.status === "paid") {
        console.log(`Winner #${w.rank} (${w.name}) is already marked paid (tx: ${w.txid}). Skipping.`);
        continue;
      }
      if (!w.address) {
        console.warn(`Winner #${w.rank} (${w.name}) has no registered withdrawal address. Skipping.`);
        continue;
      }
      const zats = BigInt(Math.round(Number(w.zec) * 1e8));
      let claimed = false;
      try { claimed = (await rpc(api, "payout_claim_winner", { p_contest_id: contest.id, p_rank: w.rank })) === true; }
      catch (e) { console.error(`✗ Winner #${w.rank}: ${describe(e)}`); continue; }
      if (!claimed) { console.log(`Skipping winner #${w.rank}: already paid or being paid by another run.`); continue; }
      let txid;
      try {
        await syncWithRetry(wallet);
        console.log(`Sending #${w.rank} (${w.name}) ${zec(zats)} ${coin} to ${w.address.slice(0, 16)}…`);
        const pending = await wallet.send({
          accountId: account.id,
          to: w.address,
          amount: zats,
          memo: { text: `Called It prize: ${contest.title} (#${w.rank})` },
          idempotencyKey: `contest-${contest.id}-rank-${w.rank}`,
        });
        txid = (await pending.snapshot()).steps.at(-1)?.txid;
      } catch (e) {
        console.error(`✗ Could not send to winner #${w.rank}: ${describe(e)}`);
        try { await rpc(api, "payout_release_winner", { p_contest_id: contest.id, p_rank: w.rank }); console.error("  Released: it will be retried on the next run."); }
        catch (e2) { console.error(`  Could not release it (${describe(e2)}). It stays 'sending': check the wallet, then settle it in the admin panel.`); }
        continue;
      }
      try {
        if ((await rpc(api, "payout_finish_winner", { p_contest_id: contest.id, p_rank: w.rank, p_txid: txid ? String(txid) : null })) !== true) throw new Error("not in 'sending' state");
        console.log(`✓ Winner #${w.rank} paid — tx ${txid}`);
      } catch (e) {
        console.error(`!! SENT ${zec(zats)} ${coin} to winner #${w.rank} (tx ${txid}) but could not mark it paid: ${describe(e)}. It stays 'sending' and will not be sent again. Mark it paid in the admin panel.`);
      }
    }
    console.log(`\n✓ Contest payout run completed.`);
  } finally {
    await binding.dispose();
    await signer.dispose();
  }
}
