import { wordlist } from "@scure/bip39/wordlists/english.js";

const BIP39 = new Set(wordlist);

/** Replace anything resembling a 24-word recovery phrase, Zcash key, Zcash address, or auth token. */
export function scrubText(input: string): string {
  if (!input) return input;
  let out = input;

  // Zcash secret/spending/viewing keys (Unified, Sapling, ZIP-32)
  out = out.replace(/\bsecret-[a-z0-9-]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}\b/gi, "[REDACTED_ZCASH_KEY]");
  out = out.replace(/\b(?:zxviews|uview|uviewtest|uviewregtest)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}\b/gi, "[REDACTED_VIEWING_KEY]");
  out = out.replace(/\b(?:xprv|tprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/g, "[REDACTED_KEY]");

  // Zcash shielded and transparent addresses
  out = out.replace(/\b(?:u|utest|uregtest|zs|ztestsapling|zregtestsapling)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{30,}\b/gi, "[REDACTED_ZADDR]");
  out = out.replace(/\b(?:t1|t3|tm)[1-9A-HJ-NP-Za-km-z]{30,38}\b/g, "[REDACTED_TADDR]");
  out = out.replace(/\b(?:zc|zt)[1-9A-HJ-NP-Za-km-z]{60,}\b/g, "[REDACTED_ZADDR]");

  // Auth tokens and query secrets
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
  out = out.replace(/([?&](?:token|code|sentry_key|apikey|key)=)[^&\s]+/gi, "$1[REDACTED]");

  // BIP-39 recovery phrases (12 to 24+ consecutive words from the BIP-39 English wordlist, even with commas/numbers)
  out = scrubMnemonicRuns(out);

  return out;
}

function scrubMnemonicRuns(text: string): string {
  // Match whitespace-separated chunks; check maximal contiguous stretches of BIP-39 words.
  const tokens: { start: number; end: number; isWord: boolean }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Strip optional leading index ("1.", "1)") and punctuation ("word," / "\"word\"")
    const clean = m[0].replace(/^(?:\d+[.):]+)?["'`([]*/, "").replace(/["'`),.;:!?\]}]+$/, "").toLowerCase();
    const isWord = /^[a-z]{3,8}$/.test(clean) && BIP39.has(clean);
    tokens.push({ start: m.index, end: m.index + m[0].length, isWord });
  }

  const spans: [number, number][] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!tokens[i].isWord) { i++; continue; }
    let j = i;
    while (j < tokens.length && tokens[j].isWord) j++;
    if (j - i >= 12) spans.push([tokens[i].start, tokens[j - 1].end]);
    i = j;
  }

  if (!spans.length) return text;
  let result = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    result += text.slice(cursor, start) + "[REDACTED_MNEMONIC]";
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** Recursively scrub strings inside an arbitrary JSON-like payload. */
export function scrubRecord(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubRecord(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/mnemonic|phrase|seed|secret|private|password|passcode|token/i.test(k)) out[k] = "[REDACTED]";
      else out[k] = scrubRecord(v, depth + 1);
    }
    return out;
  }
  return value;
}
