'use strict'

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any }

// Важно: слушаем message на инициализации SW (иначе Chrome ругается)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.skipWaiting()
clientsClaim()

// Прекэш статики, манифест подставляется Workbox-ом
precacheAndRoute(self.__WB_MANIFEST || [])

