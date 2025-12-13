'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, User } from 'lucide-react'

export default function MessagesList() {
    const [conversations, setConversations] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const PLACEHOLDER_IMG = '/placeholder.png'

    useEffect(() => {
        loadConversations()
    }, [])

    const loadConversations = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Сложный запрос: получаем все сообщения, где я отправитель или получатель
        const { data: messages } = await supabase
            .from('messages')
            .select(`
        *,
        sender:profiles!sender_id(id, username, avatar_url),
        receiver:profiles!receiver_id(id, username, avatar_url)
      `)
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .order('created_at', { ascending: false })

        if (messages) {
            // Группируем по собеседнику
            const map = new Map()

            messages.forEach((msg: any) => {
                // Определяем, кто собеседник (не я)
                const partner = msg.sender_id === user.id ? msg.receiver : msg.sender
                if (!map.has(partner.id)) {
                    map.set(partner.id, {
                        partner,
                        lastMessage: msg.content,
                        date: msg.created_at
                    })
                }
            })

            setConversations(Array.from(map.values()))
        }
        setLoading(false)
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-4 max-w-xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft />
                </Link>
                <h1 className="text-2xl font-bold">Сообщения</h1>
            </div>

            <div className="space-y-2">
                {loading ? <p>Загрузка...</p> : conversations.map((chat) => (
                    <Link
                        key={chat.partner.id}
                        href={`/messages/${chat.partner.id}`}
                        className="flex items-center gap-4 p-4 bg-card border border-border rounded-2xl hover:bg-muted/50 transition"
                    >
                        <img
                            src={chat.partner.avatar_url || PLACEHOLDER_IMG}
                            className="w-12 h-12 rounded-full object-cover"
                            onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                        />
                        <div className="flex-grow overflow-hidden">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold">{chat.partner.username}</h3>
                                <span className="text-xs text-muted-foreground">{new Date(chat.date).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">{chat.lastMessage}</p>
                        </div>
                    </Link>
                ))}
                {!loading && conversations.length === 0 && (
                    <p className="text-center text-muted-foreground mt-10">У вас пока нет диалогов.</p>
                )}
            </div>
        </div>
    )
}