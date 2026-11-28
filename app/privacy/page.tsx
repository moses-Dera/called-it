import { TopBar } from "@/components/ui";

export default function Privacy() {
  return (
    <main className="screen wide" style={{ padding: 20, maxWidth: 640 }}>
      <TopBar eyebrow="Called It" title="Privacy" />
      <article style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14, lineHeight: 1.7 }}>
        <p><b>Last updated:</b> November 2026.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>What we store</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Your Google profile (name, avatar, email) for sign-in.</li>
          <li>Your display name, username, avatar choice, and bio.</li>
          <li>Your predictions, game results, contest entries, and reward points.</li>
          <li>An encrypted backup of your wallet recovery phrase, if you create an in-app wallet. Only you can decrypt it.</li>
        </ul>
        <h2 style={{ fontSize: 18, margin: 0 }}>What we never store</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Your wallet private keys or plaintext recovery phrase.</li>
          <li>Your Zcash wallet address is never shown publicly. Only a sponsor paying you a prize can see it.</li>
        </ul>
        <h2 style={{ fontSize: 18, margin: 0 }}>What we never share</h2>
        <p>We do not sell, share or disclose your data to third parties. Error reports are scrubbed of wallet phrases, keys and addresses before being sent.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Your privacy controls</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li><b>Show my stats:</b> off by default. When off, your public page shows only your name and avatar.</li>
          <li><b>Searchable by name:</b> on by default. Turn it off and you can only be found by your exact @username.</li>
          <li>Contest prize pools and places are public; your personal totals are not.</li>
        </ul>
        <h2 style={{ fontSize: 18, margin: 0 }}>Cookies and tracking</h2>
        <p>Called It uses only functional cookies for sign-in. We do not use advertising or analytics trackers.</p>
        <h2 style={{ fontSize: 18, margin: 0 }}>Contact</h2>
        <p>Questions about your data? Open an issue on the project's GitHub repository.</p>
      </article>
    </main>
  );
}
