"use client";
// Development page for the in-app wallet (testnet only, not linked from the app). Proves a shielded wallet
// can be created, synced and read entirely in the browser before it is built into the real screens.
import { useRef, useState } from "react";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { addressOf, balanceOf, createAccount, newPhrase, openWallet, savedPhrase, syncWallet, zecOf } from "@/lib/in-app-wallet";

export default function WalletLab() {
  const [log, setLog] = useState<string[]>([]);
  const [address, setAddress] = useState(""), [balance, setBalance] = useState(""), [phrase, setPhrase] = useState(""), [busy, setBusy] = useState(false);
  const w = useRef<WalletClient | null>(null);
  const say = (m: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${m}`]);
  const fail = (e: unknown) => { const x = e as { code?: string; stage?: string; message?: string }; say(`✗ ${x.code ?? ""} ${x.stage ? `(${x.stage}) ` : ""}${x.message ?? String(e)}`); const st = (e as Error)?.stack?.split("\n").slice(1, 8).map((l) => l.replace(/https?:\/\/[^/]+\/_next\/static\/chunks\//, "").trim()).join("\n   "); if (st) say(`   ${st}`); };

  async function run(step: string, fn: () => Promise<void>) {
    setBusy(true); say(`→ ${step}`); const t = Date.now();
    try { await fn(); say(`✓ ${step} (${((Date.now() - t) / 1000).toFixed(1)}s)`); } catch (e) { fail(e); }
    setBusy(false);
  }
  const open = () => run("Open wallet storage", async () => {
    say(`secure context: ${globalThis.isSecureContext}, isolated (threads): ${globalThis.crossOriginIsolated}`);
    w.current ??= await openWallet("testnet");
    const [acct] = await w.current.accounts.list();
    say(acct ? `account found: ${acct.id}` : "no account yet");
    if (acct) setAddress(await addressOf(w.current, acct.id));
  });
  const create = () => run("Create account (syncs to the tip first)", async () => {
    w.current ??= await openWallet("testnet");
    const p = savedPhrase("testnet") ?? newPhrase();
    setPhrase(p);
    const acct = await createAccount(w.current, "testnet", p);
    setAddress(await addressOf(w.current, acct.id));
  });
  const sync = () => run("Sync and read balance", async () => {
    if (!w.current) throw new Error("Open the wallet first.");
    const s = await syncWallet(w.current, (x) => say(`status ${JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 200)}`));
    void s;
    const [acct] = await w.current.accounts.list();
    if (!acct) throw new Error("No account yet.");
    const b = await balanceOf(w.current, acct.id);
    setBalance(b ? `${zecOf(b.total)} TAZ total · ${zecOf(b.spendable)} spendable` : "not available yet");
  });

  const btn = { minHeight: 44, padding: "0 16px", borderRadius: 12, border: "2px solid #111", background: "var(--lime)", color: "#111", fontWeight: 800 } as const;
  return (
    <main className="screen wide" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      <h1 className="display" style={{ margin: 0 }}>Wallet lab (testnet)</h1>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Development only. Creates a testnet wallet that lives in this browser.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn} disabled={busy} onClick={open}>1. Open</button>
        <button style={btn} disabled={busy} onClick={create}>2. Create account</button>
        <button style={btn} disabled={busy} onClick={sync}>3. Sync + balance</button>
      </div>
      {address && <div className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>Address: {address}</div>}
      {balance && <div style={{ fontWeight: 800 }}>Balance: {balance}</div>}
      {phrase && <details><summary>Recovery phrase (testnet only)</summary><div className="mono" style={{ fontSize: 12 }}>{phrase}</div></details>}
      <pre data-testid="log" style={{ background: "#000", color: "#cfe", padding: 12, borderRadius: 12, fontSize: 12, whiteSpace: "pre-wrap", minHeight: 160 }}>{log.join("\n")}</pre>
    </main>
  );
}
