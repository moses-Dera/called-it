"use client";
import { useState } from "react";
import { cloudRpc, useCloud } from "@/lib/cloud";

export function TipModal({ toUser, toName, onClose }: { toUser: string; toName: string; onClose: () => void }) {
  const [amount, setAmount] = useState("0.01");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [result, setResult] = useState("");
  const signedIn = !!useCloud().session;

  async function send() {
    const n = parseFloat(amount);
    if (!n || n < 0.0001) return setResult("Minimum tip is 0.0001 ZEC");
    if (n > 10) return setResult("Maximum tip is 10 ZEC");
    setStatus("sending");
    try {
      const r = await cloudRpc<{ status: string; amount?: number; to?: string; available?: number }>("send_tip", { p_to: toUser, p_amount: n, p_message: message || null });
      if (r.status === "insufficient") {
        setResult(`Not enough balance. Available: ${(r.available ?? 0).toFixed(4)} ZEC`);
        setStatus("error");
      } else {
        setResult(`Sent ${(r.amount ?? n).toFixed(4)} ZEC to ${r.to ?? toName}`);
        setStatus("sent");
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed to send tip");
      setStatus("error");
    }
  }

  const PRESETS = [0.001, 0.005, 0.01, 0.05];

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(11,15,20,0.88)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="paper" style={{ width: "100%", maxWidth: 400, borderRadius: 24, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 10px 40px rgba(0,0,0,0.5), 6px 6px 0 var(--amber)", border: "3px solid #111", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="eyebrow" style={{ color: "#6b6455" }}>Player Tip</span>
            <h3 className="display" style={{ margin: 0, fontSize: 22, color: "#111" }}>Tip {toName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, borderRadius: 12, border: "2px solid #111", background: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer" }}>✕</button>
        </div>

        {!signedIn ? (
          <p style={{ margin: 0, fontSize: 13, color: "#423820", fontWeight: 600 }}>Sign in to send a tip.</p>
        ) : status === "sent" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", padding: "10px 0" }}>
            <span style={{ fontSize: 40 }}>✓</span>
            <b style={{ fontSize: 14, color: "#111" }}>{result}</b>
            <button onClick={onClose} className="btn" style={{ background: "#111", color: "var(--amber)", border: 0, fontSize: 14, width: "100%" }}>Done</button>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13, color: "#423820", fontWeight: 600, lineHeight: 1.4 }}>
              Send ZEC from your prize balance to <b>{toName}</b>. Tips are instant and free.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button key={p} onClick={() => setAmount(String(p))} style={{ flex: 1, minWidth: 60, padding: "8px 10px", borderRadius: 12, border: `2px solid ${parseFloat(amount) === p ? "#111" : "#d8cfb8"}`, background: parseFloat(amount) === p ? "var(--amber)" : "#fff", color: "#111", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{p}</button>
              ))}
            </div>
            <input type="number" step="0.001" min="0.0001" max="10" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in ZEC" style={{ padding: "8px 12px", borderRadius: 12, border: "2px solid #111", fontSize: 13, fontWeight: 600, background: "#fff", color: "#111" }} />
            <input type="text" maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional message (140 chars)" style={{ padding: "8px 12px", borderRadius: 12, border: "2px solid #d8cfb8", fontSize: 13, fontWeight: 600, background: "#fff", color: "#111" }} />
            <button onClick={send} disabled={status === "sending"} className="btn" style={{ background: "#111", color: "var(--amber)", border: 0, fontSize: 15, width: "100%" }}>
              {status === "sending" ? "Sending…" : `Send ${amount} ZEC`}
            </button>
            {result && <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "#c0392b" }}>{result}</div>}
          </>
        )}
      </div>
    </div>
  );
}
