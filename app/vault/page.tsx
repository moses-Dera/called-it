"use client";
import Link from "next/link";
import { useState } from "react";
import { BottomNav, Img, SealStatus } from "@/components/ui";
import { MODES } from "@/lib/data";
import { isShielded, saveProfile, short, totals, useStore, verifySeal, withdrawAll, type Seal } from "@/lib/store";

const MIN = 0.001;
const cover = (g: string) => MODES.find((m) => m.key === g)?.img ?? "cover_arena";

export default function Vault() {
  const s = useStore();
  const t = totals(s);
  const [addr, setAddr] = useState(""), [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const saved = s.profile.address;
  const [checks, setChecks] = useState<Record<string, string>>({});

  function withdraw() {
    // Save the wallet first, so it is remembered even when there is nothing to withdraw yet.
    const to = saved || addr.trim();
    if (!to) return setMsg("Add your shielded wallet address first.");
    if (!isShielded(to)) return setMsg("Paste a shielded address (it starts with u1 or utest1).");
    const justSaved = !saved;
    if (justSaved) saveProfile({ address: to });
    if (t.available < MIN) return setMsg(`${justSaved ? "Wallet saved. " : ""}You need at least ${MIN} ZEC to withdraw. Keep playing!`);
    withdrawAll(); setMsg("Withdrawal requested. Testnet payouts are sent once the prize wallet is connected.");
  }
  async function verify(x: Seal) {
    const c = await verifySeal(x);
    setChecks((p) => ({ ...p, [x.id]: `${c.hashOk ? "✓ hash matches move + salt" : "✗ hash mismatch"} · ${c.anchored ? "✓ Merkle proof reaches anchored root" : "not anchored yet"}` }));
  }
  return (
    <main className="screen">
      <div style={{ padding: "18px 20px 12px" }}><h1 className="display" style={{ margin: 0, fontSize: 34 }}>Vault</h1></div>
      <section style={{ margin: "0 20px", borderRadius: 26, background: "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="eyebrow">Prize balance · testnet</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="display" style={{ fontSize: 46 }}>{t.available.toFixed(4)}</span><b style={{ fontSize: 18 }}>ZEC</b></div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{t.points} points · {s.ledger.length} reward{s.ledger.length === 1 ? "" : "s"} · testnet ZEC has no real value</div>
        {saved ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--paper)", border: "2px solid #111", borderRadius: 14, padding: "8px 12px" }}>
            <div><div style={{ fontSize: 11, fontWeight: 800 }}>SAVED WALLET</div><div className="mono" style={{ fontSize: 13 }}>{short(saved)}</div></div>
            <Link href="/profile" style={{ fontSize: 13, fontWeight: 800, textDecoration: "underline", minHeight: 44, display: "flex", alignItems: "center" }}>Change</Link>
          </div>
        ) : (
          <>
            <label htmlFor="addr" style={{ fontSize: 12, fontWeight: 800 }}>Your shielded address (from Zodl). Saved for next time.</label>
            <input id="addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="u1…" autoComplete="off" spellCheck={false} className="mono" style={{ height: 46, borderRadius: 14, border: "2px solid #111", background: "var(--paper)", color: "#111", padding: "0 12px", fontSize: 13 }} />
          </>
        )}
        <button className="btn" style={{ background: "#111", color: "var(--amber)", border: 0, fontSize: 16 }} onClick={withdraw}>{saved ? "Withdraw privately" : "Save wallet and withdraw"}</button>
        {msg && <div role="status" style={{ fontSize: 12, fontWeight: 700 }}>{msg}</div>}
      </section>

      <section style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Rewards</h2>
        {s.ledger.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Win a game and your reward lands here.</div>}
        {s.ledger.slice(0, 5).map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span><b style={{ color: "var(--lime)", whiteSpace: "nowrap" }}>+{r.points} pts · {r.zec.toFixed(4)}</b>
          </div>
        ))}
      </section>

      <section style={{ padding: "20px 20px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
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
                sealed {new Date(x.sealedAt).toISOString().slice(0, 19).replace("T", " ")} UTC<br />hash {short(x.commitment)}
                {x.root && <><br />batch root {short(x.root)} · {x.proof?.length ?? 0} proof steps<br />block {x.height?.toLocaleString()} · tx {short(x.txid)} ({x.mode})</>}
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
