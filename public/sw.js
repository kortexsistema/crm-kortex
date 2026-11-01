const CACHE_NAME = 'deskcomm-pwa-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignora chamadas que não sejam GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // NUNCA interceptar chamadas da API, rotas autenticadas dinâmicas (/app) ou extensões de terceiros
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/app') ||
    url.pathname.startsWith('/admin') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Apenas para assets estáticos ou root, com fallback seguro que nunca retorna undefined
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('', { status: 408, statusText: 'Network request failed' });
    })
  );
});
