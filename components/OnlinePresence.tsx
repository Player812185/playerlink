'use client'
import { useEffect } from 'react'
import { supabase } from '@/utils/supabase'

export default function OnlinePresence() {
    useEffect(() => {
        const trackPresence = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Подключаемся к глобальной комнате и говорим "Я тут"
            const channel = supabase.channel('online-users')

            channel
                .on('presence', { event: 'sync' }, () => {
                    // Здесь можно обрабатывать список всех онлайн (если нужно)
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await channel.track({
                            user_id: user.id,
                            online_at: new Date().toISOString()
                        })
                    }
                })
        }

        trackPresence()
    }, [])

    return null
}