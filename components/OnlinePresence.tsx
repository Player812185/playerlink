'use client'
import { useEffect } from 'react'
import { supabase } from '@/utils/supabase'

export default function OnlinePresence() {
    useEffect(() => {
        const trackPresence = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // 1. Обновляем БД (чтобы сохранилось время входа)
            await supabase
                .from('profiles')
                .update({ last_seen: new Date().toISOString() })
                .eq('id', user.id)

            // 2. Включаем WebSocket маячок (для зеленой точки в реальном времени)
            const channel = supabase.channel('online-users')
            channel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ user_id: user.id, online_at: new Date().toISOString() })
                }
            })
        }

        trackPresence()
    }, [])

    return null
}