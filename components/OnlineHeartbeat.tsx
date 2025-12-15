'use client'
import { useEffect } from 'react'
import { supabase } from '@/utils/supabase'

export default function OnlineHeartbeat() {
    useEffect(() => {
        // Функция пинга
        const sendHeartbeat = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Просто обновляем время
            await supabase
                .from('profiles')
                .update({ last_seen: new Date().toISOString() })
                .eq('id', user.id)
        }

        // 1. Пинг при входе
        sendHeartbeat()

        // 2. Пинг каждые 30 секунд (30000 мс)
        const interval = setInterval(sendHeartbeat, 30000)

        return () => clearInterval(interval)
    }, [])

    return null
}