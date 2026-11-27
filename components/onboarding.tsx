"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Img } from "./ui";
import { useNetwork } from "@/lib/cloud";
import { isShielded, saveProfile, useStore } from "@/lib/store";

const STEPS = [
  { title: "Call the score", desc: "Pick the final score before kickoff.", bg: "var(--sky)", img: "seal" },
  { title: "It's sealed", desc: "Your call is locked with a unique fingerprint. Nobody can peek or change it — not even us.", bg: "var(--amber)", img: "seal" },
  { title: "Prove it later", desc: "After the match, your seal opens. The timestamp proves you called it before kickoff.", bg: "var(--lime)", img: "seal" },
  { title: "Get paid privately", desc: "Contest winners are paid in shielded ZEC straight to their own wallet. Paste your wallet address now, or add it later in Profile.", bg: "var(--lilac)", img: "seal" },
];
const WALLET_STEP = STEPS.length - 1;

export function Onboarding() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const network = useNetwork();
  const saved = useStore().profile.address;
  const [addr, setAddr] = useState(""), [err, setErr] = useState("");

  useEffect(() => {
    try {
      if (!localStorage.getItem("calledit:onboarded")) setShow(true);
    } catch {}
  }, []);

  function finish() {
    const a = addr.trim();
    if (a) {
      if (!isShielded(a, network)) { setErr(network === "testnet" ? "That isn't a complete testnet shielded address (utest1…)." : "That isn't a complete shielded address. It starts with u1 or zs1."); return; }
      saveProfile({ address: a });
    }
    setShow(false);
    try { localStorage.setItem("calledit:onboarded", "1"); } catch {}
  }

  if (!show) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(5,7,10,.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400, background: STEPS[step].bg, color: "#111", borderRadius: 28, border: "3px solid #111", boxShadow: "6px 6px 0 #111", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
        <Img n={STEPS[step].img} size={80} style={{ margin: "0 auto" }} />
        <div className="display" style={{ fontSize: 28 }}>{STEPS[step].title}</div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{STEPS[step].desc}</p>
        {step === WALLET_STEP && !saved && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
            <input aria-label="Your Zcash wallet address" value={addr} onChange={(e) => { setAddr(e.target.value); setErr(""); }} placeholder={network === "testnet" ? "utest1… (testnet)" : "u1… or zs1…"} autoComplete="off" spellCheck={false} className="mono"
              style={{ height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 13 }} />
            {err && <span role="alert" style={{ fontSize: 13, fontWeight: 800, color: "#9a2d1d" }}>{err}</span>}
            <a href="https://electriccoin.co/zashi/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, textDecoration: "underline" }}>No wallet yet? Get Zashi (free) and copy its address</a>
          </div>
        )}
        {step === WALLET_STEP && saved && <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>✓ Wallet saved</p>}

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "4px 0" }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: i === step ? "#111" : "rgba(17,17,17,.25)" }} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "2px solid #111", background: "transparent", color: "#111", fontWeight: 800, fontSize: 15 }}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "2px solid #111", background: "#111", color: STEPS[step].bg, fontWeight: 800, fontSize: 15 }}>
              Next
            </button>
          ) : (
            <button onClick={finish} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "2px solid #111", background: "#111", color: "var(--lime)", fontWeight: 800, fontSize: 15 }}>
              {step === WALLET_STEP && addr.trim() ? "Save and start" : "Start playing"}
            </button>
          )}
        </div>
        <button onClick={finish} style={{ background: "none", border: 0, fontSize: 13, fontWeight: 700, color: "rgba(17,17,17,.5)" }}>
          Skip
        </button>
      </div>
    </div>
  );
}
