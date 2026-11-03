// Leafy Digital HRMS service worker: shows notifications and makes the app installable
// (Add to Home Screen on Android / iOS). It deliberately does not cache API data.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = event.notification.data?.link || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus()
        client.postMessage({ type: 'navigate', link })
        return
      }
    }
    await self.clients.openWindow(link)
  })())
})
