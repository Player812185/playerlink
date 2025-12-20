'use strict'

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any }

self.skipWaiting()
clientsClaim()

// Игнорируем пуши OneSignal, чтобы они обрабатывались их собственным воркером
// или просто пропускаем их, если они не для нас
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Прекэш статики
precacheAndRoute(self.__WB_MANIFEST || [])