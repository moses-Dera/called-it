// Works in the browser and on the server (WebCrypto).
const enc = new TextEncoder();
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Sorted-pair hashing: a proof is just the list of sibling hashes, no left/right flags needed.
const pair = (a: string, b: string) => sha256Hex(a < b ? a + b : b + a);

export async function buildTree(leaves: string[]): Promise<{ root: string; proofs: string[][] }> {
  if (leaves.length === 0) throw new Error("no leaves");
  const proofs: string[][] = leaves.map(() => []);
  let level = leaves.slice();
  let pos = leaves.map((_, i) => i);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? await pair(level[i], level[i + 1]) : level[i]);
    }
    pos = pos.map((p, leaf) => {
      const sib = p ^ 1;
      if (sib < level.length) proofs[leaf].push(level[sib]);
      return p >> 1;
    });
    level = next;
  }
  return { root: level[0], proofs };
}
export async function verifyProof(leaf: string, proof: string[], root: string): Promise<boolean> {
  let h = leaf;
  for (const s of proof) h = await pair(h, s);
  return h === root;
}
