/**
 * Web Push service worker eklentisi — Faz 7 (ROADMAP §812, §822).
 *
 * vite-plugin-pwa `generateSW` stratejisinde önbellek mantığını Workbox üretir; bu dosya
 * `workbox.importScripts` ile üretilen SW'ye enjekte edilir ve yalnızca push olaylarını ele alır.
 * Payload: buildPushPayload çıktısı → { title, body, url, tag } (JSON).
 */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Kuleplus', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Kuleplus';
  const options = {
    body: data.body || '',
    icon: '/icons/pwa-192x192.png',
    badge: '/icons/favicon-32.png',
    data: { url: data.url || '/' },
    ...(data.tag ? { tag: data.tag } : {}),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if ('focus' in client) {
          await client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
