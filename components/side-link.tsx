"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar link that marks itself as the current page. */
export function SideLink({ href, children }: { href: string; children: React.ReactNode }) {
  const on = usePathname() === href;
  return <Link href={href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{children}</Link>;
}
