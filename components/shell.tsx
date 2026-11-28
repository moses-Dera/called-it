import Link from "next/link";
import { DeskPanel } from "./desk-panel";
import { SideLink } from "./side-link";
import { CloudSync } from "./cloud-sync";
import { TestModeBanner } from "./test-mode-banner";
import { DialogHost } from "./dialog";
import { ShareHost } from "./share-sheet";
import { SidebarAccount } from "./account";

// Sets the scale factors before first paint so there is no jump.
// --z: smoothly shrink narrow phones below 390px without magnifying wider viewports past 1x.
const FIT = `(function(){function f(){var w=document.documentElement.clientWidth||innerWidth,s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--z',Math.min(1,Math.max(0.82,w/390)).toFixed(4));}f();addEventListener('resize',f);})();`;

const NAV = [["/", "Home"], ["/contests", "Contests"], ["/rooms", "Play with friends"], ["/vault", "My prizes and proofs"], ["/ranks", "Ranks"], ["/play/arena", "Live Arena"], ["/sponsor", "Run a contest"], ["/profile", "Profile and wallet"]];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FIT }} />
      <CloudSync />
      <TestModeBanner />
      <DialogHost />
      <ShareHost />
      <aside className="sidebar" aria-label="Navigation">
        <div className="sidebar-top">
          <Link href="/" className="display" style={{ fontSize: 30, color: "var(--text)", padding: "0 10px 10px", minHeight: 0 }}>
            called<span style={{ background: "var(--lime)", color: "#111", padding: "0 6px", marginLeft: 3, borderRadius: 8, transform: "rotate(-4deg)", display: "inline-block" }}>it!</span>
          </Link>
          <Link href="/seal" className="cta">Seal a call</Link>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(([href, label]) => <SideLink key={href} href={href}>{label}</SideLink>)}
          <div className="sidebar-foot">
            <SidebarAccount />
            <SideLink href="/how">How your seal works</SideLink>
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 10px 0", lineHeight: 1.5 }}>Every call is sealed before the result. Nobody can cheat. Free to play.</div>
          </div>
        </nav>
      </aside>
      <div className="stage">{children}<DeskPanel /></div>
    </>
  );
}
