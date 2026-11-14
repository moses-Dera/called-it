#!/usr/bin/env node
// Wallet setup for the anchor service.
//   node cli.mjs init     create the testnet wallet (once) and print its address to fund
//   node cli.mjs address  print the funding address
//   node cli.mjs balance  sync and print the balance
//   node cli.mjs payouts  pay requested withdrawals (needs SUPABASE_URL and SUPABASE_SECRET_KEY)
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { DATA, SERVER, addressOf, describe, openWallet, saveMnemonic, unlock, zec } from "./wallet.mjs";

const cmd = process.argv[2];
if (!["init", "address", "balance", "payouts"].includes(cmd)) {
  console.log("Usage: node cli.mjs init | address | balance | payouts");
  process.exit(1);
}

const wallet = await openWallet();
try {
  let [account] = await wallet.accounts.list();

  if (cmd === "init") {
    if (account) throw new Error(`A wallet already exists in ${DATA}. Use "address" or "balance".`);
    console.log(`Syncing chain tip from ${SERVER}…`);
    const synced = await wallet.sync();
    if (!synced.targetReached) throw new Error("Sync stopped before reaching the chain tip. Try again.");
    const phrase = generateMnemonic(wordlist, 256);
    const file = await saveMnemonic(phrase); // refuses to overwrite an existing phrase
    const mnemonic = new TextEncoder().encode(phrase);
    try {
      const created = await wallet.accounts.create({ mnemonic, name: "called-it-anchor" });
      await created.signer.dispose();
      account = created.account;
    } finally {
      mnemonic.fill(0);
    }
    console.log(`\nWallet created. Its 24-word phrase is saved in ${file} (readable only by you).`);
    console.log("This is a TESTNET wallet. Never send real ZEC to it.");
  }

  if (!account) throw new Error(`No wallet in ${DATA}. Run "node cli.mjs init" first.`);
  console.log(`\nFunding address (testnet, Ironwood):\n${await addressOf(wallet, account.id)}`);

  if (cmd === "balance") {
    console.log("\nSyncing… (the first run scans from the wallet's birthday and can take a few minutes)");
    await wallet.sync();
    const b = await wallet.getBalance({ accountId: account.id });
    if (!b.amounts) console.log("Balance not available yet.");
    else console.log(`Total ${zec(b.amounts.total)} TAZ · spendable ${zec(b.amounts.ironwood.spendable)} · waiting for confirmations ${zec(b.amounts.ironwood.pendingSpendability + b.amounts.ironwood.changePendingConfirmation)}`);
  }

  if (cmd === "payouts") await payouts(account);
} catch (e) {
  console.error("\nError:", describe(e));
  process.exitCode = 1;
} finally {
  await wallet.close();
}

// Pays every "requested" withdrawal from this wallet and marks it paid. Runs on demand, with a
// Supabase secret key that must never reach the browser or the web app.
async function payouts(account) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (Project Settings > API keys > secret key).");
  const api = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers } });
  const res = await api("withdrawals?status=eq.requested&order=created_at.asc&select=id,address,amount");
  if (!res.ok) throw new Error(`Could not list withdrawals: ${res.status} ${await res.text()}`);
  const list = await res.json();
  console.log(`\n${list.length} withdrawal request(s) waiting.`);
  if (!list.length) return;
  const { signer, binding } = await unlock(wallet);
  try {
    for (const w of list) {
      const zats = BigInt(Math.round(Number(w.amount) * 1e8));
      try {
        await wallet.sync();
        const pending = await wallet.send({ accountId: account.id, to: w.address, amount: zats, memo: { text: "Called It prize payout" }, idempotencyKey: "payout-" + w.id });
        const txid = (await pending.snapshot()).steps.at(-1)?.txid;
        await api(`withdrawals?id=eq.${w.id}`, { method: "PATCH", body: JSON.stringify({ status: "paid", txid: txid ? String(txid) : null }) });
        console.log(`Paid ${zec(zats)} TAZ to ${w.address.slice(0, 14)}… tx ${txid}`);
      } catch (e) {
        console.error(`Could not pay ${w.id}: ${describe(e)} (left as requested)`);
      }
    }
  } finally {
    await binding.dispose();
    await signer.dispose();
  }
}
