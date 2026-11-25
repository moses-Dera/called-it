// Checks a Zcash shielded address the way wallets do, including its checksum, so a mistyped or
// half-pasted address is caught before any ZEC is sent to it.
//   Unified addresses (u1…) use Bech32m; Sapling addresses (zs1…) use Bech32.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32 = 1, BECH32M = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function checksumOk(addr: string, constant: number): boolean {
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || addr.length - pos < 7) return false;
  const hrp = addr.slice(0, pos), data: number[] = [];
  for (const ch of addr.slice(pos + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return false;
    data.push(v);
  }
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  return polymod([...expanded, ...data]) === constant;
}

/** A mainnet shielded address with a valid checksum. */
export function isMainnetShielded(raw: string): boolean {
  const a = raw.trim();
  if (a !== a.toLowerCase()) return false;
  if (/^u1[a-z0-9]{100,}$/.test(a)) return checksumOk(a, BECH32M);
  if (/^zs1[a-z0-9]{70,80}$/.test(a)) return checksumOk(a, BECH32);
  return false;
}
