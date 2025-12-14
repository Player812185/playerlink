'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Paperclip, X, Reply, Trash2, FileText, Mic, Square, Check, CheckCheck } from 'lucide-react'
import { RealtimeChannel } from '@supabase/supabase-js'

type Message = {
    id: string
    content: string
    file_url: string | null
    reply_to_id: string | null
    sender_id: string
    receiver_id: string
    created_at: string
    is_read: boolean
}

export default function ChatPage() {
    const { id: partnerId } = useParams()
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')

    const [currentUser, setCurrentUser] = useState<any>(null)
    const [partnerProfile, setPartnerProfile] = useState<any>(null)
    const [myProfile, setMyProfile] = useState<any>(null)

    const [isPartnerOnline, setIsPartnerOnline] = useState(false)
    const [isTyping, setIsTyping] = useState(false)

    const channelRef = useRef<RealtimeChannel | null>(null)
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null) // Реф для звука

    const [file, setFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [replyTo, setReplyTo] = useState<Message | null>(null)
    const [isRecording, setIsRecording] = useState(false)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const getRoomId = (userId1: string, userId2: string) => {
        return [userId1, userId2].sort().join('-')
    }

    useEffect(() => {
        // Инициализация звука
        audioRef.current = new Audio('/notify.mp3')

        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            setCurrentUser(user)

            const { data: myProf } = await supabase.from('profiles').select('*').eq('id', user.id).single()
            setMyProfile(myProf)

            const { data: profile } = await supabase.from('profiles').select('*').eq('id', partnerId).single()
            setPartnerProfile(profile)

            fetchMessages(user.id)
            markMessagesAsRead(user.id)

            const roomId = getRoomId(user.id, partnerId as string)

            // 1. КАНАЛ ЧАТА (Сообщения + Печатает)
            channelRef.current = supabase.channel(`chat:${roomId}`, {
                config: { broadcast: { self: false } }
            })

            channelRef.current
                .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
                    if (payload.eventType === 'INSERT') {
                        const msg = payload.new as Message
                        // Проверяем, относится ли сообщение к этому чату
                        if ((msg.sender_id === partnerId && msg.receiver_id === user.id) || (msg.sender_id === user.id && msg.receiver_id === partnerId)) {
                            setMessages((prev) => [...prev, msg])

                            // ЕСЛИ СООБЩЕНИЕ ОТ ПАРТНЕРА:
                            if (msg.sender_id === partnerId) {
                                markMessagesAsRead(user.id)
                                // ИГРАЕМ ЗВУК 🔔
                                try { audioRef.current?.play() } catch (e) { }
                            }
                        }
                    }
                    if (payload.eventType === 'DELETE') {
                        setMessages((prev) => prev.filter(m => m.id !== payload.old.id))
                    }
                    if (payload.eventType === 'UPDATE') {
                        setMessages((prev) => prev.map(m => m.id === payload.new.id ? payload.new as Message : m))
                    }
                })
                .on('broadcast', { event: 'typing' }, (payload) => {
                    if (payload.payload.user_id === partnerId) {
                        setIsTyping(true)
                        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
                        typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000)
                    }
                })
                .subscribe()

            // 2. КАНАЛ ПРИСУТСТВИЯ (Слушаем 'global-presence')
            const presenceChannel = supabase.channel('global-presence')
            presenceChannel
                .on('presence', { event: 'sync' }, () => {
                    const state = presenceChannel.presenceState()
                    // Ищем партнера
                    const isOnline = Object.values(state).flat().some((u: any) => u.user_id === partnerId)
                    setIsPartnerOnline(isOnline)
                })
                .subscribe()

            return () => {
                if (channelRef.current) supabase.removeChannel(channelRef.current)
                supabase.removeChannel(presenceChannel)
            }
        }

        init()
    }, [partnerId])

    // ... (весь остальной код: fetchMessages, sendMessage, handleTyping и т.д. ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ)
    // ... Копируй остальные функции из предыдущего моего ответа, они там правильные.

    // ВАЖНО: Ниже я дублирую ключевые функции для контекста, но логику отправки мы не меняли.

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, [messages, replyTo, filePreview, isRecording, isTyping])

    const fetchMessages = async (myId: string) => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${myId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${myId})`)
            .order('created_at', { ascending: true })
        if (data) setMessages(data)
    }

    const markMessagesAsRead = async (myId: string) => {
        await supabase.from('messages').update({ is_read: true }).eq('sender_id', partnerId).eq('receiver_id', myId).eq('is_read', false)
    }

    const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNewMessage(e.target.value)
        if (currentUser && channelRef.current) {
            channelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: { user_id: currentUser.id }
            })
        }
    }

    const processFile = (f: File) => {
        setFile(f)
        if (f.type.startsWith('image/')) setFilePreview(URL.createObjectURL(f))
        else setFilePreview(null)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) processFile(e.target.files[0])
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        if (e.clipboardData.files.length > 0) {
            e.preventDefault()
            processFile(e.clipboardData.files[0])
        }
    }

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mediaRecorder = new MediaRecorder(stream)
            mediaRecorderRef.current = mediaRecorder
            audioChunksRef.current = []
            mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data) }
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                const audioFile = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' })
                await sendMessage(audioFile, 'audio')
                stream.getTracks().forEach(track => track.stop())
            }
            mediaRecorder.start()
            setIsRecording(true)
        } catch (err) { alert('Микрофон недоступен') }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop()
            setIsRecording(false)
        }
    }

    const sendMessage = async (overrideFile?: File, type: 'text' | 'audio' = 'text') => {
        const fileToSend = overrideFile || file
        const textToSend = type === 'audio' ? '' : newMessage
        if ((!textToSend.trim() && !fileToSend) || !currentUser) return
        let uploadedUrl = null
        if (fileToSend) {
            const fileExt = fileToSend.name.split('.').pop()
            const fileName = `${currentUser.id}-${Date.now()}.${fileExt}`
            const { error } = await supabase.storage.from('chat-attachments').upload(fileName, fileToSend)
            if (!error) {
                const { data } = supabase.storage.from('chat-attachments').getPublicUrl(fileName)
                uploadedUrl = data.publicUrl
            }
        }
        const { error } = await supabase.from('messages').insert({
            sender_id: currentUser.id, receiver_id: partnerId, content: textToSend, file_url: uploadedUrl, reply_to_id: replyTo?.id || null
        })
        if (!error && type !== 'audio') {
            fetch('/api/send-push', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receiverId: partnerId, message: fileToSend ? (type === 'audio' ? 'Голосовое сообщение 🎤' : 'Отправил файл 📎') : textToSend, senderName: myProfile?.username || 'Пользователь' })
            })
        }
        setNewMessage(''); setFile(null); setFilePreview(null); setReplyTo(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const deleteMessage = async (msg: Message) => {
        if (!confirm('Удалить?')) return
        if (msg.file_url) {
            try {
                const fileName = msg.file_url.split('/').pop()
                if (fileName) await supabase.storage.from('chat-attachments').remove([fileName])
            } catch (e) { }
        }
        await supabase.from('messages').delete().eq('id', msg.id)
    }

    const getLastSeenText = () => {
        if (isPartnerOnline) return 'В сети'
        if (isTyping) return 'Печатает...'
        if (!partnerProfile?.last_seen) return 'Оффлайн'
        const date = new Date(partnerProfile.last_seen)
        const now = new Date()
        const diff = (now.getTime() - date.getTime()) / 1000 / 60
        if (diff < 2) return 'Был(а) только что'
        return `Был(а) ${date.toLocaleDateString()} в ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }

    return (
        <div className="flex flex-col h-screen bg-background text-foreground max-w-xl mx-auto border-x border-border">
            <div className="flex items-center gap-4 p-4 border-b border-border bg-card shadow-sm z-10">
                <Link href="/messages" className="text-muted-foreground hover:text-foreground"><ArrowLeft /></Link>
                {partnerProfile ? (
                    <Link href={`/u/${partnerProfile.id}`} className="flex items-center gap-3 hover:opacity-80 transition">
                        <div className="relative">
                            <img src={partnerProfile.avatar_url || '/placeholder.png'} className="w-10 h-10 rounded-full object-cover" />
                            {isPartnerOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full animate-pulse"></span>}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-bold leading-none">{partnerProfile.username}</span>
                            <span className={`text-xs mt-1 transition-colors duration-300 ${isTyping ? 'text-primary font-bold animate-pulse' : isPartnerOnline ? 'text-green-500 font-medium' : 'text-muted-foreground'}`}>
                                {isTyping ? 'Печатает...' : getLastSeenText()}
                            </span>
                        </div>
                    </Link>
                ) : <span>Загрузка...</span>}
            </div>

            {/* ОСТАЛЬНОЙ РЕНДЕР (СООБЩЕНИЯ И ВВОД) ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ ИЗ ПРОШЛОГО ОТВЕТА */}
            <div className="flex-grow overflow-y-auto p-4 space-y-1 bg-background" ref={scrollRef}>
                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUser?.id
                    const replyMsg = messages.find(m => m.id === msg.reply_to_id)
                    const isImage = msg.file_url && (msg.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null)
                    const isAudio = msg.file_url && (msg.file_url.match(/\.(webm|mp3|wav|m4a)$/i) != null)
                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group mb-4`}>
                            <div className={`relative max-w-[85%] p-3 rounded-2xl shadow-sm border border-transparent ${isMe ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted text-foreground rounded-bl-none border-border'}`}>
                                {replyMsg && (
                                    <div className={`mb-2 text-xs border-l-2 pl-2 py-1 cursor-pointer opacity-80 ${isMe ? 'border-white/50' : 'border-primary'}`}>
                                        <span className="font-bold block">{replyMsg.sender_id === currentUser?.id ? 'Вы' : partnerProfile?.username}</span>
                                        <span className="truncate block max-w-[150px]">{replyMsg.file_url ? '[Вложение]' : replyMsg.content}</span>
                                    </div>
                                )}
                                {msg.file_url && (
                                    <div className="mb-2">
                                        {isImage ? (
                                            <a href={msg.file_url} target="_blank" rel="noreferrer"><img src={msg.file_url} className="rounded-lg max-w-full max-h-64 object-cover" /></a>
                                        ) : isAudio ? (
                                            <audio controls src={msg.file_url} className="max-w-[240px] h-10" />
                                        ) : (
                                            <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition"><FileText size={20} /> <span className="underline text-sm">Файл</span></a>
                                        )}
                                    </div>
                                )}
                                {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                                <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-muted-foreground'}`}>
                                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    {isMe && <span>{msg.is_read ? <CheckCheck size={14} /> : <Check size={14} />}</span>}
                                </div>
                                <div className={`absolute top-0 ${isMe ? '-left-16' : '-right-16'} h-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity px-2`}>
                                    <button onClick={() => setReplyTo(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary shadow-sm"><Reply size={14} /></button>
                                    {isMe && <button onClick={() => deleteMessage(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-red-500 shadow-sm"><Trash2 size={14} /></button>}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="p-3 bg-card border-t border-border">
                {replyTo && <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]"><div className="text-sm border-l-2 border-primary pl-2"><span className="text-primary font-bold block">Ответ</span><span className="text-muted-foreground text-xs truncate max-w-[200px] block">{replyTo.content || '[Вложение]'}</span></div><button onClick={() => setReplyTo(null)}><X size={16} /></button></div>}
                {file && <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]"><div className="flex items-center gap-2">{filePreview ? <img src={filePreview} className="w-8 h-8 rounded object-cover" /> : <FileText className="text-primary" />}<span className="text-sm text-foreground truncate max-w-[200px]">{file.name}</span></div><button onClick={() => { setFile(null); setFilePreview(null) }}><X size={16} /></button></div>}
                <div className="flex items-end gap-2">
                    <label className="p-3 rounded-xl cursor-pointer text-muted-foreground hover:bg-muted hover:text-primary transition h-[50px] flex items-center justify-center"><Paperclip size={20} /><input type="file" onChange={handleFileSelect} className="hidden" ref={fileInputRef} /></label>
                    {isRecording ? (
                        <div className="flex-grow bg-red-500/10 text-red-500 p-3 rounded-xl flex items-center justify-between h-[50px] animate-pulse border border-red-500/20"><span className="font-bold text-sm">Запись...</span><button onClick={stopRecording} className="bg-red-500 text-white p-1.5 rounded-full"><Square size={14} /></button></div>
                    ) : (
                        <textarea value={newMessage} onChange={handleTyping} onPaste={handlePaste} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Сообщение..." className="flex-grow bg-muted text-foreground p-3 rounded-xl focus:outline-none focus:border-primary border border-transparent transition placeholder-muted-foreground resize-none min-h-[50px] max-h-[120px]" rows={1} />
                    )}
                    {newMessage.trim() || file ? <button onClick={() => sendMessage()} className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition shadow-lg shadow-primary/20 h-[50px] aspect-square flex items-center justify-center"><Send size={20} /></button> : <button onClick={isRecording ? stopRecording : startRecording} className={`p-3 rounded-xl transition shadow-lg h-[50px] aspect-square flex items-center justify-center ${isRecording ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground hover:text-primary'}`}>{isRecording ? <Send size={20} /> : <Mic size={20} />}</button>}
                </div>
            </div>
        </div>
    )
}