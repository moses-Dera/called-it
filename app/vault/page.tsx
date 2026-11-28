"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img, SealStatus } from "@/components/ui";
import { MODES } from "@/lib/data";
import { BackupNudge } from "@/components/account";
import { SponsorPrizes } from "@/components/sponsor-prizes";
import { WalletStatus } from "@/components/wallet-status";
import { WalletSetup } from "@/components/wallet-setup";
import { requestWithdrawal, useCloud, useTipHistory, useNetwork } from "@/lib/cloud";
import { hasWallet } from "@/lib/wallet-sync";
import { useWalletSync, zecOf } from "@/lib/wallet-sync";
import { isShielded, saveProfile, short, totals, useStore, verifySeal, withdrawAll, type Seal } from "@/lib/store";

const MIN = 0.001;
const cover = (g: string) => MODES.find((m) => m.key === g)?.img ?? "cover_arena";

export default function Vault() {
  const s = useStore();
  const network = useNetwork();
  const t = totals(s);
  const [addr, setAddr] = useState(""), [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const saved = s.profile.address;
  const [checks, setChecks] = useState<Record<string, string>>({});
  const signedIn = !!useCloud().session;
  const tips = useTipHistory();
  const hasInApp = hasWallet(network);
  const ws = useWalletSync(network, hasInApp);
  const [showSetup, setShowSetup] = useState(false);

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
      <div className="vault-title" style={{ padding: "18px 20px 12px", display: "flex", flexDirection: "column", gap: 12 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h1 className="display" style={{ margin: 0, fontSize: 34 }}>Vault</h1><WalletStatus /></div><BackupNudge what="winnings and proofs" /></div>

      {/* In-app wallet */}
      {signedIn && !hasInApp && !showSetup && (
        <section style={{ margin: "0 20px", padding: 18, borderRadius: 20, background: "var(--paper)", border: "2px solid #111", display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Called It wallet</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Get a shielded wallet built into the app. Prizes arrive here automatically.</span>
          <button className="btn" style={{ background: "var(--lime)", color: "#111", border: "2px solid #111" }} onClick={() => setShowSetup(true)}>Set up wallet</button>
        </section>
      )}
      {showSetup && !hasInApp && (
        <section style={{ margin: "0 20px", padding: 18, borderRadius: 20, background: "var(--paper)", border: "2px solid #111" }}>
          <WalletSetup network={network} onDone={(a) => { setShowSetup(false); if (a && !saved) saveProfile({ address: a }); }} />
        </section>
      )}
      {hasInApp && ws.address && (
        <section style={{ margin: "0 20px", padding: 18, borderRadius: 22, background: "var(--paper)", border: "3px solid #111", boxShadow: "5px 5px 0 var(--lime)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="eyebrow" style={{ color: "#5b6b12" }}>Called It wallet · shielded</span>
            {network === "testnet" && <span className="chip" style={{ background: "var(--amber)", color: "#111", border: 0 }}>TESTNET</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="display" style={{ fontSize: 42 }}>{ws.balance ? zecOf(ws.balance.spendable) : "…"}</span>
            <b style={{ fontSize: 16 }}>{network === "testnet" ? "TAZ" : "ZEC"}</b>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800 }}>RECEIVE ADDRESS</span>
            <button onClick={() => navigator.clipboard.writeText(ws.address!)} style={{ background: "#fff", border: "2px solid #111", borderRadius: 12, padding: "8px 10px", fontSize: 12, textAlign: "left", overflowWrap: "anywhere", cursor: "pointer" }} className="mono">{ws.address}</button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Tap to copy</span>
          </div>
          {ws.height && <span style={{ fontSize: 12, fontWeight: 700 }}>Synced to block {ws.height.toLocaleString()}</span>}
        </section>
      )}

      {!hasInApp && (t.available <= 0 ? (
      <section className="vault-bal" style={{ margin: "0 20px", borderRadius: 26, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
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
      <section className="vault-bal" style={{ margin: "0 20px", borderRadius: 26, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="eyebrow">Prize balance</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="display" style={{ fontSize: 46 }}>{t.available.toFixed(4)}</span><b style={{ fontSize: 18 }}>ZEC</b></div>
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

      <section className="vault-rewards" style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Rewards</h2>
        {s.ledger.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Win a game and your reward lands here.</div>}
        {s.ledger.slice(0, 5).map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span><b style={{ color: "var(--lime)", whiteSpace: "nowrap" }}>+{r.points} pts · {r.zec.toFixed(4)}</b>
          </div>
        ))}
      </section>

      {tips && tips.length > 0 && (
        <section style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Tips</h2>
          {tips.slice(0, 10).map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{t.direction === "sent" ? `To ${t.other_name}` : `From ${t.other_name}`}{t.message ? ` — "${t.message}"` : ""}</span>
              <b style={{ color: t.direction === "sent" ? "var(--amber)" : "var(--lime)", whiteSpace: "nowrap" }}>{t.direction === "sent" ? "−" : "+"}{Number(t.amount).toFixed(4)}</b>
            </div>
          ))}
        </section>
      )}

      <section className="vault-proofs" style={{ padding: "20px 20px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
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
