/* Pré-Caixa · service worker
   Guarda o app no celular para abrir sem sinal dentro do mercado.
   Ao publicar uma versão nova, troque VERSION (e o ?v= no index.html): o celular baixa os arquivos de novo
   e o app recarrega sozinho na versão nova. */
var VERSION = 'pre-caixa-1.5.0';
var SHELL = [
  './',
  './index.html',
  './app.css?v=1.5.0',
  './app.js?v=1.5.0',
  './manifest.webmanifest',
  './vendor/zxing-wasm-reader-3.1.5.js',
  './vendor/zxing_reader-3.1.5.wasm',
  './vendor/zxing-library-0.21.3.min.js',
  './fonts/sofia-sans-extra-condensed-latin-700-normal.woff2',
  './fonts/sofia-sans-extra-condensed-latin-800-normal.woff2',
  './fonts/sofia-sans-extra-condensed-latin-900-normal.woff2',
  './fonts/sofia-sans-latin-400-normal.woff2',
  './fonts/sofia-sans-latin-500-normal.woff2',
  './fonts/sofia-sans-latin-600-normal.woff2',
  './fonts/sofia-sans-latin-700-normal.woff2',
  './fonts/sofia-sans-latin-800-normal.woff2',
  './fonts/fragment-mono-latin-400-normal.woff2',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
var SHELL_PATHS = SHELL.map(function (u) { return new URL(u, self.location.href).pathname; });

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function (cache) { return cache.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Arquivos do próprio app: responde do celular na hora e atualiza em segundo plano.
// Qualquer outra coisa (catálogo, integrações, outros caminhos) vai direto para a rede.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var isPage = req.mode === 'navigate';
  if (!isPage && SHELL_PATHS.indexOf(url.pathname) < 0) return;
  event.respondWith(
    caches.open(VERSION).then(function (cache) {
      var key = isPage ? './index.html' : req;
      return cache.match(key, { ignoreSearch: isPage }).then(function (hit) {
        var update = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        }).catch(function () { return null; });
        if (hit) { event.waitUntil(update); return hit; }
        return update.then(function (res) { return res || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
      });
    })
  );
});
