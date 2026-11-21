// Guarda só a interface. Dados da API nunca entram no cache do aparelho.
const CACHE = 'emprestimos-v5';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put('/', copia));
          }
          return r;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then(
        (salvo) =>
          salvo ??
          fetch(req).then((r) => {
            if (r.ok) {
              const copia = r.clone();
              caches.open(CACHE).then((c) => c.put(req, copia));
            }
            return r;
          }),
      ),
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data?.json() ?? {};
  } catch {
    d = {};
  }
  e.waitUntil(
    self.registration.showNotification(d.titulo || 'Empréstimos', {
      body: d.corpo || 'Abra o app para ver as novidades.',
      icon: '/icons/icone-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || undefined,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let destino = new URL('/', self.location.origin);
  try {
    const u = new URL(e.notification.data?.url || '/', self.location.origin);
    if (u.origin === self.location.origin) destino = u;
  } catch {
    // Mantém a tela inicial.
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (janelas) => {
      const janela = janelas.find((j) => new URL(j.url).origin === self.location.origin);
      if (!janela) return self.clients.openWindow(destino.href);
      await janela.focus();
      return janela.navigate(destino.href).catch(() => self.clients.openWindow(destino.href));
    }),
  );
});
