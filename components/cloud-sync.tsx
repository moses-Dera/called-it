"use client";
import { useEffect } from "react";
import { startCloud } from "@/lib/cloud";

/** Mounted once in the shell. Renders nothing; keeps a signed-in account in sync. */
export function CloudSync() {
  useEffect(() => { startCloud(); }, []);
  return null;
}
