import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Your Seal Works",
  description: "Three steps. Zero trust required. Nobody can cheat — not the other players, not us.",
  openGraph: { title: "How Your Seal Works — Called It", description: "Three steps. Zero trust required. Nobody can cheat." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
