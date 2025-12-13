'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Paperclip, X, Reply, Trash2, FileText, Download } from 'lucide-react'

// Тип для сообщения
type Message = {
    id: string
    content: string
    file_url: string | null
    reply_to_id: string | null
    sender_id: string
    receiver_id: string
    created_at: string
}

export default function ChatPage() {
    const { id: partnerId } = useParams()
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')

    // Состояния для новых фич
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [partnerProfile, setPartnerProfile] = useState<any>(null)
    const [file, setFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [replyTo, setReplyTo] = useState<Message | null>(null) // На какое сообщение отвечаем

    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        init()
    }, [partnerId])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, replyTo, filePreview]) // Скроллим также при выборе файла или ответа

    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        setCurrentUser(user)

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', partnerId).single()
        setPartnerProfile(profile)

        fetchMessages(user.id)

        // ПОДПИСКА НА ВСЕ СОБЫТИЯ (INSERT, DELETE)
        const channel = supabase
            .channel(`room:${partnerId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {

                // 1. Новое сообщение
                if (payload.eventType === 'INSERT') {
                    const msg = payload.new as Message
                    if ((msg.sender_id === partnerId) || (msg.receiver_id === partnerId)) {
                        setMessages((prev) => [...prev, msg])
                    }
                }

                // 2. Удаление сообщения
                if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old.id
                    setMessages((prev) => prev.filter(m => m.id !== deletedId))
                }
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }

    const fetchMessages = async (myId: string) => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${myId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${myId})`)
            .order('created_at', { ascending: true })

        if (data) setMessages(data)
    }

    // --- ЛОГИКА ОТПРАВКИ ---

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0]
            setFile(f)
            // Если картинка - делаем превью
            if (f.type.startsWith('image/')) {
                setFilePreview(URL.createObjectURL(f))
            } else {
                setFilePreview(null) // Для обычных файлов превью иконкой
            }
        }
    }

    const clearComposer = () => {
        setNewMessage('')
        setFile(null)
        setFilePreview(null)
        setReplyTo(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const sendMessage = async () => {
        if ((!newMessage.trim() && !file) || !currentUser) return

        let uploadedUrl = null

        // 1. Загрузка файла
        if (file) {
            const fileExt = file.name.split('.').pop()
            const fileName = `${currentUser.id}-${Date.now()}.${fileExt}`
            const { error } = await supabase.storage.from('chat-attachments').upload(fileName, file)
            if (!error) {
                const { data } = supabase.storage.from('chat-attachments').getPublicUrl(fileName)
                uploadedUrl = data.publicUrl
            }
        }

        // 2. Отправка в БД
        await supabase.from('messages').insert({
            sender_id: currentUser.id,
            receiver_id: partnerId,
            content: newMessage,
            file_url: uploadedUrl,
            reply_to_id: replyTo?.id || null
        })

        clearComposer()
    }

    const deleteMessage = async (msgId: string) => {
        if (!confirm('Удалить сообщение?')) return
        await supabase.from('messages').delete().eq('id', msgId)
        // Realtime сам обновит UI
    }

    // Вспомогательная функция для поиска сообщения, на которое ответили
    const findReplyMessage = (replyId: string | null) => {
        if (!replyId) return null
        return messages.find(m => m.id === replyId)
    }

    return (
        <div className="flex flex-col h-screen bg-background text-foreground max-w-xl mx-auto border-x border-border">

            {/* Шапка */}
            <div className="flex items-center gap-4 p-4 border-b border-border bg-card shadow-sm z-10">
                <Link href="/messages" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft />
                </Link>
                {partnerProfile ? (
                    <Link href={`/u/${partnerProfile.id}`} className="flex items-center gap-3 hover:opacity-80 transition">
                        <img src={partnerProfile.avatar_url || '/placeholder.png'} className="w-9 h-9 rounded-full object-cover" />
                        <span className="font-bold">{partnerProfile.username}</span>
                    </Link>
                ) : <span>Загрузка...</span>}
            </div>

            {/* Сообщения */}
            <div className="flex-grow overflow-y-auto p-4 space-y-1 bg-background" ref={scrollRef}>
                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUser?.id
                    const replyMsg = findReplyMessage(msg.reply_to_id)
                    const isImage = msg.file_url && (msg.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null)

                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group mb-4`}>

                            {/* Само сообщение */}
                            <div
                                className={`relative max-w-[85%] p-3 rounded-2xl shadow-sm border border-transparent ${isMe
                                        ? 'bg-primary text-primary-foreground rounded-br-none'
                                        : 'bg-muted text-foreground rounded-bl-none border-border'
                                    }`}
                            >
                                {/* Блок цитаты (Reply) */}
                                {replyMsg && (
                                    <div className={`mb-2 text-xs border-l-2 pl-2 py-1 cursor-pointer opacity-80 ${isMe ? 'border-white/50' : 'border-primary'}`}>
                                        <span className="font-bold block">{replyMsg.sender_id === currentUser?.id ? 'Вы' : partnerProfile?.username}</span>
                                        <span className="truncate block max-w-[150px]">
                                            {replyMsg.file_url ? '[Вложение]' : replyMsg.content}
                                        </span>
                                    </div>
                                )}

                                {/* Файл / Картинка */}
                                {msg.file_url && (
                                    <div className="mb-2">
                                        {isImage ? (
                                            <a href={msg.file_url} target="_blank" rel="noopener noreferrer">
                                                <img src={msg.file_url} className="rounded-lg max-w-full max-h-64 object-cover" />
                                            </a>
                                        ) : (
                                            <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition">
                                                <FileText size={20} />
                                                <span className="underline text-sm">Скачать файл</span>
                                            </a>
                                        )}
                                    </div>
                                )}

                                {/* Текст */}
                                {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}

                                <div className={`text-[10px] mt-1 text-right opacity-70`}>
                                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>

                                {/* КНОПКИ УПРАВЛЕНИЯ (появляются при наведении) */}
                                <div className={`absolute top-0 ${isMe ? '-left-16' : '-right-16'} h-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity px-2`}>
                                    <button
                                        onClick={() => setReplyTo(msg)}
                                        className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary shadow-sm"
                                        title="Ответить"
                                    >
                                        <Reply size={14} />
                                    </button>
                                    {isMe && (
                                        <button
                                            onClick={() => deleteMessage(msg.id)}
                                            className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-red-500 shadow-sm"
                                            title="Удалить"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Панель ввода */}
            <div className="p-3 bg-card border-t border-border">

                {/* Панель "Ответ на сообщение" */}
                {replyTo && (
                    <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px] animate-in slide-in-from-bottom-2">
                        <div className="text-sm border-l-2 border-primary pl-2">
                            <span className="text-primary font-bold block">Ответ {replyTo.sender_id === currentUser?.id ? 'себе' : partnerProfile?.username}</span>
                            <span className="text-muted-foreground text-xs truncate block max-w-[200px]">
                                {replyTo.file_url ? '[Файл] ' : ''}{replyTo.content}
                            </span>
                        </div>
                        <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
                    </div>
                )}

                {/* Панель "Выбран файл" */}
                {file && (
                    <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]">
                        <div className="flex items-center gap-2">
                            {filePreview ? (
                                <img src={filePreview} className="w-8 h-8 rounded object-cover border border-border" />
                            ) : (
                                <FileText className="text-primary" />
                            )}
                            <span className="text-sm text-foreground truncate max-w-[200px]">{file.name}</span>
                        </div>
                        <button onClick={() => { setFile(null); setFilePreview(null) }} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
                    </div>
                )}

                <div className="flex items-end gap-2">
                    {/* Кнопка Файла */}
                    <label className="p-3 rounded-xl cursor-pointer text-muted-foreground hover:bg-muted hover:text-primary transition h-[50px] flex items-center justify-center">
                        <Paperclip size={20} />
                        <input
                            type="file"
                            onChange={handleFileSelect}
                            className="hidden"
                            ref={fileInputRef}
                        />
                    </label>

                    {/* Поле ввода */}
                    <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                        placeholder="Сообщение..."
                        className="flex-grow bg-muted text-foreground p-3 rounded-xl focus:outline-none focus:border-primary border border-transparent transition placeholder-muted-foreground resize-none min-h-[50px] max-h-[120px]"
                        rows={1}
                    />

                    {/* Кнопка Отправки */}
                    <button
                        onClick={sendMessage}
                        className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition shadow-lg shadow-primary/20 h-[50px] aspect-square flex items-center justify-center"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    )
}