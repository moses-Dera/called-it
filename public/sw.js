// Called It service worker: push notifications + offline app shell caching.
const CACHE = "calledit-v2";
// Dev chunk names don't change with their contents, so cache-first would serve stale code.
const DEV = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);
const SHELL = ["/", "/seal", "/reveal", "/ranks", "/vault", "/profile", "/contests", "/how",
  "/icon-192.png", "/icon-512.png"];
const ASSET_RE = /^\/(a\/|_next\/static\/|icon-|manifest)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || DEV) return;

  // Assets: cache-first (they're fingerprinted or versioned)
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(request, clone)); }
        return res;
      }))
    );
    return;
  }

  // Navigation & app shell: network-first with cache fallback
  if (request.mode === "navigate" || SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(request, clone)); }
        return res;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }
});

// Push notifications
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || "Called It", {
    body: data.body || "Time to seal your call!",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "calledit",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.registration.scope));
      if (existing) { existing.focus(); existing.navigate(url); }
      else { self.clients.openWindow(url); }
    })
  );
});
