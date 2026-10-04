/*
 * Agent World service worker: installable + opens offline.
 * - Network first: online behaviour is unchanged; the cache is only a fallback.
 * - Only same-origin GETs inside the app scope (/agent-world/) are handled.
 *   Cross-origin requests (other apps, any API) are never intercepted or cached.
 * - status.json (live board data) is never cached, so boards never show stale numbers.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v2";
const CACHE = `agent-world-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const PRECACHE = [/*__PRECACHE__*/];
const NEVER = ["status.json", "sw.js"];

function handled(req) {
  if (req.method !== "GET" || req.headers.has("range")) return false;
  const u = new URL(req.url);
  if (u.origin !== SCOPE.origin || !u.pathname.startsWith(SCOPE.pathname)) return false;
  const rel = u.pathname.slice(SCOPE.pathname.length);
  return !NEVER.includes(rel);
}
const key = (req) => { const u = new URL(req.url); u.hash = ""; if (req.mode === "navigate") u.search = ""; return u.href; };

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((p) =>
    fetch(new Request(new URL(p, SCOPE).href, { cache: "reload" })).then((r) => r.ok && c.put(new URL(p, SCOPE).href, r)).catch(() => {})
  ))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("agent-world-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (!handled(req)) return; // browser handles it normally
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key(req), copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const c = await caches.open(CACHE);
      const hit = (await c.match(key(req))) || (await c.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      if (req.mode === "navigate") { const shell = await c.match(new URL("./", SCOPE).href); if (shell) return shell; }
      throw err;
    }
  })());
});
