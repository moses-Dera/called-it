"use client";
import { useEffect } from "react";
import { startCloud } from "@/lib/cloud";
import { anchorPending } from "@/lib/store";

/** Mounted once in the shell. Renders nothing; keeps a signed-in account in sync and retries
 * anchoring seals that are still pending (for example while the anchor service was offline). */
export function CloudSync() {
  useEffect(() => {
    startCloud();
    anchorPending();
    const retry = setInterval(anchorPending, 60_000);
    return () => clearInterval(retry);
  }, []);
  return null;
}
