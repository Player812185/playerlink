'use client'
import { useEffect, useState, useRef, use } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Send, Paperclip, X, Reply, Trash2, FileText, Mic, Square, Play, Pause } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Message = {
    id: string
    content: string
    file_url: string | null
    file_type: 'image' | 'file' | 'audio' | null // Новое поле для определения типа
    file_name: string | null // Новое поле для имени файла
    reply_to_id: string | null
    sender_id: string
    receiver_id: string
    created_at: string
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
    // Next.js 15 unwrap params
    const { id: partnerId } = use(params)

    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [partnerProfile, setPartnerProfile] = useState<any>(null)

    // Файлы
    const [file, setFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)

    // Голосовые
    const [isRecording, setIsRecording] = useState(false)
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
    const [audioChunks, setAudioChunks] = useState<Blob[]>([])
    const [recordingTime, setRecordingTime] = useState(0)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // Аудио плеер (простой)
    const [playingAudio, setPlayingAudio] = useState<string | null>(null) // ID сообщения, которое играет
    const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({})

    const [replyTo, setReplyTo] = useState<Message | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        setCurrentUser(user)

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', partnerId).single()
        setPartnerProfile(profile)

        fetchMessages(user.id)

        const channel = supabase
            .channel(`room:${partnerId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    const msg = payload.new as Message
                    if ((msg.sender_id === partnerId && msg.receiver_id === user.id) ||
                        (msg.sender_id === user.id && msg.receiver_id === partnerId)) {
                        setMessages((prev) => [...prev, msg])

                        // Уведомление
                        if (msg.sender_id === partnerId && document.hidden) {
                            new Notification(`Новое сообщение от ${profile?.username}`, {
                                body: msg.content || (msg.file_type === 'audio' ? 'Голосовое сообщение' : 'Файл'),
                                icon: profile?.avatar_url || '/placeholder.png'
                            })
                        }
                    }
                }
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

    // --- ФАЙЛЫ ---
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0]
            setFile(f)
            if (f.type.startsWith('image/')) {
                setFilePreview(URL.createObjectURL(f))
            } else {
                setFilePreview(null)
            }
        }
    }

    // --- ГОЛОСОВЫЕ ---
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const recorder = new MediaRecorder(stream)
            setMediaRecorder(recorder)
            setAudioChunks([])

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) setAudioChunks((prev) => [...prev, e.data])
            }

            recorder.start()
            setIsRecording(true)
            setRecordingTime(0)
            timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
        } catch (err) {
            alert('Не удалось получить доступ к микрофону')
        }
    }

    const stopRecording = () => {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop()
            setIsRecording(false)
            if (timerRef.current) clearInterval(timerRef.current)

            // Ждем событие stop, чтобы получить полный blob
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
                const audioFile = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' })
                await sendMessage(audioFile, 'audio')
            }

            mediaRecorder.stream.getTracks().forEach(track => track.stop()) // Остановить микрофон
        }
    }

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s < 10 ? '0' : ''}${s}`
    }

    const toggleAudio = (msgId: string, url: string) => {
        const audio = audioRefs.current[msgId]
        if (!audio) {
            const newAudio = new Audio(url)
            newAudio.onended = () => setPlayingAudio(null)
            audioRefs.current[msgId] = newAudio
            newAudio.play()
            setPlayingAudio(msgId)
        } else {
            if (playingAudio === msgId) {
                audio.pause()
                setPlayingAudio(null)
            } else {
                // Остановить другие
                Object.values(audioRefs.current).forEach(a => a.pause())
                setPlayingAudio(msgId)
                audio.play()
            }
        }
    }

    // --- ОТПРАВКА ---
    const sendMessage = async (overrideFile?: File, overrideType?: string) => {
        const fileToSend = overrideFile || file

        if ((!newMessage.trim() && !fileToSend) || !currentUser) return

        let uploadedUrl = null
        let fileType = null
        let fileName = null

        if (fileToSend) {
            const fileExt = fileToSend.name.split('.').pop()
            const uniqueId = Math.random().toString(36).substring(7)
            const filePath = `${currentUser.id}-${Date.now()}-${uniqueId}.${fileExt}`

            const { error } = await supabase.storage.from('chat-attachments').upload(filePath, fileToSend)
            if (!error) {
                const { data } = supabase.storage.from('chat-attachments').getPublicUrl(filePath)
                uploadedUrl = data.publicUrl
                fileName = fileToSend.name

                if (overrideType === 'audio') fileType = 'audio'
                else if (fileToSend.type.startsWith('image/')) fileType = 'image'
                else fileType = 'file'
            }
        }

        await supabase.from('messages').insert({
            sender_id: currentUser.id,
            receiver_id: partnerId,
            content: newMessage,
            file_url: uploadedUrl,
            file_type: fileType, // Нужно добавить эту колонку в БД, либо определять по расширению
            file_name: fileName, // Нужно добавить эту колонку в БД
            reply_to_id: replyTo?.id || null
        })

        clearComposer()
    }

    const clearComposer = () => {
        setNewMessage('')
        setFile(null)
        setFilePreview(null)
        setReplyTo(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    useEffect(() => {
        // Запрос разрешения на уведомления
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission()
        }
        init()
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [partnerId])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, replyTo, filePreview, isRecording])

    return (
        <div className="flex flex-col h-screen bg-background text-foreground max-w-xl mx-auto border-x border-border">
            {/* Header */}
            <div className="flex items-center gap-4 p-4 border-b border-border bg-card shadow-sm z-10">
                <Link href="/messages" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft />
                </Link>
                {partnerProfile ? (
                    <Link href={`/u/${partnerProfile.username}`} className="flex items-center gap-3 hover:opacity-80 transition">
                        <img src={partnerProfile.avatar_url || '/placeholder.png'} className="w-9 h-9 rounded-full object-cover" />
                        <span className="font-bold">{partnerProfile.username}</span>
                    </Link>
                ) : <span>Загрузка...</span>}
            </div>

            {/* Messages */}
            <div className="flex-grow overflow-y-auto p-4 space-y-2 bg-background" ref={scrollRef}>
                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUser?.id
                    const replyMsg = messages.find(m => m.id === msg.reply_to_id)

                    // Определение типа файла, если колонки в БД еще нет (fallback)
                    let type = msg.file_type
                    if (!type && msg.file_url) {
                        if (msg.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) type = 'image'
                        else if (msg.file_url.match(/\.(webm|mp3|wav)$/i)) type = 'audio'
                        else type = 'file'
                    }

                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group mb-2`}>
                            <div className={`relative max-w-[85%] p-3 rounded-2xl shadow-sm border border-transparent 
                                ${isMe ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted text-foreground rounded-bl-none border-border'}`}>

                                {replyMsg && (
                                    <div className="mb-2 text-xs border-l-2 pl-2 py-1 opacity-80 border-current">
                                        <span className="font-bold block">{replyMsg.sender_id === currentUser?.id ? 'Вы' : partnerProfile?.username}</span>
                                        <span className="truncate block max-w-[150px]">
                                            {replyMsg.file_url ? '[Файл]' : replyMsg.content}
                                        </span>
                                    </div>
                                )}

                                {/* Контент */}
                                {type === 'image' && (
                                    <a href={msg.file_url!} target="_blank"><img src={msg.file_url!} className="rounded-lg max-w-full max-h-64 object-cover mb-1" /></a>
                                )}

                                {type === 'audio' && (
                                    <div className="flex items-center gap-2 bg-black/10 p-2 rounded-lg mb-1 min-w-[150px]">
                                        <button onClick={() => toggleAudio(msg.id, msg.file_url!)}>
                                            {playingAudio === msg.id ? <Pause size={20} /> : <Play size={20} />}
                                        </button>
                                        <div className="h-1 bg-current opacity-30 flex-grow rounded-full"></div>
                                        <span className="text-xs">Голосовое</span>
                                    </div>
                                )}

                                {type === 'file' && (
                                    <a href={msg.file_url!} download target="_blank" className="flex items-center gap-2 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition mb-1">
                                        <FileText size={24} />
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="text-sm font-medium truncate max-w-[150px]">{msg.file_name || 'Файл'}</span>
                                            <span className="text-[10px] opacity-70 underline">Скачать</span>
                                        </div>
                                    </a>
                                )}

                                {/* Текст с переносом слов */}
                                {msg.content && (
                                    <p className="whitespace-pre-wrap break-words break-all overflow-hidden">{msg.content}</p>
                                )}

                                <div className="text-[10px] mt-1 text-right opacity-70">
                                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>

                                {/* Actions */}
                                <div className={`absolute top-0 ${isMe ? '-left-8' : '-right-8'} h-full flex flex-col justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                                    <button onClick={() => setReplyTo(msg)} className="text-muted-foreground hover:text-primary"><Reply size={14} /></button>
                                    {isMe && <button onClick={() => confirm('Удалить?') && supabase.from('messages').delete().eq('id', msg.id)} className="text-muted-foreground hover:text-red-500"><Trash2 size={14} /></button>}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Input Area */}
            <div className="p-3 bg-card border-t border-border">
                {replyTo && (
                    <div className="flex justify-between bg-muted/50 p-2 rounded-t-xl mb-1 text-sm border-l-4 border-primary">
                        <div>Ответ для: {replyTo.sender_id === currentUser.id ? 'Себя' : partnerProfile?.username}</div>
                        <button onClick={() => setReplyTo(null)}><X size={14} /></button>
                    </div>
                )}
                {file && (
                    <div className="flex justify-between bg-muted/50 p-2 rounded-t-xl mb-1 text-sm">
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <button onClick={() => { setFile(null); setFilePreview(null) }}><X size={14} /></button>
                    </div>
                )}

                <div className="flex items-end gap-2">
                    {/* Attach */}
                    <label className="p-3 text-muted-foreground hover:text-primary cursor-pointer">
                        <Paperclip size={20} />
                        <input type="file" onChange={handleFileSelect} className="hidden" ref={fileInputRef} />
                    </label>

                    {/* Input */}
                    <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                        placeholder="Сообщение..."
                        className="flex-grow bg-muted text-foreground p-3 rounded-xl resize-none max-h-32 focus:outline-none focus:ring-1 focus:ring-primary"
                        rows={1}
                    />

                    {/* Voice / Send */}
                    {newMessage.trim() || file ? (
                        <button onClick={() => sendMessage()} className="p-3 bg-primary text-primary-foreground rounded-xl hover:opacity-90">
                            <Send size={20} />
                        </button>
                    ) : (
                        <button
                            onMouseDown={startRecording}
                            onMouseUp={stopRecording}
                            onTouchStart={(e) => { e.preventDefault(); startRecording() }}
                            onTouchEnd={(e) => { e.preventDefault(); stopRecording() }}
                            className={`p-3 rounded-xl transition ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-muted text-muted-foreground hover:text-primary'}`}
                        >
                            {isRecording ? <Square size={20} /> : <Mic size={20} />}
                        </button>
                    )}
                </div>
                {isRecording && <div className="text-center text-xs text-red-500 mt-1">Запись: {formatTime(recordingTime)}</div>}
            </div>
        </div>
    )
}