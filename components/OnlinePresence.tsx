'use client'
import { useEffect } from 'react'
import { supabase } from '@/utils/supabase'

export default function OnlinePresence() {
    useEffect(() => {
        const trackPresence = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Канал для отслеживания присутствия
            const channel = supabase.channel('global-presence')

            channel
                .on('presence', { event: 'sync' }, () => {
                    // Этот компонент только отправляет статус, читать ему не обязательно
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        const track = async () => {
                            await channel.track({
                                user_id: user.id,
                                online_at: new Date().toISOString()
                            })
                        }
                        await track()

                        // Обновляем "last_seen" в базе при входе
                        await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id)
                    }
                })
        }

        trackPresence()
    }, [])

    return null
}