const CACHE_NAME = 'arthena-v5';

// Only cache static assets that never change
// arthena.js and arthena.css are NOT cached — always fetch fresh
// This ensures cross-device sync works without hard refresh
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/logo.png',
  '/manifest.json'
];

// JS/CSS that must always be fresh
const NEVER_CACHE = [
  '/arthena.js',
  '/arthena.css',
  '/index.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache: JS, CSS, HTML — always fetch from network
  if (NEVER_CACHE.some(p => url.pathname === p)) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Never cache Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for static assets (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
