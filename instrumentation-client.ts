import { reportError } from "./lib/errors";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    try {
      void reportError(event.error ?? event.message, {
        source: "window.error",
        route: window.location.pathname,
        extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
      });
    } catch {}
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      void reportError(event.reason, {
        source: "unhandledrejection",
        route: window.location.pathname,
      });
    } catch {}
  });
}
