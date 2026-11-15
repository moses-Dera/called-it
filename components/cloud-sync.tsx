"use client";
import { useEffect } from "react";
import { startCloud } from "@/lib/cloud";
import { anchorPending } from "@/lib/store";
import { tendRooms } from "@/lib/rooms";
import { useCloud } from "@/lib/cloud";

/** Mounted once in the shell. Renders nothing; keeps a signed-in account in sync and retries
 * anchoring seals that are still pending (for example while the anchor service was offline). */
export function CloudSync() {
  useEffect(() => {
    startCloud();
    anchorPending();
    const retry = setInterval(anchorPending, 60_000);
    return () => clearInterval(retry);
  }, []);
  // Games with friends keep moving even when their page isn't open.
  const signedIn = !!useCloud().session;
  useEffect(() => {
    if (!signedIn) return;
    tendRooms();
    const t = setInterval(tendRooms, 30_000);
    return () => clearInterval(t);
  }, [signedIn]);
  return null;
}
