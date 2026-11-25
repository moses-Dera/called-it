// ZIP-321 payment requests: a zcash: link (and QR code) that opens the payer's wallet with the
// address, amount and memo already filled in.

/** Build a payment link. The memo is UTF-8, base64url without padding, as ZIP-321 requires. */
export function zip321(address: string, amount: number, memo: string): string {
  const bytes = new TextEncoder().encode(memo);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const memo64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const zec = Number(amount.toFixed(8)).toString();
  return `zcash:${address}?amount=${zec}&memo=${memo64}`;
}
