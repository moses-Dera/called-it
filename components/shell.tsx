import Link from "next/link";
import { MODES, art } from "@/lib/data";

// Sets the scale factors before first paint so there is no jump.
// --z: phones (fit 390-wide design to the screen, and shrink further on very short phones).
// --zd: desktop/tablet board (fit 844-tall board to the window height).
const FIT = `(function(){function f(){var w=document.documentElement.clientWidth||innerWidth,h=innerHeight,s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--z',Math.min(w/390,h/700).toFixed(4));s.setProperty('--zd',Math.max(.6,Math.min((h-40)/844,(w-264-40)/390,1.5)).toFixed(4));}f();addEventListener('resize',f);})();`;

const NAV = [["/", "Home"], ["/play/arena", "Live Arena"], ["/ranks", "Ranks"], ["/vault", "Vault"], ["/profile", "Profile"]];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FIT }} />
      <aside className="sidebar" aria-label="Navigation">
        <Link href="/" className="display" style={{ fontSize: 30, color: "var(--text)", padding: "0 10px 10px", minHeight: 0 }}>
          called<span style={{ background: "var(--lime)", color: "#111", padding: "0 6px", marginLeft: 3, borderRadius: 8, transform: "rotate(-4deg)", display: "inline-block" }}>it!</span>
        </Link>
        <Link href="/seal" className="cta">Seal a call</Link>
        {NAV.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        <div className="eyebrow" style={{ color: "var(--muted)", padding: "16px 10px 4px" }}>Games</div>
        {MODES.map((m) => (
          <Link key={m.key} href={m.href}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art(m.img)} alt="" width={30} height={30} />{m.name}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "12px 10px 0", lineHeight: 1.5 }}>Every call is sealed before the result. Free to play.</div>
      </aside>
      <div className="stage">{children}</div>
    </>
  );
}
