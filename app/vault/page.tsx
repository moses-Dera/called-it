"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img, SealStatus } from "@/components/ui";
import { MODES } from "@/lib/data";
import { BackupNudge } from "@/components/account";
import { askConfirm } from "@/components/dialog";
import { SponsorPrizes } from "@/components/sponsor-prizes";
import { WalletStatus } from "@/components/wallet-status";
import { WalletSetup } from "@/components/wallet-setup";
import { explorerTx } from "@/lib/explorer";
import { addressOf, createAccount, markWalletCreated, openWallet, sendZec, zatsOf } from "@/lib/in-app-wallet";
import { unlockWalletPhrase } from "@/lib/wallet-unlock";
import { requestWithdrawal, useCloud, useTipHistory, useNetwork } from "@/lib/cloud";
import { getWallet, hasWallet, triggerSync, useWalletSync, zecOf } from "@/lib/wallet-sync";
import { isShielded, saveProfile, short, totals, useStore, verifySeal, withdrawAll, type Seal } from "@/lib/store";

const MIN = 0.001;
const cover = (g: string) => MODES.find((m) => m.key === g)?.img ?? "cover_arena";

export default function Vault() {
  const s = useStore();
  const network = useNetwork();
  const t = totals(s);
  const [addr, setAddr] = useState(""), [msg, setMsg] = useState(""), [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const saved = s.profile.address;
  const [checks, setChecks] = useState<Record<string, string>>({});
  const signedIn = !!useCloud().session;
  const tips = useTipHistory();
  const hasInApp = hasWallet(network);
  const ws = useWalletSync(network, hasInApp, true);
  const [showSetup, setShowSetup] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState(""), [sendAmt, setSendAmt] = useState(""), [sendMemo, setSendMemo] = useState("");
  const [sendStatus, setSendStatus] = useState(""), [sendTx, setSendTx] = useState(""), [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false), [restoreMsg, setRestoreMsg] = useState("");

  async function restoreWallet() {
    setRestoreMsg("");
    try {
      const phrase = await unlockWalletPhrase(network, "restore your wallet on this device");
      if (!phrase) return;
      setRestoring(true);
      setRestoreMsg("Restoring your keys and syncing…");
      const w = await openWallet(network);
      const acct = await createAccount(w, network, phrase, false);
      const a = await addressOf(w, acct.id);
      markWalletCreated(network);
      if (a && !saved) saveProfile({ address: a });
      await triggerSync(network);
      setRestoreMsg("Wallet restored.");
    } catch (e) {
      setRestoreMsg((e as Error).message ?? "Could not restore wallet.");
    } finally {
      setRestoring(false);
    }
  }

  async function sendFromWallet() {
    const to = sendTo.trim();
    const amt = Number(sendAmt);
    const unit = network === "testnet" ? "TAZ" : "ZEC";
    if (!isShielded(to, network)) {
      return setSendStatus(network === "testnet" ? "Enter a valid testnet shielded address (utest1… or ztestsapling1…)." : "Enter a valid shielded Zcash address (u1… or zs1…).");
    }
    if (!Number.isFinite(amt) || amt <= 0) return setSendStatus("Enter an amount greater than 0.");
    const spendable = ws.balance?.spendable ?? BigInt(0);
    if (zatsOf(amt) >= spendable) return setSendStatus(`Not enough spendable ${unit} (remember a small network fee applies).`);
    const ok = await askConfirm({ title: `Send ${amt} ${unit}?`, body: `To ${short(to)} from your Called It wallet.`, confirmLabel: "Continue" });
    if (!ok) return;
    setSending(true); setSendTx(""); setSendStatus("Waiting for passphrase…");
    try {
      const phrase = await unlockWalletPhrase(network, `send ${amt} ${unit}`);
      if (!phrase) { setSendStatus(""); setSending(false); return; }
      const w = getWallet() ?? await openWallet(network);
      const [acct] = await w.accounts.list();
      if (!acct) throw new Error("No wallet account found on this device.");
      const txid = await sendZec(w, acct.id, phrase, to, zatsOf(amt), sendMemo.trim() || undefined, setSendStatus);
      setSendTx(txid);
      setSendStatus("Sent.");
      setSendAmt(""); setSendMemo("");
      triggerSync(network);
    } catch (e) {
      setSendStatus((e as Error).message ?? "Send failed.");
    } finally {
      setSending(false);
    }
  }

  // Auto-save wallet address to profile when in-app wallet is ready but no address saved
  useEffect(() => {
    if (hasInApp && ws.address && !saved) {
      saveProfile({ address: ws.address });
    }
  }, [hasInApp, ws.address, saved]);

  async function withdraw() {
    // Save the wallet first, so it is remembered even when there is nothing to withdraw yet.
    const to = saved || addr.trim();
    if (!to) return setMsg("Add your shielded wallet address first.");
    if (!isShielded(to, network)) return setMsg(network === "testnet" ? "That isn't a complete testnet shielded address (utest1… or ztestsapling1…). Copy it again from your wallet." : "That isn't a complete shielded address. Copy it again from your wallet: it starts with u1 or zs1.");
    const justSaved = !saved;
    if (justSaved) saveProfile({ address: to });
    if (!signedIn) return setMsg(`${justSaved ? "Wallet saved. " : ""}Sign in to request a payout. Prizes come only from ranked (server-checked) points.`);
    setMsg("Requesting…");
    try {
      const r = await requestWithdrawal(to);
      if (r.status === "too_small") return setMsg(`${justSaved ? "Wallet saved. " : ""}You need at least ${MIN} ZEC of ranked winnings to withdraw. You have ${(r.available ?? 0).toFixed(4)}.`);
      withdrawAll();
      setMsg(`Payout of ${Number(r.amount).toFixed(4)} testnet ZEC requested. It is sent from the prize wallet to ${short(to)}.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Request failed"); }
  }
  async function verify(x: Seal) {
    if (!x.move) return setChecks((p) => ({ ...p, [x.id]: "Sealed on another device. Unlock your move backup in Profile to check it here." }));
    const c = await verifySeal(x);
    setChecks((p) => ({ ...p, [x.id]: `${c.hashOk ? "✓ Seal matches your call" : "✗ Seal mismatch"} · ${c.anchored ? "✓ Stamped and locked" : "Stamp pending"}` }));
  }
  return (
    <main className="screen wide hub vault">
      <div className="vault-title" style={{ padding: "16px 18px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 className="display page-h1" style={{ margin: 0, fontSize: 34 }}>Vault</h1>
          <WalletStatus />
        </div>
        <BackupNudge what="winnings and proofs" />
      </div>

      <div className="vault-left">
        {/* In-app wallet */}
        {signedIn && !hasInApp && !showSetup && (
          <section style={{ padding: 18, borderRadius: 24, background: "var(--paper)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="eyebrow" style={{ color: "#5b6b12" }}>Called It wallet</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Get a shielded wallet built into the app. Prizes arrive here automatically.</span>
            <button className="btn" style={{ background: "var(--lime)", color: "#111", border: "2px solid #111" }} onClick={() => setShowSetup(true)}>Set up wallet</button>
            <button type="button" disabled={restoring} onClick={restoreWallet} style={{ background: "none", border: 0, padding: 0, fontSize: 12, fontWeight: 800, color: "#4a4436", textDecoration: "underline", cursor: "pointer", alignSelf: "flex-start" }}>
              {restoring ? "Restoring…" : "Already backed up? Restore on this device"}
            </button>
            {restoreMsg && <span style={{ fontSize: 12, fontWeight: 700, color: "#9a2d1d" }}>{restoreMsg}</span>}
          </section>
        )}
        {showSetup && !hasInApp && (
          <section style={{ padding: 18, borderRadius: 24, background: "var(--paper)", color: "#111", border: "3px solid #111" }}>
            <WalletSetup network={network} onDone={(a) => { setShowSetup(false); if (a && !saved) saveProfile({ address: a }); }} />
          </section>
        )}
        {hasInApp && (
          <section style={{ padding: 18, borderRadius: 24, background: "var(--paper)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--lime)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span className="eyebrow" style={{ color: "#5b6b12" }}>Called It wallet · shielded</span>
              {network === "testnet" && <span className="chip" style={{ background: "var(--amber)", color: "#111", border: 0 }}>TESTNET</span>}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="display" style={{ fontSize: 42 }}>{ws.balance ? zecOf(ws.balance.spendable) : "…"}</span>
              <b style={{ fontSize: 16 }}>{network === "testnet" ? "TAZ" : "ZEC"}</b>
            </div>
            {ws.missingAccount ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#4a4436", lineHeight: 1.45 }}>Wallet keys are missing from this browser&apos;s local storage. Restore from your encrypted backup or check again.</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" disabled={restoring} className="btn" style={{ background: "var(--lime)", color: "#111", border: "2px solid #111", flex: 1 }} onClick={restoreWallet}>{restoring ? "Restoring…" : "Restore wallet"}</button>
                  <button type="button" className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} onClick={() => triggerSync(network)}>Check again</button>
                </div>
                {restoreMsg && <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>{restoreMsg}</span>}
              </div>
            ) : ws.address ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800 }}>RECEIVE ADDRESS</span>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(ws.address!); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 12, padding: "8px 10px", fontSize: 12, textAlign: "left", overflowWrap: "anywhere", cursor: "pointer" }} className="mono">{ws.address}</button>
                <span style={{ fontSize: 11, color: "#4a4436" }}>{copied ? "Copied to clipboard" : "Tap to copy"}</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#4a4436", lineHeight: 1.45 }}>
                {ws.status === "error" ? `Could not reach sync server (${ws.error || "offline"}).` : "Opening your local shielded wallet…"}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>
                {ws.status === "error" ? "Sync paused · local wallet still works"
                  : ws.status === "syncing" ? "Syncing latest blocks…"
                  : ws.height ? `Synced to block ${ws.height.toLocaleString()}` : "Ready"}
              </span>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {!ws.missingAccount && ws.address && (
                  <button type="button" onClick={() => { setShowSend((v) => !v); setSendStatus(""); }} style={{ background: "none", border: 0, padding: 0, fontSize: 12, fontWeight: 800, textDecoration: "underline", color: "#111", cursor: "pointer" }}>
                    {showSend ? "Hide Send" : "Send / Move to Zashi"}
                  </button>
                )}
                {(ws.status === "error" || ws.status === "ready") && (
                  <button type="button" onClick={() => triggerSync(network)} style={{ background: "none", border: 0, padding: 0, fontSize: 12, fontWeight: 800, textDecoration: "underline", color: "#111", cursor: "pointer" }}>Sync now</button>
                )}
              </div>
            </div>
            {showSend && !ws.missingAccount && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "2px dashed #c9bfa6", paddingTop: 10 }}>
                <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={network === "testnet" ? "Recipient utest1… address" : "Recipient Zashi u1… address"} autoComplete="off" spellCheck={false} className="mono" style={{ height: 42, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 10px", fontSize: 12 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder={`Amount (${network === "testnet" ? "TAZ" : "ZEC"})`} inputMode="decimal" style={{ flex: 1, height: 42, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 10px", fontSize: 14, fontWeight: 700, minWidth: 0 }} />
                  <input value={sendMemo} onChange={(e) => setSendMemo(e.target.value)} placeholder="Memo (optional)" maxLength={200} style={{ flex: 1.4, height: 42, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 10px", fontSize: 13, minWidth: 0 }} />
                </div>
                <button type="button" disabled={sending} onClick={sendFromWallet} className="btn" style={{ background: "#111", color: "var(--lime)", border: 0, minHeight: 42 }}>
                  {sending ? "Sending…" : "Send shielded ZEC"}
                </button>
                {sendStatus && <span style={{ fontSize: 12, fontWeight: 700, color: sendTx ? "#3d6b00" : "#4a4436" }}>{sendStatus}</span>}
                {sendTx && <a href={explorerTx(sendTx, network)} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, color: "#111", textDecoration: "underline", overflowWrap: "anywhere" }}>View transaction {sendTx.slice(0, 18)}… ↗</a>}
              </div>
            )}
          </section>
        )}

        {!hasInApp && (t.available <= 0 ? (
        <section className="vault-bal" style={{ borderRadius: 24, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Your wallet</span>
          <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>Contest prizes are paid straight to this shielded address by whoever runs the contest.</span>
          {saved ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--paper)", border: "2px solid #111", borderRadius: 14, padding: "8px 12px" }}>
              <div className="mono" style={{ fontSize: 13 }}>{short(saved)}</div>
              <Link href="/profile" style={{ fontSize: 13, fontWeight: 800, textDecoration: "underline", minHeight: 44, display: "flex", alignItems: "center" }}>Change</Link>
            </div>
          ) : (
            <Link href="/profile" className="btn" style={{ background: "#111", color: "var(--amber)", border: 0 }}>Add your wallet address</Link>
          )}
        </section>
        ) : (
        <section className="vault-bal" style={{ borderRadius: 24, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Prize balance</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="display" style={{ fontSize: 44 }}>{t.available.toFixed(4)}</span><b style={{ fontSize: 18 }}>ZEC</b></div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t.ranked} ranked · {t.points - t.ranked} practice points</div>
          {saved ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--paper)", border: "2px solid #111", borderRadius: 14, padding: "8px 12px" }}>
              <div><div style={{ fontSize: 11, fontWeight: 800 }}>SAVED WALLET</div><div className="mono" style={{ fontSize: 13 }}>{short(saved)}</div></div>
              <Link href="/profile" style={{ fontSize: 13, fontWeight: 800, textDecoration: "underline", minHeight: 44, display: "flex", alignItems: "center" }}>Change</Link>
            </div>
          ) : (
            <>
              <label htmlFor="addr" style={{ fontSize: 12, fontWeight: 800 }}>Your Zcash wallet address. Saved for next time.</label>
              <input id="addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste your address" autoComplete="off" spellCheck={false} className="mono" style={{ height: 46, borderRadius: 14, border: "2px solid #111", background: "var(--paper)", color: "#111", padding: "0 12px", fontSize: 13 }} />
            </>
          )}
          <button className="btn" style={{ background: "#111", color: "var(--amber)", border: 0, fontSize: 16 }} onClick={withdraw}>{saved ? "Withdraw privately" : "Save wallet and withdraw"}</button>
          {msg && <div role="status" style={{ fontSize: 12, fontWeight: 700 }}>{msg}</div>}
        </section>
        ))}

        <SponsorPrizes />

        <section className="vault-rewards" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Rewards</h2>
          {s.ledger.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Win a game and your reward lands here.</div>}
          {s.ledger.slice(0, 5).map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{r.label}</span><b style={{ color: "var(--lime)", whiteSpace: "nowrap" }}>+{r.points} pts · {r.zec.toFixed(4)}</b>
            </div>
          ))}
        </section>

        {tips && tips.length > 0 && (
          <section className="vault-tips" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Tips</h2>
            {tips.slice(0, 10).map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{t.direction === "sent" ? `To ${t.other_name}` : `From ${t.other_name}`}{t.message ? ` — "${t.message}"` : ""}</span>
                <b style={{ color: t.direction === "sent" ? "var(--amber)" : "var(--lime)", whiteSpace: "nowrap" }}>{t.direction === "sent" ? "−" : "+"}{Number(t.amount).toFixed(4)}</b>
              </div>
            ))}
          </section>
        )}
      </div>

      <section className="vault-proofs">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 className="display" style={{ margin: 0, fontSize: 22 }}>My proofs</h2><span style={{ fontSize: 12, color: "var(--muted)" }}>Tap to inspect</span></div>
        {s.seals.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Every seal you make shows up here with its proof.</div>}
        {s.seals.slice(0, 12).map((x) => (
          <div key={x.id} className="paper" style={{ borderWidth: 2, borderRadius: 18, padding: "10px 12px" }}>
            <button onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: 0, padding: 0, textAlign: "left", color: "#111", minHeight: 44 }}>
              <Img n={cover(x.game)} size={36} style={{ borderRadius: 10, border: "2px solid #111" }} />
              <b style={{ flex: 1, fontSize: 14 }}>{x.label}</b><SealStatus seal={x} />
            </button>
            {open === x.id && (
              <div className="mono" style={{ fontSize: 11, color: "#4a4436", lineHeight: 1.7, marginTop: 8, overflowWrap: "anywhere" }}>
                sealed {new Date(x.sealedAt).toISOString().slice(0, 19).replace("T", " ")} UTC<br />fingerprint {short(x.commitment)}
                {x.root && <><br />batch {short(x.root)} · {x.proof?.length ?? 0} proof steps<br />Bitcoin block {x.height?.toLocaleString() ?? "pending"}{x.txid ? <> · tx {short(x.txid)}</> : null}</>}
                <br /><button onClick={() => verify(x)} style={{ marginTop: 6, minHeight: 36, padding: "0 12px", borderRadius: 10, border: "2px solid #111", background: "var(--lime)", fontWeight: 800, fontSize: 12 }}>Verify now</button>
                {checks[x.id] && <div style={{ marginTop: 6, fontWeight: 700 }}>{checks[x.id]}</div>}
              </div>
            )}
          </div>
        ))}
      </section>
      <BottomNav active="/vault" />
    </main>
  );
}
