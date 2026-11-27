"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

function Marked({ href, children }: { href: string; children: React.ReactNode }) {
  const on = usePathname() === href;
  return <Link href={href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{children}</Link>;
}

/** Sidebar link that marks itself as the current page. The URL is read inside Suspense, so pages with
 *  dynamic addresses (like /contest/<name>) can still prerender their shell. */
export function SideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Suspense fallback={<Link href={href}>{children}</Link>}><Marked href={href}>{children}</Marked></Suspense>;
}
