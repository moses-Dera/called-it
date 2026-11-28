import { scrubRecord, scrubText } from "./scrub";

type Dsn = { dsn: string; endpoint: string };
export type ErrorContext = {
  source?: string;
  route?: string;
  method?: string;
  extra?: Record<string, unknown>;
};

function parseDsn(raw?: string): Dsn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const key = u.username;
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!key || !projectId) return null;
    const prefix = parts.length ? "/" + parts.join("/") : "";
    return {
      dsn: raw.trim(),
      endpoint: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(key)}&sentry_version=7`,
    };
  } catch {
    return null;
  }
}

function makeEventId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "");
    }
  } catch {}
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

const recent = new Map<string, number>();
function seenRecently(sig: string): boolean {
  const now = Date.now();
  const prev = recent.get(sig);
  if (prev && now - prev < 10_000) return true;
  if (recent.size > 50) recent.clear();
  recent.set(sig, now);
  return false;
}

/**
 * Scrub and report an error to GlitchTip / Sentry (via DSN envelope API) when configured,
 * and log only the scrubbed version locally. Safe to call from both client and server.
 */
export async function reportError(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const rawName = err instanceof Error ? err.name : "Error";
  const rawMsg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err ?? "Unknown error");
  const rawStack = err instanceof Error ? err.stack : undefined;

  const type = scrubText(rawName || "Error");
  const value = scrubText(rawMsg || "Unknown error");
  const stack = rawStack ? scrubText(rawStack) : undefined;
  const route = ctx.route ? scrubText(ctx.route) : undefined;
  const source = ctx.source ?? (typeof window === "undefined" ? "server" : "client");

  if (seenRecently(`${source}:${type}:${value}`)) return;

  const dsnRaw = typeof window === "undefined"
    ? (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
    : process.env.NEXT_PUBLIC_SENTRY_DSN;
  const parsed = parseDsn(dsnRaw);

  const extra = scrubRecord({ ...(ctx.extra ?? {}), ...(stack ? { stack } : {}) }) as Record<string, unknown>;
  const eventId = makeEventId();

  if (!parsed) {
    if (process.env.NODE_ENV !== "test") {
      console.error(`[error-monitor:${source}] ${type}: ${value}`, route ? { route } : "");
    }
    return;
  }

  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: parsed.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: "error",
      environment: process.env.NODE_ENV ?? "production",
      exception: { values: [{ type, value }] },
      tags: { source, ...(route ? { route } : {}) },
      extra,
      ...(route ? { request: { url: route, method: ctx.method } } : {}),
    }),
  ].join("\n");

  try {
    // Plain text body keeps browser requests CORS-simple (no preflight OPTIONS needed).
    await fetch(parsed.endpoint, { method: "POST", body: envelope, keepalive: true });
  } catch {
    // Never let telemetry failure throw back into the app.
  }
}
