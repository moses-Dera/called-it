import { HomeFeed, HomeFixtures } from "@/components/home-feed";
import { BottomNav, ErrorBoundary } from "@/components/ui";
import { HomeBadge } from "@/components/home-badge";
import { Onboarding } from "@/components/onboarding";


export default function Home() {
  return (
    <main className="screen wide">
      <Onboarding />
      <header className="home-head" style={{ padding: "18px 20px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="display" style={{ fontSize: 30, letterSpacing: -1 }}>called<span style={{ background: "var(--lime)", color: "#111", padding: "0 6px", marginLeft: 3, borderRadius: 8, display: "inline-block", transform: "rotate(-4deg)" }}>it!</span></div>
        <HomeBadge />
      </header>

      <div className="home-body" style={{ padding: "10px 20px 16px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
        <ErrorBoundary><HomeFixtures /></ErrorBoundary>
        <ErrorBoundary><HomeFeed /></ErrorBoundary>
      </div>
      <BottomNav active="/" />
    </main>
  );
}
