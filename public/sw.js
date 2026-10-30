/*
 * WealthTrack service worker (docs/07 §7).
 * - Caches only build assets that are the same for every user: /_next/static/* (hashed, immutable)
 *   and the app icons. Pages, server actions and API responses are never cached, so no financial
 *   data is stored on the device and nothing leaks between users of the same browser.
 * - Pages always come from the network; when it is down, a built-in offline page is shown.
 * - No offline writes (docs/07 §6).
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const CACHE = `wealthtrack-static-${VERSION}`;
const MAX_ENTRIES = 300;
const ICONS = ["/icons/icon-192.png", "/icons/icon-512.png", "/apple-touch-icon.png"];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline · WealthTrack</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #0a0a0a; --muted: #737373; --btn: #2a78d6; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; } }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom);
  }
  main { max-width: 22rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: var(--muted); margin: 0 0 1.5rem; }
  button {
    min-height: 44px; padding: 0 1.25rem; border: 0; border-radius: .5rem;
    background: var(--btn); color: #fff; font: inherit; font-weight: 600;
  }
</style>
</head>
<body>
<main>
  <h1>You're offline</h1>
  <p>WealthTrack needs a connection to show your numbers. Changes can't be saved while offline.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ICONS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("wealthtrack-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(key);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || ICONS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (RSC payloads, server actions, API, exports) goes straight to the network.
});
