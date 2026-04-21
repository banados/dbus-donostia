/**
 * sw.js — Service Worker for DBus Donostia PWA.
 *
 * Strategy: cache-first for app shell assets, network-only for /api/* calls.
 */

const CACHE_NAME = 'dbus-donostia-v1';
const APP_SHELL = [
  '/',
  '/app.js',
  '/style.css',
  '/manifest.json',
];

// ---- Install: cache app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ---- Activate: remove old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---- Fetch: network-only for API, cache-first for shell ----
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always fetch API calls live — never serve from cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell: cache-first, fall back to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful GET responses for shell assets
        if (
          response.ok &&
          event.request.method === 'GET' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
