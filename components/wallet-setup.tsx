"use client";
import { useState } from "react";
import { newPhrase, openWallet, createAccount, addressOf, markWalletCreated } from "@/lib/in-app-wallet";
import { encryptPhrase, quizIndices } from "@/lib/wallet-crypto";
import { saveWalletBackup, verifyWalletBackup } from "@/lib/cloud";
import type { Network } from "@/lib/zaddr";

type Step = "passphrase" | "creating" | "show-phrase" | "quiz" | "done";

export function WalletSetup({ network, onDone }: { network: Network; onDone: (address: string) => void }) {
  const [step, setStep] = useState<Step>("passphrase");
  const [pass, setPass] = useState(""), [pass2, setPass2] = useState("");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [quizIdx, setQuizIdx] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);

  async function create() {
    if (pass.length < 8) return setError("At least 8 characters.");
    if (pass !== pass2) return setError("Passphrases don't match.");
    setError(""); setStep("creating");
    try {
      const p = newPhrase();
      setPhrase(p);
      const wallet = await openWallet(network);
      const acct = await createAccount(wallet, network, p, false);
      const addr = await addressOf(wallet, acct.id);

      const enc = await encryptPhrase(p, pass);
      await saveWalletBackup(network, enc.ciphertext, enc.iv, enc.salt, enc.kdf);

      setStep("show-phrase");
      // Store address for the done callback
      (window as { __walletAddr?: string }).__walletAddr = addr;
    } catch (e) { setError((e as Error).message); setStep("passphrase"); }
  }

  function startQuiz() {
    const idx = quizIndices(3);
    setQuizIdx(idx);
    setAnswers(["", "", ""]);
    setStep("quiz");
  }

  async function checkQuiz() {
    const words = phrase.split(" ");
    for (let i = 0; i < quizIdx.length; i++) {
      if (answers[i].trim().toLowerCase() !== words[quizIdx[i]]) {
        setError(`Word #${quizIdx[i] + 1} doesn't match. Try again.`);
        return;
      }
    }
    setError("");
    markWalletCreated(network);
    try { await verifyWalletBackup(); } catch {}
    setStep("done");
    const addr = (window as { __walletAddr?: string }).__walletAddr ?? "";
    delete (window as { __walletAddr?: string }).__walletAddr;
    onDone(addr);
  }

  const btn = { minHeight: 48, padding: "0 20px", borderRadius: 14, border: "2px solid #111", background: "var(--lime)", color: "#111", fontWeight: 800, fontSize: 15, width: "100%" } as const;
  const inp = { minHeight: 46, padding: "0 14px", borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", fontSize: 14, width: "100%" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 440 }}>
      {step === "passphrase" && <>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Set up your wallet</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>Choose a strong passphrase. You&apos;ll need it to restore your wallet on another device.</p>
        <input style={inp} type="password" placeholder="Passphrase (8+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        <input style={inp} type="password" placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        {error && <div style={{ color: "#9a2d1d", fontSize: 13, fontWeight: 700 }}>{error}</div>}
        <button style={btn} onClick={create}>Create wallet</button>
      </>}

      {step === "creating" && <>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Creating your wallet…</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>This takes a moment. Your keys are generated on this device only.</p>
      </>}

      {step === "show-phrase" && <>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Write down your recovery phrase</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>These 24 words are the only way to recover your wallet if you lose access. Write them on paper and keep them safe.</p>
        <div style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 10px" }}>
          {phrase.split(" ").map((w, i) => (
            <span key={i} style={{ fontSize: 13, fontWeight: 600 }}><b style={{ color: "#4a4436", fontWeight: 500 }}>{i + 1}.</b> {w}</span>
          ))}
        </div>
        {error && <div style={{ color: "#9a2d1d", fontSize: 13, fontWeight: 700 }}>{error}</div>}
        <button style={btn} onClick={startQuiz}>I&apos;ve written them down</button>
      </>}

      {step === "quiz" && <>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Confirm your phrase</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>Enter the requested words to prove you saved them.</p>
        {quizIdx.map((idx, i) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 60 }}>Word #{idx + 1}</span>
            <input style={inp} value={answers[i]} onChange={(e) => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); }} autoComplete="off" autoCapitalize="off" />
          </div>
        ))}
        {error && <div style={{ color: "#9a2d1d", fontSize: 13, fontWeight: 700 }}>{error}</div>}
        <button style={btn} onClick={checkQuiz}>Verify</button>
        <button style={{ ...btn, background: "transparent", border: "2px solid #9e9682", color: "#4a4436", fontSize: 13 }} onClick={() => { markWalletCreated(network); setStep("done"); const addr = (window as { __walletAddr?: string }).__walletAddr ?? ""; delete (window as { __walletAddr?: string }).__walletAddr; onDone(addr); }}>Skip for now (not recommended)</button>
      </>}

      {step === "done" && <>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Wallet ready</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#4a4436" }}>Your shielded wallet is set up. Prizes arrive here automatically.</p>
      </>}
    </div>
  );
}
