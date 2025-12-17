'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Тип данных, который возвращает наша SQL-функция
type Conversation = {
    partner_id: string
    username: string
    avatar_url: string | null
    last_seen: string | null
    last_message_content: string | null
    last_message_created_at: string
    last_message_is_from_me: boolean
    has_file: boolean
    unread_count: number
}

// Хелперы
const checkIsOnline = (lastSeen: string | null) => {
    if (!lastSeen) return false
    const diff = new Date().getTime() - new Date(lastSeen).getTime()
    return diff < 2 * 60 * 1000
}

const formatDate = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
    return isToday ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString()
}

export default function MessagesList() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)
    const PLACEHOLDER_IMG = '/placeholder.png'

    // Новая функция загрузки через RPC
    const loadConversations = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return setLoading(false)

        // ВЫЗОВ API (SQL ФУНКЦИИ)
        const { data, error } = await supabase.rpc('get_my_conversations')

        if (error) console.error('Ошибка загрузки диалогов:', error)
        if (data) setConversations(data)

        setLoading(false)
    }

    const requestPermission = () => {
        Notification.requestPermission().then((p) => {
            if (p === 'granted') new Notification('Уведомления включены!')
        })
    }

    useEffect(() => {
        loadConversations()

        // Подписка на изменения, чтобы список обновлялся в реальном времени
        const channel = supabase.channel('conversations_list')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
                // При любом сообщении просто передергиваем список (это дешево теперь)
                loadConversations()
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
                // Обновляем статусы "в сети"
                loadConversations()
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [])

    return (
        <div className="min-h-screen bg-background text-foreground p-4 max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft /></Link>
                    <h1 className="text-2xl font-bold">Сообщения</h1>
                </div>
                <button onClick={requestPermission} className="p-2 bg-muted rounded-full hover:text-primary transition">
                    <Bell size={20} />
                </button>
            </div>

            <div className="space-y-2">
                {loading ? <p className="text-muted-foreground p-4">Загрузка...</p> : conversations.length === 0 ? (
                    <p className="text-center text-muted-foreground mt-10">Нет диалогов</p>
                ) : (
                    conversations.map((chat) => {
                        const isOnline = checkIsOnline(chat.last_seen)
                        // Формируем текст превью
                        const previewText = chat.last_message_content || (chat.has_file ? 'Вложение' : 'Пустое сообщение')
                        const prefix = chat.last_message_is_from_me ? 'Вы: ' : ''

                        return (
                            <Link
                                key={chat.partner_id}
                                href={`/messages/${chat.partner_id}`}
                                className={`flex items-center gap-4 p-4 bg-card border rounded-2xl transition ${chat.unread_count > 0 ? 'border-primary/60 shadow-sm shadow-primary/20' : 'border-border hover:bg-muted/50'
                                    }`}
                            >
                                <div className="relative">
                                    <img
                                        src={chat.avatar_url || PLACEHOLDER_IMG}
                                        className="w-12 h-12 rounded-full object-cover"
                                        onError={(e) => { e.currentTarget.src = PLACEHOLDER_IMG }}
                                    />
                                    {isOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full" />}
                                </div>

                                <div className="flex-grow overflow-hidden">
                                    <div className="flex justify-between items-center">
                                        <h3 className={`font-bold ${chat.unread_count > 0 ? 'text-foreground' : 'text-foreground/90'}`}>
                                            {chat.username}
                                        </h3>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDate(chat.last_message_created_at)}
                                        </span>
                                    </div>
                                    <p className={`text-sm truncate ${chat.unread_count > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                        {prefix}{previewText}
                                    </p>
                                </div>

                                {chat.unread_count > 0 && (
                                    <div className="ml-2 min-w-[22px] px-1.5 py-0.5 rounded-full bg-primary text-[11px] font-bold text-primary-foreground text-center">
                                        {chat.unread_count > 9 ? '9+' : chat.unread_count}
                                    </div>
                                )}
                            </Link>
                        )
                    })
                )}
            </div>
        </div>
    )
}