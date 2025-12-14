'use client'
import { useEffect } from 'react'
import OneSignal from 'react-onesignal'
import { supabase } from '@/utils/supabase'

export default function OneSignalInit() {
  useEffect(() => {
    const runOneSignal = async () => {
      // Проверка на наличие ключа, чтобы не ломалось
      if (!process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID) {
        console.error('OneSignal App ID is missing')
        return
      }

      await OneSignal.init({
        appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID, // <--- БЕРЕМ ИЗ ENV
        allowLocalhostAsSecureOrigin: true,
        notifyButton: { enable: true },
      })

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await OneSignal.login(user.id)
      }
    }

    runOneSignal()
  }, [])

  return null
}