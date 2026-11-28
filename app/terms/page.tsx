import { BottomNav, TopBar } from "@/components/ui";

export default function Terms() {
  return (
    <main className="screen wide hub hub-pad">
      <div className="hub-inner" style={{ paddingBottom: 24 }}>
        <TopBar eyebrow="Called It" title="Terms of use" keepBack />
        <article style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14, lineHeight: 1.7 }}>
        <p><b>Last updated:</b> November 2026.</p>
        <p>Called It is a free football prediction and party-game app. By using it you agree to these terms.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Contests and prizes</h2>
        <p>Contests are created and funded by sponsors, not by Called It. Each sponsor is solely responsible for paying the winners they promised. Called It does not hold, custody or transmit anyone&apos;s funds.</p>
        <p>Entry to every contest is free. Players never pay to participate.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>The in-app wallet</h2>
        <p>Your wallet keys are created and stored on your device. Called It&apos;s servers never see your recovery phrase or private keys. An encrypted backup of the phrase may be stored in the cloud, but it can only be decrypted with your passphrase on your device.</p>
        <p>You are responsible for keeping your recovery phrase safe. If you lose it and your passphrase, your wallet cannot be recovered.</p>
        <p>The in-app wallet is designed for small contest prizes. For larger amounts, move funds to a dedicated wallet like Zashi.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Your account</h2>
        <p>You can delete your account and all associated data at any time by contacting us. Wallet data stored on your device is yours to manage.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Availability</h2>
        <p>Called It is provided as-is with no guarantees of uptime or availability. We may update, change or discontinue the service at any time.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Changes</h2>
        <p>We may update these terms. Continued use after a change means you accept the updated terms.</p>
      </article>
      </div>
      <BottomNav active="/how" />
    </main>
  );
}
