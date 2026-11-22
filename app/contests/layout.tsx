import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contests",
  description: "Join a contest. Your sealed calls count toward its leaderboard. Win prizes.",
  openGraph: { title: "Contests — Called It", description: "Join a contest. Win prizes. Free to play." },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
