'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Conversation = {
    partner: {
        id: string
        username: string
        avatar_url: string | null
        last_seen: string | null
    }
    lastMessage: string | null
    lastHasFile: boolean
    lastFromMe: boolean
    date: string
    unreadCount: number
}

// Хелпер проверки онлайна (та же логика, что в чате)
const checkIsOnline = (lastSeen: string | null) => {
    if (!lastSeen) return false
    const diff = new Date().getTime() - new Date(lastSeen).getTime()
    return diff < 2 * 60 * 1000
}

const formatDate = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    const isToday =
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()

    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString()
}

export default function MessagesList() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)
    const PLACEHOLDER_IMG = '/placeholder.png'

    const loadConversations = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            setLoading(false)
            return
        }

        // Получаем все сообщения, где я отправитель или получатель
        const { data: messages } = await supabase
            .from('messages')
            .select(`
        *,
        sender:profiles!sender_id(id, username, avatar_url, last_seen),
        receiver:profiles!receiver_id(id, username, avatar_url, last_seen)
      `)
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .order('created_at', { ascending: false })

        if (messages) {
            // Группируем по собеседнику
            const map = new Map<string, Conversation>()

            messages.forEach((msg: any) => {
                const isFromMe = msg.sender_id === user.id
                const partner = isFromMe ? msg.receiver : msg.sender
                const partnerId = partner.id

                const isUnreadForMe = !isFromMe && msg.receiver_id === user.id && !msg.is_read

                const hasFile =
                    (msg.file_urls && msg.file_urls.length > 0) ||
                    !!msg.file_url

                if (!map.has(partnerId)) {
                    const firstFileUrl =
                        (msg.file_urls && msg.file_urls[0]) ||
                        msg.file_url ||
                        null

                    const firstFileName =
                        (msg.file_names && msg.file_names[0]) ||
                        null

                    const ext = firstFileUrl
                        ? firstFileUrl.split('.').pop()?.toLowerCase()
                        : ''

                    const isAudioFile =
                        firstFileUrl && firstFileUrl.match(/\.(webm|mp3|wav|m4a)$/i)

                    const fileLabel = firstFileName
                        ? firstFileName
                        : ext
                            ? `Файл .${ext}`
                            : 'Файл'

                    map.set(partnerId, {
                        partner,
                        lastMessage:
                            msg.content ||
                            (hasFile
                                ? isAudioFile
                                    ? 'Голосовое сообщение'
                                    : fileLabel
                                : null),
                        lastHasFile: hasFile,
                        lastFromMe: isFromMe,
                        date: msg.created_at,
                        unreadCount: isUnreadForMe ? 1 : 0,
                    })
                } else if (isUnreadForMe) {
                    const existing = map.get(partnerId)!
                    map.set(partnerId, {
                        ...existing,
                        unreadCount: existing.unreadCount + 1,
                    })
                }
            })

            setConversations(Array.from(map.values()))
        }
        setLoading(false)
    }

    const requestPermission = () => {
        Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
                alert('Уведомления включены! 🎉')
                new Notification('Проверка связи', { body: 'Теперь вы не пропустите сообщения' })
            } else {
                alert('Вы запретили уведомления в настройках браузера.')
            }
        })
    }

    useEffect(() => {
        loadConversations()

        let channel: any = null

        const setupRealtime = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            channel = supabase
                .channel(`conversations:${user.id}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'messages' },
                    (payload) => {
                        const msg: any = payload.new || payload.old
                        if (!msg) return
                        if (msg.sender_id === user.id || msg.receiver_id === user.id) {
                            loadConversations()
                        }
                    }
                )
                .subscribe()
        }

        setupRealtime()

        return () => {
            if (channel) supabase.removeChannel(channel)
        }
    }, [])

    return (
        <div className="min-h-screen bg-background text-foreground p-4 max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft />
                    </Link>
                    <h1 className="text-2xl font-bold">Сообщения</h1>
                </div>

                {/* КНОПКА РАЗРЕШЕНИЯ */}
                <button
                    onClick={requestPermission}
                    className="p-2 bg-muted rounded-full hover:text-primary transition"
                    title="Включить уведомления"
                >
                    <Bell size={20} />
                </button>
            </div>

            <div className="space-y-2">
                {loading ? (
                    <p>Загрузка...</p>
                ) : (
                    conversations.map((chat) => {
                        const isOnline = checkIsOnline(chat.partner.last_seen)
                        const hasUnread = chat.unreadCount > 0

                        const previewPrefix = chat.lastFromMe ? 'Вы: ' : ''
                        const previewText = chat.lastMessage || (chat.lastHasFile ? 'Вложение' : 'Нет сообщений')

                        return (
                            <Link
                                key={chat.partner.id}
                                href={`/messages/${chat.partner.id}`}
                                className={`flex items-center gap-4 p-4 bg-card border rounded-2xl transition ${
                                    hasUnread
                                        ? 'border-primary/60 shadow-sm shadow-primary/20'
                                        : 'border-border hover:bg-muted/50'
                                }`}
                            >
                                <div className="relative">
                                    <img
                                        src={chat.partner.avatar_url || PLACEHOLDER_IMG}
                                        className="w-12 h-12 rounded-full object-cover"
                                        onError={(e) => {
                                            e.currentTarget.src = PLACEHOLDER_IMG
                                        }}
                                    />
                                    {isOnline && (
                                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full" />
                                    )}
                                </div>

                                <div className="flex-grow overflow-hidden">
                                    <div className="flex justify-between items-center">
                                        <h3 className={`font-bold ${hasUnread ? 'text-foreground' : 'text-foreground/90'}`}>
                                            {chat.partner.username}
                                        </h3>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDate(chat.date)}
                                        </span>
                                    </div>
                                    <p
                                        className={`text-sm truncate ${
                                            hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'
                                        }`}
                                    >
                                        {previewPrefix}
                                        {previewText}
                                    </p>
                                </div>

                                {hasUnread && (
                                    <div className="ml-2">
                                        <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                                            {chat.unreadCount > 9 ? '9+' : chat.unreadCount}
                                        </span>
                                    </div>
                                )}
                            </Link>
                        )
                    })
                )}

                {!loading && conversations.length === 0 && (
                    <p className="text-center text-muted-foreground mt-10">У вас пока нет диалогов.</p>
                )}
            </div>
        </div>
    )
}