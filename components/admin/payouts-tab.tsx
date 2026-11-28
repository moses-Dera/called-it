"use client";
import { useEffect, useRef, useState } from "react";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { askConfirm, askText } from "@/components/dialog";
import { zip321 } from "@/lib/zip321";
import { cloudRpc, refreshFundAddress, saveWalletBackup, useNetwork, usePointSettings, verifyWalletBackup } from "@/lib/cloud";
import { addressOf, balanceOf, createAccount, isPhrase, newPhrase, openWallet, savedPhrase, sendZec, syncWallet, zatsOf, zecOf } from "@/lib/in-app-wallet";
import { encryptPhrase } from "@/lib/wallet-crypto";
import { unlockWalletPhrase } from "@/lib/wallet-unlock";
import { short } from "@/lib/store";

export type WithdrawalRow = { id: string; address: string; amount: number; status: string; txid: string | null; created_at: string; name: string };
type Act = (name: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;

const field: React.CSSProperties = { height: 46, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 15, fontWeight: 600, minWidth: 0, width: "100%" };
const card: React.CSSProperties = { padding: 18, display: "flex", flexDirection: "column", gap: 12 };
const btn = (bg: string, fg = "#111"): React.CSSProperties => ({ minHeight: 42, padding: "0 16px", borderRadius: 14, border: "2px solid #111", background: bg, color: fg, fontWeight: 800, fontSize: 14 });
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Chip({ text, bg }: { text: string; bg: string }) {
  return <span style={{ fontSize: 11, fontWeight: 900, padding: "3px 9px", borderRadius: 999, background: bg, color: "#111", border: "1.5px solid #111" }}>{text}</span>;
}

function Tx({ id }: { id: string | null }) {
  return id ? <span className="mono">{short(id)}</span> : <span style={{ color: "#766f60" }}>—</span>;
}

export function AdminWalletCard({ network, act, onPayAll }: {
  network: string;
  act: Act;
  onPayAll: (wallet: WalletClient, phrase: string) => Promise<void>;
}) {
  const walletRef = useRef<WalletClient | null>(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreWords, setRestoreWords] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [logs, setLogs] = useState<{ text: string; bad?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const net = network as "mainnet" | "testnet";
  const coin = net === "mainnet" ? "ZEC" : "TAZ";

  const say = (text: string, bad = false) => setLogs((l) => [...l.slice(-40), { text, bad }]);

  const open = async () => {
    setBusy(true);
    try {
      const w = await openWallet(net);
      walletRef.current = w;
      const [acct] = await w.accounts.list();
      if (acct) {
        const addr = await addressOf(w, acct.id);
        setAddress(addr);
        const bal = await balanceOf(w, acct.id);
        if (bal) setBalance(`${zecOf(bal.spendable)} ${coin} spendable · ${zecOf(bal.total)} total`);
        say(`✓ Wallet opened (${addr.slice(0, 18)}…)`);
      } else {
        say("No account yet — create a new platform wallet or restore from 24 words.");
      }
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const setup = async () => {
    const p1 = await askText({ title: "Set wallet passphrase", body: "Encrypts your platform wallet backup to your account (min 8 chars).", placeholder: "Passphrase", confirmLabel: "Continue", type: "password" });
    if (!p1 || p1.length < 8) { if (p1 !== null) say("Passphrase must be at least 8 characters.", true); return; }
    setBusy(true);
    try {
      const p = savedPhrase(net) ?? newPhrase();
      const w = walletRef.current ?? await openWallet(net);
      walletRef.current = w;
      const acct = await createAccount(w, net, p, false);
      const addr = await addressOf(w, acct.id);
      const enc = await encryptPhrase(p, p1);
      await saveWalletBackup(net, enc.ciphertext, enc.iv, enc.salt, enc.kdf);
      await verifyWalletBackup(net);
      setAddress(addr);
      setPhrase(p);
      say(`✓ Platform wallet created & backed up. Fund address: ${addr.slice(0, 20)}…`);
      say("⚠ Write down your 24 recovery words below!");
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const restore = async () => {
    const clean = restoreWords.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isPhrase(clean)) { say("Enter a valid 24-word Zcash recovery phrase.", true); return; }
    if (pass1.length < 8 || pass1 !== pass2) { say("Passphrases must match and be at least 8 characters.", true); return; }
    setBusy(true);
    try {
      const w = walletRef.current ?? await openWallet(net);
      walletRef.current = w;
      const acct = await createAccount(w, net, clean, false);
      const addr = await addressOf(w, acct.id);
      const enc = await encryptPhrase(clean, pass1);
      await saveWalletBackup(net, enc.ciphertext, enc.iv, enc.salt, enc.kdf);
      await verifyWalletBackup(net);
      setAddress(addr);
      setPhrase(clean);
      setShowRestore(false);
      setRestoreWords(""); setPass1(""); setPass2("");
      say(`✓ Wallet restored & backed up (${addr.slice(0, 18)}…)`);
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const sync = async () => {
    if (!walletRef.current) { say("Open wallet first.", true); return; }
    setBusy(true); say("Syncing to chain tip…");
    try {
      await syncWallet(walletRef.current, (s) => {
        const st = s as { retrying?: number };
        if (st?.retrying) say(`Retrying sync (#${st.retrying})…`);
      });
      const [acct] = await walletRef.current.accounts.list();
      if (!acct) { say("No account yet.", true); setBusy(false); return; }
      const bal = await balanceOf(walletRef.current, acct.id);
      const display = bal ? `${zecOf(bal.spendable)} ${coin} spendable · ${zecOf(bal.total)} total` : `0 ${coin}`;
      setBalance(display);
      setSynced(true);
      say(`✓ Synced: ${display}`);
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  const payAll = async () => {
    if (!walletRef.current) { say("Open and sync wallet first.", true); return; }
    if (!synced) { say("Sync the wallet first to check balance.", true); return; }
    const p = phrase ?? await unlockWalletPhrase(net, "pay out prize winners");
    if (!p) return;
    setBusy(true);
    try { await onPayAll(walletRef.current, p); } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  return (
    <div className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, boxShadow: "4px 4px 0 var(--lime)" }}>
      <span className="eyebrow" style={{ color: "#5b6b12" }}>Platform Prize Wallet · {net === "mainnet" ? "Mainnet" : "Testnet"}</span>
      {address ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="display" style={{ fontSize: 24 }}>{balance || "Open — tap Sync to check balance"}</span>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>Fund address (send {coin} here to top up prizes)</div>
          <div className="mono" style={{ fontSize: 11, background: "#f7f3ea", border: "2px solid #111", borderRadius: 10, padding: "6px 10px", overflowWrap: "anywhere" }}>{address}</div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
          No wallet open yet. Open or set up a platform wallet to pay winners directly from this browser — no CLI needed.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn("#fff")} disabled={busy} onClick={open}>Open wallet</button>
        {!address && <button style={btn("var(--lime)")} disabled={busy} onClick={setup}>New platform wallet</button>}
        {!address && <button style={btn("#fff")} disabled={busy} onClick={() => setShowRestore((v) => !v)}>{showRestore ? "Cancel restore" : "Restore 24 words"}</button>}
        {address && <button style={btn("var(--lime)")} disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync & check balance"}</button>}
        {address && <button style={btn("#fff")} disabled={busy} onClick={async () => { await act("admin_set_setting", { p_key: "fund_address", p_value: address }, "Platform fund address updated."); refreshFundAddress(); }}>Set as fund address</button>}
        {address && synced && <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={payAll}>{busy ? "Sending…" : "⚡ Batch pay all pending"}</button>}
      </div>
      {showRestore && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "#f7f3ea", borderRadius: 14, border: "2px solid #111" }}>
          <textarea rows={2} style={{ ...field, height: "auto", padding: 10, fontSize: 13 }} placeholder="Enter 24 recovery words separated by spaces" value={restoreWords} onChange={(e) => setRestoreWords(e.target.value)} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="password" style={{ ...field, flex: 1, minWidth: 160 }} placeholder="New passphrase (min 8)" value={pass1} onChange={(e) => setPass1(e.target.value)} />
            <input type="password" style={{ ...field, flex: 1, minWidth: 160 }} placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </div>
          <button style={btn("#111", "var(--lime)")} disabled={busy} onClick={restore}>Restore & save backup</button>
        </div>
      )}
      {phrase && (
        <details style={{ fontSize: 12 }}>
          <summary style={{ fontWeight: 800, cursor: "pointer" }}>⚠ Show 24 recovery words (write these down!)</summary>
          <div className="mono" style={{ marginTop: 6, padding: "8px 10px", background: "#fff3cd", border: "2px solid #856404", borderRadius: 10, overflowWrap: "anywhere" }}>{phrase}</div>
        </details>
      )}
      {logs.length > 0 && (
        <pre style={{ background: "#000", color: "#cfe", padding: 10, borderRadius: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", margin: 0 }}>
          {logs.map((l, i) => <span key={i} style={{ color: l.bad ? "#f99" : "#cfe" }}>{l.text}{"\n"}</span>)}
        </pre>
      )}
    </div>
  );
}

export function PointSettingsCard({ act }: { act: Act }) {
  const network = useNetwork();
  const unit = network === "mainnet" ? "ZEC" : "TAZ";
  const { pointZec, generalGameZec, platformFeeBps } = usePointSettings();
  const [val, setVal] = useState(String(pointZec));
  const [feePct, setFeePct] = useState(String((platformFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")));
  useEffect(() => { setVal(String(pointZec)); }, [pointZec]);
  useEffect(() => { setFeePct(String((platformFeeBps / 100).toFixed(2).replace(/\.?0+$/, ""))); }, [platformFeeBps]);
  const num = Number(val);
  const feeBps = Math.round(Number(feePct) * 100);
  return (
    <section className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow" style={{ color: "#5b6b12" }}>Point rewards &amp; platform fee</span>
          <div style={{ fontSize: 13, color: "#4a4436", fontWeight: 600 }}>Set what 1 ranked point is worth in {unit}, whether general games earn {unit}, and the platform fee % on payouts.</div>
        </div>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "general_game_zec", p_value: generalGameZec ? "false" : "true" }, `General game ZEC rewards turned ${generalGameZec ? "OFF" : "ON"}.`)) refreshFundAddress(); }}
          style={{ ...btn(generalGameZec ? "var(--lime)" : "#fff"), minHeight: 38, fontSize: 12 }}>
          General games in {unit}: {generalGameZec ? "ON" : "OFF"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span>{unit} per point</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="0.00001" className="mono" style={{ ...field, width: 140, height: 38 }} />
        </label>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "point_zec", p_value: val }, `Updated: 1 point = ${val} ${unit}.`)) refreshFundAddress(); }} style={{ ...btn("#111", "var(--lime)"), minHeight: 38, fontSize: 13 }}>Save rate</button>
        <span style={{ fontSize: 12, color: "#4a4436", fontWeight: 700 }}>{Number.isFinite(num) && num >= 0 ? `50 pts = ${(50 * num).toFixed(5)} ${unit}` : "Enter a valid number (0 to 0.01)"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 6, borderTop: "2px dashed #d8cfb8" }}>
        <label style={{ fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Platform payout fee (%)</span>
          <input value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="0" className="mono" style={{ ...field, width: 90, height: 38 }} />
        </label>
        <button type="button" onClick={async () => { if (await act("admin_set_setting", { p_key: "platform_fee_bps", p_value: String(Number.isFinite(feeBps) ? feeBps : 0) }, `Updated platform payout fee to ${feePct || 0}%.`)) refreshFundAddress(); }} style={{ ...btn("#111", "var(--lime)"), minHeight: 38, fontSize: 13 }}>Save fee</button>
        <span style={{ fontSize: 12, color: "#4a4436", fontWeight: 700 }}>{Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= 2500 ? `Retained by platform on withdrawal (${feeBps} bps)` : "Enter 0% to 25%"}</span>
      </div>
    </section>
  );
}

export function PayoutsTab({ withdrawals, act, onReload }: { withdrawals: WithdrawalRow[]; act: Act; onReload?: () => void }) {
  const network = useNetwork();
  const [payMsg, setPayMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const net = network as "mainnet" | "testnet";
  const coin = net === "mainnet" ? "ZEC" : "TAZ";
  const walletRef = useRef<{ wallet: WalletClient; phrase: string } | null>(null);

  const getWalletAndPhrase = async () => {
    if (walletRef.current) return walletRef.current;
    try {
      const w = await openWallet(net);
      const p = await unlockWalletPhrase(net, "send this prize payment");
      if (!p) return null;
      walletRef.current = { wallet: w, phrase: p };
      return walletRef.current;
    } catch (e) { setPayMsg({ text: String(e), bad: true }); return null; }
  };

  // Batch-pay all pending withdrawals in a single shielded Zcash transaction!
  const handlePayAll = async (wallet: WalletClient, phrase: string) => {
    const pending = withdrawals.filter((w) => w.status === "requested" && Number(w.amount) > 0);
    if (pending.length === 0) { setPayMsg({ text: "No pending requests." }); return; }
    setPayMsg({ text: `Claiming ${pending.length} request(s)…` });
    const claimed: WithdrawalRow[] = [];
    for (const w of pending) {
      try {
        const ok = await cloudRpc<boolean>("payout_claim_withdrawal", { p_id: w.id });
        if (ok) claimed.push(w);
      } catch {}
    }
    if (claimed.length === 0) { setPayMsg({ text: "No unclaimed requests remaining.", bad: true }); return; }

    try {
      const [acct] = await wallet.accounts.list();
      if (!acct) throw new Error("No wallet account");
      const total = claimed.reduce((s, w) => s + Number(w.amount), 0);
      const bal = await balanceOf(wallet, acct.id);
      if (bal && bal.spendable <= zatsOf(total)) {
        throw new Error(`Not enough spendable ${coin} (have ${zecOf(bal.spendable)}, need ${total.toFixed(4)} + fee).`);
      }
      setPayMsg({ text: `Building 1 shielded batch transaction for ${claimed.length} player(s) (${total.toFixed(4)} ${coin})…` });
      const mnemonic = new TextEncoder().encode(phrase.trim().toLowerCase().replace(/\s+/g, " "));
      let signer;
      try {
        signer = await wallet.accounts.restoreSigner({ accountId: acct.id, mnemonic } as never);
      } finally { mnemonic.fill(0); }
      try {
        const payments = claimed.map((w) => ({
          to: w.address,
          amount: zatsOf(Number(w.amount)),
          memo: { text: `Called It prize: ${w.name}` },
        }));
        const tx = await wallet.send({ accountId: acct.id, signer, payments } as never);
        setPayMsg({ text: "Broadcasting shielded transaction…" });
        await tx.broadcast();
        setPayMsg({ text: "Waiting for network confirmation…" });
        const confirmed = await tx.wait({ timeoutMs: 300_000 });
        const txid = String(confirmed.transactions[0]?.txid ?? "");
        for (const w of claimed) {
          await cloudRpc<boolean>("payout_finish_withdrawal", { p_id: w.id, p_txid: txid });
        }
        setPayMsg({ text: `✓ Batch paid ${claimed.length} player(s)! txid: ${txid.slice(0, 20)}…` });
      } finally { await signer.dispose(); }
    } catch (e) {
      for (const w of claimed) {
        await cloudRpc<boolean>("payout_release_withdrawal", { p_id: w.id }).catch(() => null);
      }
      setPayMsg({ text: `✗ Batch payout failed (claims released): ${String(e)}`, bad: true });
    }
    if (onReload) onReload();
  };

  const handlePayOne = async (w: WithdrawalRow) => {
    const wp = await getWalletAndPhrase();
    if (!wp) return;
    setPayMsg({ text: `Claiming payout for ${w.name}…` });
    const claimed = await cloudRpc<boolean>("payout_claim_withdrawal", { p_id: w.id });
    if (!claimed) { setPayMsg({ text: "Already claimed by another process.", bad: true }); return; }
    try {
      setPayMsg({ text: `Sending ${w.amount} ${coin} to ${w.name}…` });
      const [acct] = await wp.wallet.accounts.list();
      if (!acct) throw new Error("No wallet account");
      const txid = await sendZec(wp.wallet, acct.id, wp.phrase, w.address, zatsOf(Number(w.amount)), `Called It prize: ${w.name}`, (s) => setPayMsg({ text: s }));
      await cloudRpc<boolean>("payout_finish_withdrawal", { p_id: w.id, p_txid: txid ?? "" });
      setPayMsg({ text: `✓ Paid! txid: ${txid?.slice(0, 20) ?? "—"}…` });
      if (onReload) onReload();
    } catch (e) {
      await cloudRpc<boolean>("payout_release_withdrawal", { p_id: w.id }).catch(() => null);
      setPayMsg({ text: `✗ Failed: ${String(e)}`, bad: true });
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Payouts</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Pay prize winners directly from your browser wallet — single or batched, no CLI needed.
          </p>
        </div>

        <div style={{ display: "flex", borderRadius: 12, border: "2px solid #111", overflow: "hidden", background: "#fff" }}>
          <button
            onClick={async () => { if (network !== "mainnet" && await askConfirm({ title: "Switch to mainnet?", body: "Prizes become real ZEC: winners need mainnet addresses and sponsors pay from mainnet wallets.", confirmLabel: "Switch to mainnet", danger: true })) { await act("admin_set_setting", { p_key: "network", p_value: "mainnet" }, "The app now runs on mainnet."); refreshFundAddress(); } }}
            style={{ padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800, background: network === "mainnet" ? "var(--lime)" : "#fff", color: "#111", cursor: "pointer" }}
          >Mainnet (ZEC)</button>
          <button
            onClick={async () => { if (network !== "testnet" && await askConfirm({ title: "Switch to testnet?", body: "For a practice run with test coins (TAZ). Players see a test-mode banner and only testnet addresses are accepted.", confirmLabel: "Switch to testnet" })) { await act("admin_set_setting", { p_key: "network", p_value: "testnet" }, "The app now runs on testnet (test mode)."); refreshFundAddress(); } }}
            style={{ padding: "6px 12px", border: 0, fontSize: 12, fontWeight: 800, background: network === "testnet" ? "var(--amber)" : "#fff", color: "#111", cursor: "pointer" }}
          >Testnet (TAZ)</button>
        </div>
      </div>

      <AdminWalletCard network={network} act={act} onPayAll={handlePayAll} />

      {payMsg && (
        <div role="status" style={{ padding: "10px 14px", borderRadius: 12, background: payMsg.bad ? "#ffefef" : "#f0fadc", border: `2px solid ${payMsg.bad ? "#ffb3b3" : "#c4e680"}`, color: payMsg.bad ? "#9a2d1d" : "#2d5200", fontSize: 13, fontWeight: 700 }}>
          {payMsg.text}
        </div>
      )}

      <PointSettingsCard act={act} />

      <h3 className="display" style={{ margin: 0, fontSize: 18 }}>Pending requests ({withdrawals.filter((w) => w.status === "requested").length})</h3>
      {withdrawals.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No requests yet.</p>}
      {withdrawals.map((w) => (
        <div key={w.id} className="paper" style={{ ...card, borderRadius: 20, borderWidth: 2, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="display" style={{ fontSize: 18 }}>{w.name} · {Number(w.amount).toFixed(4)} {coin}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>to <span className="mono">{short(w.address)}</span> · {time(w.created_at)} · tx <Tx id={w.txid} /></div>
          </div>
          <Chip text={w.status === "sending" ? "SENDING · CHECK WALLET" : w.status.toUpperCase()} bg={w.status === "paid" ? "var(--lime)" : w.status === "rejected" ? "var(--pink)" : "var(--amber)"} />
          {w.status === "sending" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436", flexBasis: "100%" }}>A payout run claimed this. Check your wallet history before acting: it will never be sent again automatically.</span>
              <button style={btn("#111", "var(--lime)")} onClick={async () => { const tx = await askText({ title: "Mark this payout as paid", body: "Only if your wallet shows it went out. Paste the transaction ID from your wallet.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark paid" }); if (tx !== null) act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>It was paid</button>
              <button style={btn("#fff")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "requested", p_txid: null }, "Back in the payout queue.")}>Not sent: retry later</button>
            </div>
          )}
          {w.status === "requested" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn("#111", "var(--lime)")} onClick={() => handlePayOne(w)}>⚡ Pay from wallet</button>
              <a href={zip321(w.address, Number(w.amount), "Called It prize payout")} style={{ ...btn("var(--lime)"), display: "inline-flex", alignItems: "center", fontSize: 12, textDecoration: "none" }}>Pay in Zashi ↗</a>
              <button style={btn("#111", "var(--lime)")} onClick={async () => { const tx = await askText({ title: `Mark ${w.name}'s withdrawal as paid`, body: "Only after you've sent it from your wallet. Paste the transaction ID if you have it.", placeholder: "Transaction ID (optional)", confirmLabel: "Mark paid" }); if (tx !== null) act("admin_mark_withdrawal", { p_id: w.id, p_status: "paid", p_txid: tx }, "Marked paid."); }}>Mark paid</button>
              <button style={btn("var(--pink)")} onClick={() => act("admin_mark_withdrawal", { p_id: w.id, p_status: "rejected", p_txid: null }, "Rejected.")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
