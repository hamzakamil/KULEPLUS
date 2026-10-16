// Eski service worker temizliği. Bu alan adı önceden PWA uygulamasını sunuyordu; tarayıcıda
// kalan eski worker önbelleğinden sayfa açılmaya devam ediyordu. Bu dosya eski worker'ın
// güncellenmesini sağlar: önbelleği siler, kendini kaldırır ve açık sekmeleri yeniler.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});
