/* ==========================================================================
   sw.js — service worker
   --------------------------------------------------------------------------
   Guarda a casca do app (HTML, CSS, JS) para abrir instantâneo e funcionar
   mesmo sem internet. Preço e busca sempre vão na rede: dado de preço velho
   seria pior do que nenhum.
   ========================================================================== */

const VERSAO = 'compfindr-v1';

const CASCA = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/store.js',
  '/js/api.js',
  '/js/ocr.js',
  '/js/scanner.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSAO)
      .then(function (c) { return c.addAll(CASCA); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        return n === VERSAO ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Preços e buscas nunca saem do cache.
  if (url.pathname.indexOf('/.netlify/functions/') === 0) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (guardado) {
      if (guardado) return guardado;
      return fetch(req).then(function (resp) {
        if (resp.ok && resp.type === 'basic') {
          const copia = resp.clone();
          caches.open(VERSAO).then(function (c) { c.put(req, copia); });
        }
        return resp;
      }).catch(function () {
        return caches.match('/index.html');
      });
    })
  );
});
