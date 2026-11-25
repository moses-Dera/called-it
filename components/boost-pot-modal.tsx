"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Contest } from "@/lib/cloud";



const PRESET_AMOUNTS = [0.05, 0.1, 0.25, 0.5, 1.0];

function toZip321(address: string, amount: number, memoText: string): string {
  try {
    // UTF-8 to Base64URL without padding per ZIP 321
    const rawB64 = btoa(unescape(encodeURIComponent(memoText)));
    const b64url = rawB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `zcash:${address}?amount=${amount}&memo=${b64url}`;
  } catch {
    return `zcash:${address}?amount=${amount}`;
  }
}

export function BoostPotModal({
  contest,
  address,
  onClose,
}: {
  contest: Contest;
  address: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number>(0.1);
  const [custom, setCustom] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);

  const activeAmount = custom ? parseFloat(custom) || 0.1 : amount;
  const memoText = `boost:${contest.id}`;
  const zip321Uri = toZip321(address, activeAmount, memoText);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(zip321Uri, {
      margin: 1,
      width: 240,
      color: {
        dark: "#111111",
        light: "#FFFFFF",
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [zip321Uri]);

  function copyAddress() {
    navigator.clipboard?.writeText(address);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  }

  function copyMemo() {
    navigator.clipboard?.writeText(memoText);
    setCopiedMemo(true);
    setTimeout(() => setCopiedMemo(false), 2000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(11, 15, 20, 0.88)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="paper"
        style={{
          width: "100%",
          maxWidth: 440,
          borderRadius: 24,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 10px 40px rgba(0,0,0,0.5), 6px 6px 0 var(--lime)",
          border: "3px solid #111",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="eyebrow" style={{ color: "#6b6455" }}>Community Booster</span>
            <h3 className="display" style={{ margin: 0, fontSize: 24, color: "#111" }}>
              ⚡ Boost Prize Pot
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close booster"
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: "2px solid #111",
              background: "#fff",
              fontSize: 18,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: "#423820", lineHeight: 1.45, fontWeight: 600 }}>
          Make <b>{contest.title}</b> even bigger! Anyone can boost the prize pot with shielded ZEC. The organiser adds every boost to this contest&apos;s prize pot, so the total updates after it arrives.
        </p>

        {/* Amount Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b style={{ fontSize: 12, color: "#111", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Select Boost Amount (ZEC)
          </b>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PRESET_AMOUNTS.map((amt) => {
              const selected = !custom && amount === amt;
              return (
                <button
                  key={amt}
                  onClick={() => {
                    setCustom("");
                    setAmount(amt);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 60,
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `2px solid ${selected ? "#111" : "#d8cfb8"}`,
                    background: selected ? "var(--lime)" : "#fff",
                    color: "#111",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {amt}
                </button>
              );
            })}
          </div>
          <input
            type="number"
            step="0.01"
            placeholder="Or custom amount (e.g. 0.75)"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "2px solid #111",
              fontSize: 13,
              fontWeight: 600,
              background: "#fff",
              color: "#111",
            }}
          />
        </div>

        {/* QR Code Container */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            background: "#fff",
            borderRadius: 18,
            border: "2px solid #111",
            padding: 14,
          }}
        >
          {qrDataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={qrDataUrl}
              alt="Zcash ZIP 321 QR Code"
              width={200}
              height={200}
              style={{ borderRadius: 10 }}
            />
          ) : (
            <div style={{ width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
              Generating QR…
            </div>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>
            Scan with Zashi, YWallet, Zingo!, or Edge
          </span>
        </div>

        {/* 1-Click Wallet Button */}
        <a
          href={zip321Uri}
          className="btn btn-primary"
          style={{
            width: "100%",
            textDecoration: "none",
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 15,
          }}
        >
          ⚡ Open in Zcash Wallet ({activeAmount} ZEC)
        </a>

        {/* Address and Memo Copy Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f3ede0",
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #d8cfb8",
            }}
          >
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
              <span style={{ fontWeight: 700, color: "#666" }}>Memo: </span>
              <b className="mono" style={{ color: "#111" }}>{memoText}</b>
            </div>
            <button
              onClick={copyMemo}
              style={{
                border: 0,
                background: "transparent",
                fontWeight: 800,
                color: copiedMemo ? "green" : "#111",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              {copiedMemo ? "✓ Copied" : "Copy"}
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f3ede0",
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #d8cfb8",
            }}
          >
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
              <span style={{ fontWeight: 700, color: "#666" }}>Address: </span>
              <span className="mono" style={{ fontSize: 11, color: "#111" }}>
                {address.slice(0, 14)}…{address.slice(-10)}
              </span>
            </div>
            <button
              onClick={copyAddress}
              style={{
                border: 0,
                background: "transparent",
                fontWeight: 800,
                color: copiedAddr ? "green" : "#111",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              {copiedAddr ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b6455", textAlign: "center" }}>
          🛡️ Shielded Zcash (Unified / Orchard) · Sub-penny fee · Private & verifiable
        </div>
      </div>
    </div>
  );
}
