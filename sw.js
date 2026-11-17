/* Hält die App startfähig, wenn gerade kein Netz da ist.
   Online wird immer zuerst die neueste Version geladen, damit Änderungen sofort ankommen. */
const CACHE = 'rudel-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const shell = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname.startsWith('fonts.');
  if (!shell) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});
