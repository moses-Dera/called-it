import { HomeFeed, HomeFixtures } from "@/components/home-feed";
import { BottomNav, ErrorBoundary } from "@/components/ui";
import { HomeBadge } from "@/components/home-badge";
import { Onboarding } from "@/components/onboarding";


export default function Home() {
  return (
    <main className="screen wide hub">
      <Onboarding />
      <header className="home-head" style={{ padding: "16px 18px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div className="display" style={{ fontSize: 28, letterSpacing: -1, whiteSpace: "nowrap" }}>called<span style={{ background: "var(--lime)", color: "#111", padding: "0 6px", marginLeft: 3, borderRadius: 8, display: "inline-block", transform: "rotate(-4deg)" }}>it!</span></div>
        <HomeBadge />
      </header>

      <div className="home-body" style={{ padding: "4px 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <ErrorBoundary><HomeFixtures /></ErrorBoundary>
        <ErrorBoundary><HomeFeed /></ErrorBoundary>
      </div>
      <BottomNav active="/" />
    </main>
  );
}
