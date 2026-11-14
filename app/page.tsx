import Link from "next/link";
import { FIXTURES, MODES } from "@/lib/data";
import { BottomNav, Img } from "@/components/ui";
import { HomeBadge } from "@/components/home-badge";


export default function Home() {
  return (
    <main className="screen wide">
      <header className="home-head" style={{ padding: "18px 20px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="display" style={{ fontSize: 30, letterSpacing: -1 }}>called<span style={{ background: "var(--lime)", color: "#111", padding: "0 6px", marginLeft: 3, borderRadius: 8, display: "inline-block", transform: "rotate(-4deg)" }}>it!</span></div>
        <HomeBadge />
      </header>

      <div className="home-body" style={{ padding: "10px 20px 16px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
        <Link href="/play/arena" className="home-hero" style={{ display: "block", color: "var(--text)", borderRadius: 26, background: "#1e7a47", border: "2px solid #111", boxShadow: "5px 5px 0 var(--lime)", padding: 16, position: "relative", overflow: "hidden" }}>
          <Img n="cover_arena" size={170} style={{ position: "absolute", right: -40, top: -40, opacity: 0.25, transform: "rotate(12deg)" }} />
          <span className="chip" style={{ background: "var(--red)", border: 0 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#111" }} />LIVE 63&apos;</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, position: "relative" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 80 }}><Img n="crest_ng" size={50} h={58} alt="Home XI crest" /><b style={{ fontSize: 12 }}>Home XI</b></div>
            <div className="display" style={{ fontSize: 54 }}>1–0</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 80 }}><Img n="crest_gh" size={50} h={58} alt="Away XI crest" /><b style={{ fontSize: 12 }}>Away XI</b></div>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111", borderRadius: 14, padding: "11px 14px", fontSize: 14, fontWeight: 700 }}>
            <span>Quick call is open <span style={{ color: "var(--lime)" }}>now</span></span><span style={{ color: "var(--lime)" }}>Enter →</span>
          </div>
        </Link>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Seal before kickoff</h2>
            <Link href="/seal" style={{ fontSize: 13, fontWeight: 700, color: "var(--lime)" }}>All fixtures</Link>
          </div>
          {FIXTURES.map((f) => (
            <Link key={f.id} href={`/seal?f=${f.id}`} style={{ display: "flex", alignItems: "stretch", color: "#111", background: "var(--paper)", borderRadius: 16, overflow: "hidden", minHeight: 64 }}>
              <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderRight: "2px dashed #c9bfa6" }}>
                <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
                <div style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>{f.when} · {f.sealed}</div>
              </div>
              <div style={{ width: 78, background: "var(--lime)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 12, fontWeight: 800 }}><Img n="seal" size={30} />SEAL</div>
            </Link>
          ))}
        </section>

        <section className="home-games" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Pick a game</h2>
          <div className="tiles" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            {MODES.map((m) => (
              <Link key={m.key} href={m.href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--text)" }}>
                <Img n={m.img} size={76} style={{ borderRadius: 18, border: "2px solid #111", boxShadow: "3px 3px 0 var(--text)", transform: `rotate(${m.r}deg)`, maxWidth: "100%", height: "auto", aspectRatio: "1" }} />
                <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>{m.name}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <BottomNav active="/" />
    </main>
  );
}
