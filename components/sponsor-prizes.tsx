"use client";
import { useState } from "react";
import { confirmPrize, syncNow, useMySponsorPrizes, useNetwork, useNow } from "@/lib/cloud";
import { isShielded, saveProfile, useStore } from "@/lib/store";
import { askConfirm } from "./dialog";

/** Prizes a player won in sponsor contests: the sponsor pays them directly and the player confirms they arrived. */
export function SponsorPrizes() {
  const { prizes, reload } = useMySponsorPrizes();
  const saved = useStore().profile.address;
  const network = useNetwork();
  const now = useNow();
  const [addr, setAddr] = useState(""), [msg, setMsg] = useState("");
  if (!prizes?.length) return null;
  const waiting = prizes.some((p) => p.status !== "paid");

  async function saveAddress() {
    const a = addr.trim();
    if (!isShielded(a, network)) return setMsg(network === "testnet" ? "That isn't a complete testnet shielded address (utest1… or ztestsapling1…)." : "That isn't a complete shielded address: it starts with u1 or zs1.");
    saveProfile({ address: a });
    setMsg("Saving…");
    try { await syncNow(); setMsg("Saved. The sponsor can now pay you."); } catch { setMsg("Saved on this device. It reaches the sponsor once you're back online."); }
  }
  async function answer(contest: string, rank: number, received: boolean, zec: number) {
    const ok = await askConfirm(received
      ? { title: `Got ${zec} ZEC?`, body: "Only confirm once the payment shows in your wallet. This records the prize as paid for good.", confirmLabel: "Yes, I got it" }
      : { title: "Not received?", body: "The sponsor is told to check and send it again. Shielded payments can take a few minutes to show, so check your wallet has synced first.", confirmLabel: "Report not received", danger: true });
    if (!ok) return;
    setMsg("");
    try { await confirmPrize(contest, rank, received); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
  }

  return (
    <section className="vault-prizes" style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Prizes from sponsors</h2>
      {waiting && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Sponsors pay these straight to your wallet within 72 hours. The sponsor sees your saved address so they can pay you.</p>}
      {waiting && !isShielded(saved, network) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--panel)", border: "2px solid var(--amber)", borderRadius: 14, padding: 12 }}>
          <label htmlFor="prize-addr" style={{ fontSize: 13, fontWeight: 800 }}>Add your shielded Zcash address so the sponsor can pay you{network === "testnet" ? " (testnet)" : ""}</label>
          <input id="prize-addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={network === "testnet" ? "utest1…" : "u1…"} autoComplete="off" spellCheck={false} className="mono"
            style={{ height: 44, borderRadius: 12, border: "2px solid #111", background: "var(--paper)", color: "#111", padding: "0 12px", fontSize: 13 }} />
          <button className="btn" onClick={saveAddress} style={{ background: "var(--amber)", color: "#111", border: "2px solid #111" }}>Save address</button>
        </div>
      )}
      {prizes.map((p) => {
        const late = p.pay_by && now && Date.parse(p.pay_by) < now && p.status !== "paid";
        return (
          <div key={`${p.contest_id}-${p.rank}`} style={{ display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>#{p.rank} · {p.title}{p.sponsor ? ` · ${p.sponsor}` : ""}</span>
              <b style={{ color: "var(--lime)", whiteSpace: "nowrap" }}>{p.zec} ZEC</b>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: late || p.status === "disputed" ? "var(--red)" : "var(--muted)" }}>
              {p.status === "paid" ? "✓ Received" : p.status === "sent" ? "The sponsor says it's sent. Check your wallet." : p.status === "disputed" ? "You reported it hasn't arrived. The sponsor has been asked to send it again." : late ? "⚠ Overdue: the sponsor missed the 72-hour deadline and can't start new contests until you're paid." : "Waiting for the sponsor to pay"}
            </span>
            {p.txid && <span className="mono" style={{ fontSize: 11, color: "var(--muted)", overflowWrap: "anywhere" }}>Transaction {p.txid}</span>}
            {p.status !== "paid" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => answer(p.contest_id, p.rank, true, p.zec)} style={{ width: "auto", minHeight: 40, padding: "0 14px", background: "var(--lime)", color: "#111", border: "2px solid #111" }}>I got it</button>
                {p.status === "sent" && <button className="btn btn-quiet" onClick={() => answer(p.contest_id, p.rank, false, p.zec)} style={{ width: "auto", minHeight: 40, padding: "0 14px" }}>Not received</button>}
              </div>
            )}
          </div>
        );
      })}
      {msg && <div role="status" style={{ fontSize: 12, fontWeight: 700 }}>{msg}</div>}
    </section>
  );
}
