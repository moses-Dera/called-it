"use client";
// Development page for the in-app wallet (testnet only, not linked from the app). Proves a shielded wallet
// can be created, synced and read entirely in the browser before it is built into the real screens.
import { useEffect, useRef, useState } from "react";
import { cloudRpc, useCloud } from "@/lib/cloud";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { addressOf, balanceOf, createAccount, newPhrase, openWallet, savedPhrase, sendZec, syncWallet, zatsOf, zecOf } from "@/lib/in-app-wallet";

// On the live site only the admin can open this page; everyone else sees "Page not found".
export default function WalletLab() {
  const uid = useCloud().session?.user.id;
  const dev = process.env.NODE_ENV !== "production";
  const [admin, setAdmin] = useState<boolean | null>(dev ? true : null);
  useEffect(() => {
    if (dev) return;
    if (!uid) { setAdmin(false); return; }
    cloudRpc<{ is_admin: boolean }>("admin_status").then((s) => setAdmin(s.is_admin), () => setAdmin(false));
  }, [uid, dev]);
  if (admin === null) return null;
  if (!admin) return <main className="screen" style={{ padding: 24 }}><h1 className="display" style={{ margin: 0 }}>Page not found</h1></main>;
  return <Lab />;
}

function Lab() {
  const [log, setLog] = useState<string[]>([]);
  const [height, setHeight] = useState<number | null>(null), [secs, setSecs] = useState<number | null>(null);
  const [address, setAddress] = useState(""), [balance, setBalance] = useState(""), [phrase, setPhrase] = useState(""), [busy, setBusy] = useState(false);
  const [sendTo, setSendTo] = useState(""), [sendAmt, setSendAmt] = useState(""), [sendMemo, setSendMemo] = useState(""), [txid, setTxid] = useState("");
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
    const acct = await createAccount(w.current, "testnet", p, true); // admin dev page: save plain for inspection
    setAddress(await addressOf(w.current, acct.id));
  });
  const sync = () => run("Sync and read balance", async () => {
    if (!w.current) throw new Error("Open the wallet first.");
    const t0 = Date.now();
    const s = await syncWallet(w.current, (x) => say(`status ${JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 200)}`)) as { scan?: { fullyScannedHeight?: number } };
    setHeight(s?.scan?.fullyScannedHeight ?? null); setSecs(Math.round((Date.now() - t0) / 1000));
    const [acct] = await w.current.accounts.list();
    if (!acct) throw new Error("No account yet.");
    const b = await balanceOf(w.current, acct.id);
    setBalance(b ? `${zecOf(b.total)} TAZ total · ${zecOf(b.spendable)} spendable` : "not available yet");
  });

  const send = () => run("Send shielded ZEC", async () => {
    if (!w.current) throw new Error("Open the wallet first.");
    if (!phrase) throw new Error("No phrase available. Create account first.");
    if (!sendTo.trim()) throw new Error("Enter a destination address.");
    const amt = parseFloat(sendAmt);
    if (!amt || amt <= 0) throw new Error("Enter a valid amount.");
    const [acct] = await w.current.accounts.list();
    if (!acct) throw new Error("No account yet.");
    say(`Sending ${amt} TAZ to ${sendTo.slice(0, 20)}…`);
    const id = await sendZec(w.current, acct.id, phrase, sendTo.trim(), zatsOf(amt), sendMemo.trim() || undefined, say);
    if (id) { setTxid(id); say(`txid: ${id}`); } else say("Send completed (no txid returned)");
  });

  const btn = { minHeight: 44, padding: "0 16px", borderRadius: 12, border: "2px solid #111", background: "var(--lime)", color: "#111", fontWeight: 800 } as const;
  const inp = { minHeight: 40, padding: "6px 10px", borderRadius: 10, border: "2px solid #111", background: "#fff", color: "#111", fontSize: 13, width: "100%" } as const;
  return (
    <main className="screen wide" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      <h1 className="display" style={{ margin: 0 }}>Wallet lab (testnet)</h1>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Development only. Creates a testnet wallet that lives in this browser.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn} disabled={busy} onClick={open}>1. Open</button>
        <button style={btn} disabled={busy} onClick={create}>2. Create account</button>
        <button style={btn} disabled={busy} onClick={sync}>3. Sync + balance</button>
        <button style={btn} disabled={busy || !address} onClick={send}>4. Send</button>
      </div>
      {address && (
        <section style={{ background: "var(--paper)", color: "#111", border: "3px solid #111", boxShadow: "6px 6px 0 var(--lime)", borderRadius: 26, padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="eyebrow" style={{ color: "#5b6b12" }}>Your Called It wallet · shielded</span>
            <span className="chip" style={{ background: "var(--amber)", color: "#111", border: 0 }}>TESTNET</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="display" style={{ fontSize: 44 }}>{balance ? balance.split(" ")[0] : "…"}</span><b style={{ fontSize: 18 }}>TAZ</b>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800 }}>Receive address (Ironwood)</span>
            <span className="mono" style={{ fontSize: 12, overflowWrap: "anywhere", background: "#fff", border: "2px solid #111", borderRadius: 12, padding: "8px 10px" }}>{address}</span>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, fontWeight: 700 }}>
            <span>{height ? `✓ Synced to block ${height.toLocaleString()}` : "Not synced yet"}{secs != null ? ` in ${secs}s` : ""}</span>
            <span>🔒 Keys stay on this device</span>
          </div>
        </section>
      )}
      {address && (
        <section style={{ background: "var(--paper)", border: "2px solid #111", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
          <span className="eyebrow">Send shielded TAZ</span>
          <input style={inp} placeholder="Destination address (u…)" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inp, maxWidth: 120 }} placeholder="Amount" type="number" step="0.0001" min="0" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} />
            <input style={inp} placeholder="Memo (optional)" value={sendMemo} onChange={(e) => setSendMemo(e.target.value)} />
          </div>
          {txid && <div style={{ fontSize: 12, overflowWrap: "anywhere" }}><b>Last txid:</b> <span className="mono">{txid}</span></div>}
        </section>
      )}
      {phrase && <details><summary>Recovery phrase (testnet only)</summary><div className="mono" style={{ fontSize: 12 }}>{phrase}</div></details>}
      <pre data-testid="log" style={{ background: "#000", color: "#cfe", padding: 12, borderRadius: 12, fontSize: 12, whiteSpace: "pre-wrap", minHeight: 160 }}>{log.join("\n")}</pre>
    </main>
  );
}
