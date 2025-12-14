'use client'
import { useEffect, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { usePathname, useRouter } from 'next/navigation'

export function NotificationListener() {
    const pathname = usePathname()
    const router = useRouter()
    const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        // Инициализируем аудио
        audioRef.current = new Audio('/notify.mp3')

        // Запускаем слежку
        const setupListener = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const channel = supabase
                .channel('global_notifications')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'messages' },
                    async (payload) => {
                        const msg = payload.new

                        // 1. Сообщение не мне? Игнорируем.
                        if (msg.receiver_id !== user.id) return

                        // 2. Сообщение от меня? Игнорируем (бывает при открытии в двух вкладках).
                        if (msg.sender_id === user.id) return

                        // 3. Я прямо сейчас в этом чате и вкладка активна? Не шумим.
                        const isInChat = pathname === `/messages/${msg.sender_id}`
                        const isTabFocused = document.visibilityState === 'visible'

                        if (isInChat && isTabFocused) return

                        // --- ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ---

                        // А. Играем звук
                        try {
                            audioRef.current?.play()
                        } catch (e) {
                            console.log('Autoplay blocked (user needs to interact first)')
                        }

                        // Б. Получаем имя отправителя (чтобы красиво написать в пуше)
                        const { data: senderProfile } = await supabase
                            .from('profiles')
                            .select('username, avatar_url')
                            .eq('id', msg.sender_id)
                            .single()

                        const senderName = senderProfile?.username || 'Кто-то'

                        // В. Показываем браузерное уведомление
                        if (Notification.permission === 'granted') {
                            const notification = new Notification(`Новое сообщение от ${senderName}`, {
                                body: msg.content || (msg.file_url ? 'Отправил файл' : ''),
                                icon: senderProfile?.avatar_url || '/placeholder.png', // Аватарка отправителя
                                tag: `msg-${msg.sender_id}` // Чтобы не спамить кучей окон от одного юзера
                            })

                            // При клике открываем чат
                            notification.onclick = () => {
                                window.focus()
                                router.push(`/messages/${msg.sender_id}`)
                            }
                        }
                    }
                )
                .subscribe()

            return () => { supabase.removeChannel(channel) }
        }

        setupListener()
    }, [pathname, router]) // Перезапускаем логику, если меняется страница (чтобы обновить проверку isInChat)

    return null // Этот компонент ничего не рисует
}