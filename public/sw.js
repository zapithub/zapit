// ZAPIT Service Worker — Phase 3 PWA (offline shell)
// World-class: network-first for API, cache-first for static shell.
// Does NOT cache auth or Supabase; only offline for static assets to help low-connectivity users.

const CACHE_NAME = 'zapit-shell-v3-20261001';
const SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/pricing.html',
  '/dashboard.html',
  '/public/shared.css',
  '/public/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API, Supabase, Paystack, Brevo, analytics
  if (url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/api/') ||
      url.hostname.includes('supabase.co') ||
      url.hostname.includes('paystack') ||
      url.hostname.includes('brevo') ||
      url.hostname.includes('ipapi.co')) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ success:false, error:'Offline — connect to retry.' }), { status:503, headers:{'Content-Type':'application/json'} })));
    return;
  }

  // For navigations, network-first then cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // For static assets, cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone())).catch(()=>{});
        return res;
      }).catch(()=> cached);
      return cached || fetched;
    })
  );
});
