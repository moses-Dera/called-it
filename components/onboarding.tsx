"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Img } from "./ui";

const STEPS = [
  { title: "Call the score", desc: "Pick the final score before kickoff.", bg: "var(--sky)", img: "seal" },
  { title: "It's sealed", desc: "Your call is locked with a unique fingerprint. Nobody can peek or change it — not even us.", bg: "var(--amber)", img: "seal" },
  { title: "Prove it later", desc: "After the match, your seal opens. The timestamp proves you called it before kickoff.", bg: "var(--lime)", img: "seal" },
];

export function Onboarding() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem("calledit:onboarded")) setShow(true);
    } catch {}
  }, []);

  function finish() {
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
              Start playing
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
