"use client";
import { useEffect } from "react";
import { startCloud } from "@/lib/cloud";
import { anchorPending } from "@/lib/store";
import { tendRooms } from "@/lib/rooms";
import { useCloud } from "@/lib/cloud";
import { syncVault } from "@/lib/vault";

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
  const uid = useCloud().session?.user.id;
  const signedIn = !!uid;
  useEffect(() => {
    if (!signedIn) return;
    tendRooms();
    const t = setInterval(tendRooms, 30_000);
    return () => clearInterval(t);
  }, [signedIn]);
  // Moves follow the account: escrow new ones, and fetch ones sealed on other devices.
  useEffect(() => {
    if (!uid) return;
    const go = () => syncVault(uid);
    const first = setTimeout(go, 3000);
    const t = setInterval(go, 20_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [uid]);
  return null;
}
