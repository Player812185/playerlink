'use client'
import { useEffect } from 'react'
import { supabase } from '@/utils/supabase'

export default function OnlinePresence() {
  useEffect(() => {
    const trackPresence = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Используем уникальное и точное имя канала
      const channel = supabase.channel('playerlink-presence')

      channel
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            // Отправляем сигнал "Я онлайн"
            await channel.track({ 
              user_id: user.id, 
              online_at: new Date().toISOString() 
            })
            
            // Дублируем в базу данных (для статуса "Был в сети")
            await supabase
              .from('profiles')
              .update({ last_seen: new Date().toISOString() })
              .eq('id', user.id)
          }
        })
    }

    trackPresence()
  }, [])

  return null
}