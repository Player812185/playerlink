'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Paperclip, X, Reply, Trash2, FileText, Mic, Square, Check, CheckCheck, Edit3, ChevronDown } from 'lucide-react'
import { RealtimeChannel } from '@supabase/supabase-js'

type Message = {
    id: string
    content: string
    file_url: string | null
    file_urls?: string[] | null
    file_names?: string[] | null
    reply_to_id: string | null
    sender_id: string
    receiver_id: string
    created_at: string
    updated_at?: string
    is_read: boolean
    isOptimistic?: boolean
    isError?: boolean
}

// Хелпер проверки онлайна (2 минуты запас)
const checkIsOnline = (lastSeen: string | null) => {
    if (!lastSeen) return false
    const diff = new Date().getTime() - new Date(lastSeen).getTime()
    return diff < 2 * 60 * 1000
}

function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    );
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

    const [files, setFiles] = useState<File[]>([])
    const [filePreviews, setFilePreviews] = useState<string[]>([])
    const [replyTo, setReplyTo] = useState<Message | null>(null)
    const [isRecording, setIsRecording] = useState(false)

    const [editingMessage, setEditingMessage] = useState<Message | null>(null)
    const [editingText, setEditingText] = useState('')
    const [isDragOver, setIsDragOver] = useState(false)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior
            })
            setShowScrollButton(false)
        }
    }

    const handleScroll = () => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current

        // Считаем, что мы "внизу", если до конца меньше 100px
        const bottomThreshold = 100
        const isBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold

        setIsNearBottom(isBottom)
        setShowScrollButton(!isBottom)
    }

    const fileInputRef = useRef<HTMLInputElement>(null)

    const [showScrollButton, setShowScrollButton] = useState(false)
    const [isNearBottom, setIsNearBottom] = useState(true)

    // Генератор ID комнаты
    const getRoomId = (userId1: string, userId2: string) => {
        return [userId1, userId2].sort().join('-')
    }

    useEffect(() => {
        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            setCurrentUser(user)

            // Загружаем профили
            const { data: myProf } = await supabase.from('profiles').select('*').eq('id', user.id).single()
            setMyProfile(myProf)

            const { data: profile } = await supabase.from('profiles').select('*').eq('id', partnerId).single()
            setPartnerProfile(profile)
            setIsPartnerOnline(checkIsOnline(profile?.last_seen))

            fetchMessages(user.id)
            markMessagesAsRead(user.id)

            // --- КАНАЛ 1: ЧАТ (Сообщения + Тайпинг) ---
            const roomId = getRoomId(user.id, partnerId as string)

            // Отписываемся от старых каналов, если были
            if (channelRef.current) supabase.removeChannel(channelRef.current)

            channelRef.current = supabase.channel(`room:${roomId}`, {
                config: { broadcast: { self: true } } // self: true чтобы видеть и свои сообщения сразу через сокет
            })

            channelRef.current
                .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
                    // Новое сообщение
                    if (payload.eventType === 'INSERT') {
                        const msg = payload.new as Message

                        // Проверка: сообщение принадлежит этому чату
                        if ((msg.sender_id === partnerId && msg.receiver_id === user.id) ||
                            (msg.sender_id === user.id && msg.receiver_id === partnerId)) {

                            setMessages((prev) => {
                                // Ищем, есть ли уже сообщение с таким ID (наше оптимистичное)
                                const exists = prev.find(m => m.id === msg.id)

                                if (exists) {
                                    // Если есть — обновляем его (убираем флаг isOptimistic, обновляем время от сервера)
                                    return prev.map(m => m.id === msg.id ? { ...m, ...msg, isOptimistic: false } : m)
                                }

                                // Если нет — добавляем новое
                                return [...prev, msg]
                            })

                            // Звук только для входящих
                            if (msg.sender_id === partnerId) {
                                markMessagesAsRead(user.id)
                                try { new Audio('/notify.mp3').play() } catch (e) { }
                            }
                        }
                    }
                    // Удаление
                    if (payload.eventType === 'DELETE') {
                        setMessages((prev) => prev.filter(m => m.id !== payload.old.id))
                    }
                    // Обновление (прочитано)
                    if (payload.eventType === 'UPDATE') {
                        setMessages((prev) => prev.map(m => m.id === payload.new.id ? payload.new as Message : m))
                    }
                })
                .on('broadcast', { event: 'typing' }, (payload) => {
                    // Игнорируем свои же сигналы
                    if (payload.payload.user_id === partnerId) {
                        setIsTyping(true)
                        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
                        typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000)
                    }
                })
                .subscribe()

            // --- КАНАЛ 2: СТАТУС ПАРТНЕРА (Обновление профиля) ---
            const profileChannel = supabase.channel(`profile:${partnerId}`)
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${partnerId}`
                }, (payload) => {
                    const newProfile = payload.new
                    setPartnerProfile(newProfile)
                    setIsPartnerOnline(checkIsOnline(newProfile.last_seen))
                })
                .subscribe()

            return () => {
                if (channelRef.current) supabase.removeChannel(channelRef.current)
                supabase.removeChannel(profileChannel)
            }
        }

        init()
    }, [partnerId])

    useEffect(() => {
        const lastMsg = messages[messages.length - 1]
        const isMyMessage = lastMsg?.sender_id === currentUser?.id

        // Скроллим если:
        // 1. Сообщение мое (всегда)
        // 2. Я уже был внизу (читаю новые)
        // 3. Это первый рендер (нет сообщений или только загрузились)
        if (isMyMessage || isNearBottom) {
            // 'auto' для первого рендера, чтобы не мелькало, 'smooth' для новых сообщений
            scrollToBottom(messages.length === 0 ? 'auto' : 'smooth')
        }
    }, [messages, replyTo, filePreviews, isRecording, isTyping])

    // Периодическое обновление статуса (каждые 30 сек пересчитываем "минуты назад")
    useEffect(() => {
        const interval = setInterval(() => {
            if (partnerProfile) setIsPartnerOnline(checkIsOnline(partnerProfile.last_seen))
        }, 30000)
        return () => clearInterval(interval)
    }, [partnerProfile])

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
        const value = e.target.value

        if (editingMessage) {
            setEditingText(value)
        } else {
            setNewMessage(value)
            if (currentUser && channelRef.current) {
                channelRef.current.send({
                    type: 'broadcast',
                    event: 'typing',
                    payload: { user_id: currentUser.id }
                })
            }
        }
    }

    const processFiles = (newFiles: FileList | File[]) => {
        const arr = Array.from(newFiles)
        setFiles(prev => [...prev, ...arr])
        setFilePreviews(prev => [
            ...prev,
            ...arr.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
        ])
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return
        processFiles(e.target.files)
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        if (e.clipboardData.files?.length) {
            e.preventDefault()
            processFiles(e.clipboardData.files)
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
                if (audioBlob.size > 0) {
                    const audioFile = new File([audioBlob], 'voice.webm', { type: 'audio/webm' })
                    await sendMessage(audioFile, 'audio')
                }
                stream.getTracks().forEach(t => t.stop())
            }
            mediaRecorder.start()
            setIsRecording(true)
        } catch { alert('Микрофон недоступен') }
    }
    const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false) }

    const startEditMessage = (msg: Message) => {
        if (msg.file_url) return // Пока не редактируем сообщения с файлами/голосовыми
        setEditingMessage(msg)
        setEditingText(msg.content)
        setReplyTo(null)
        setFiles([])
        setFilePreviews([])
    }

    const cancelEdit = () => {
        setEditingMessage(null)
        setEditingText('')
    }

    const saveEdit = async () => {
        if (!editingMessage || !editingText.trim()) {
            cancelEdit()
            return
        }
        if (!currentUser) return

        const { data, error } = await supabase
            .from('messages')
            .update({ content: editingText })
            .eq('id', editingMessage.id)
            .eq('sender_id', currentUser.id)
            .select('*')
            .single()

        if (error) {
            console.error('Ошибка обновления сообщения', error)
            alert('Не удалось изменить сообщение (ограничения безопасности).')
            return
        }

        // Обновляем локально подтверждённым значением из БД
        setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...(m as Message), ...(data as Message) } : m))

        cancelEdit()
    }

    const sendMessage = async (overrideFile?: File, type: 'text' | 'audio' = 'text') => {
        const fileToSend = overrideFile || files[0]
        const textToSend = type === 'audio' ? '' : newMessage
        const hasAnyFiles = overrideFile ? true : files.length > 0

        if ((!textToSend.trim() && !hasAnyFiles) || !currentUser) return

        // 1. Генерируем НАСТОЯЩИЙ UUID на клиенте
        const messageId = uuidv4()

        const optimisticMsg: Message = {
            id: messageId, // <--- Используем его здесь
            content: textToSend,
            sender_id: currentUser.id,
            receiver_id: partnerId as string,
            created_at: new Date().toISOString(),
            is_read: false,
            reply_to_id: replyTo?.id || null,
            file_url: null,
            isOptimistic: true
        }

        // 2. СРАЗУ добавляем в стейт
        if (!hasAnyFiles) {
            setMessages(prev => [...prev, optimisticMsg])
            setNewMessage('')
            setReplyTo(null)
            setTimeout(() => scrollToBottom(), 10)
        }

        // 3. Логика загрузки файлов (без изменений, просто копируем старую логику сюда)
        let uploadedUrl: string | null = null
        let uploadedUrls: string[] = []
        let fileNames: string[] = []

        if (overrideFile) {
            // ... (твой старый код загрузки одного файла)
            const ext = overrideFile.name.split('.').pop()
            const path = `${currentUser.id}-${Date.now()}.${ext}`
            const { error } = await supabase.storage.from('chat-attachments').upload(path, overrideFile)
            if (!error) {
                const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
                uploadedUrl = data.publicUrl
                uploadedUrls = [data.publicUrl]
                fileNames = [overrideFile.name]
            }
        } else if (files.length > 0) {
            // ... (твой старый код загрузки массива файлов)
            for (const f of files) {
                const ext = f.name.split('.').pop()
                const path = `${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
                const { error } = await supabase.storage.from('chat-attachments').upload(path, f)
                if (!error) {
                    const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
                    uploadedUrls.push(data.publicUrl)
                    fileNames.push(f.name)
                }
            }
            uploadedUrl = uploadedUrls[0] || null
        }

        const { error } = await supabase.from('messages').insert({
            id: messageId, // <--- !!! ЭТА СТРОКА ОБЯЗАТЕЛЬНА !!!
            sender_id: currentUser.id,
            receiver_id: partnerId,
            content: textToSend,
            file_url: uploadedUrl,
            file_urls: uploadedUrls.length > 0 ? uploadedUrls : null,
            file_names: fileNames.length > 0 ? fileNames : null,
            reply_to_id: optimisticMsg.reply_to_id
        })

        // 5. Обработка результата
        if (error) {
            console.error('Ошибка отправки', error)
            // Помечаем сообщение как ошибочное (по тому же ID)
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isOptimistic: false, isError: true } : m))
        } else {
            // Успех!
            // Снимаем флаг optimistic. Данные менять не надо, ID и так верный.
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isOptimistic: false } : m))

            if (!hasAnyFiles) {
                // Если файлов не было, мы уже очистили поле в пункте 2
            } else {
                setNewMessage('')
                setFiles([])
                setFilePreviews([])
                setReplyTo(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
            }

            // Push уведомление
            if (type !== 'audio') {
                fetch('/api/send-push', {
                    method: 'POST',
                    body: JSON.stringify({
                        receiverId: partnerId,
                        message: hasAnyFiles ? 'Файл' : textToSend,
                        senderName: myProfile?.username
                    })
                })
            }
        }
    }

    const deleteMessage = async (msg: Message) => {
        if (!confirm('Удалить?')) return
        const urls = (msg.file_urls && msg.file_urls.length > 0)
            ? msg.file_urls
            : (msg.file_url ? [msg.file_url] : [])

        if (urls.length) {
            const paths = urls
                .map(u => u.split('/').pop()!)
                .filter(Boolean)
            if (paths.length) {
                await supabase.storage.from('chat-attachments').remove(paths)
            }
        }
        await supabase.from('messages').delete().eq('id', msg.id)
    }

    const getLastSeenText = () => {
        if (isPartnerOnline) return 'В сети'
        if (isTyping) return 'Печатает...'
        if (!partnerProfile?.last_seen) return 'Оффлайн'
        const d = new Date(partnerProfile.last_seen)
        return `Был(а) ${d.toLocaleDateString()} в ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files)
        }
    }

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isDragOver) setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        // Игнорируем leave при переходе между внутренними элементами
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDragOver(false)
    }

    return (
        <div
            className={`flex flex-col h-screen bg-background text-foreground max-w-xl mx-auto border-x border-border relative ${isDragOver ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''
                }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* --- HEADER --- */}
            <div className="flex items-center gap-4 p-4 border-b border-border bg-card shadow-sm z-10">
                <Link href="/messages" className="text-muted-foreground hover:text-foreground"><ArrowLeft /></Link>
                {partnerProfile ? (
                    <Link href={`/u/${partnerProfile.id}`} className="flex items-center gap-3 hover:opacity-80 transition">
                        <div className="relative">
                            <img src={partnerProfile.avatar_url || '/placeholder.png'} className="w-10 h-10 rounded-full object-cover" />
                            {isPartnerOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full"></span>}
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

            {/* --- MESSAGES LIST --- */}
            <div
                className="flex-grow overflow-y-auto p-4 space-y-1 bg-background"
                ref={scrollRef}
                onScroll={handleScroll} // <--- ВАЖНО: Обработчик скролла
            >
                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUser?.id
                    const replyMsg = messages.find(m => m.id === msg.reply_to_id)
                    const allUrls = (msg.file_urls && msg.file_urls.length > 0)
                        ? msg.file_urls
                        : (msg.file_url ? [msg.file_url] : [])
                    const allNames = (msg.file_names && msg.file_names.length === allUrls.length)
                        ? msg.file_names
                        : null
                    const isEdited = msg.updated_at && msg.updated_at !== msg.created_at
                    const isOptimistic = msg.isOptimistic
                    const isError = msg.isError

                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group mb-4 ${isOptimistic ? 'opacity-70' : ''}`}>
                            <div className={`relative max-w-[85%] p-3 rounded-2xl shadow-sm border 
            ${isError ? 'bg-red-500/10 border-red-500 text-red-500' : isMe ? 'bg-primary text-primary-foreground rounded-br-none border-transparent' : 'bg-muted text-foreground rounded-bl-none border-border'}`}>
                                {replyMsg && (
                                    <div className={`mb-2 text-xs border-l-2 pl-2 py-1 opacity-80 ${isMe ? 'border-white/50' : 'border-primary'}`}>
                                        <span className="font-bold block">
                                            {replyMsg.sender_id === currentUser?.id ? 'Вы' : partnerProfile?.username}
                                        </span>
                                        <span className="truncate block max-w-[150px]">
                                            {(replyMsg.file_urls && replyMsg.file_urls.length > 0) || replyMsg.file_url
                                                ? '[Вложение]'
                                                : replyMsg.content}
                                        </span>
                                    </div>
                                )}

                                {allUrls.length > 0 && (
                                    <div className="mb-2 space-y-2">
                                        {allUrls.map((url, index) => {
                                            const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)$/i)
                                            const isAudio = url.match(/\.(webm|mp3|wav|m4a)$/i)
                                            const ext = url.split('.').pop()?.toLowerCase()
                                            const originalName = allNames?.[index]
                                            const fileLabel = originalName
                                                ? originalName
                                                : ext
                                                    ? `Файл .${ext}`
                                                    : 'Файл'
                                            return (
                                                <div key={url}>
                                                    {isImage ? (
                                                        <a href={url} target="_blank">
                                                            <img src={url} className="rounded-lg max-h-64 object-cover" />
                                                        </a>
                                                    ) : isAudio ? (
                                                        <div className="flex flex-col gap-1">
                                                            <audio controls src={url} className="h-10 max-w-[220px]" />
                                                            <span className="text-[11px] text-white/80 truncate max-w-[220px]">
                                                                Голосовое сообщение{ext ? ` (.${ext})` : ''}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <a
                                                            href={url}
                                                            target="_blank"
                                                            className="flex items-center gap-2 bg-black/10 p-2 rounded max-w-[220px]"
                                                        >
                                                            <FileText size={20} />
                                                            <span className="text-xs truncate">
                                                                {fileLabel}
                                                            </span>
                                                        </a>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                                {msg.content && (
                                    <p className="whitespace-pre-wrap">
                                        {msg.content}
                                        {isEdited && <span className="ml-1 text-[10px] opacity-70">(изменено)</span>}
                                    </p>
                                )}
                                <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-muted-foreground'}`}>
                                    <span>
                                        {isOptimistic ? 'Отправка...' : new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {isMe && !isOptimistic && !isError && <span>{msg.is_read ? <CheckCheck size={14} /> : <Check size={14} />}</span>}
                                    {isError && <span title="Ошибка">⚠️</span>}
                                </div>
                                <div className={`absolute top-0 ${isMe ? '-left-16' : '-right-16'} h-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity px-2`}>
                                    <button onClick={() => setReplyTo(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary shadow-sm"><Reply size={14} /></button>
                                    {isMe && !msg.file_url && (
                                        <button
                                            onClick={() => startEditMessage(msg)}
                                            className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary shadow-sm"
                                        >
                                            <Edit3 size={14} />
                                        </button>
                                    )}
                                    {isMe && <button onClick={() => deleteMessage(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-red-500 shadow-sm"><Trash2 size={14} /></button>}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* --- КНОПКА СКРОЛЛА (Floating) --- */}
            {showScrollButton && (
                <div className="absolute bottom-24 right-4 z-20 md:right-8">
                    <button
                        onClick={() => scrollToBottom()}
                        className="bg-card/80 backdrop-blur text-primary border border-border p-3 rounded-full shadow-lg hover:bg-card transition animate-in fade-in zoom-in duration-200"
                    >
                        <ChevronDown size={24} />
                    </button>
                </div>
            )}

            {/* --- INPUT AREA --- */}
            <div className="p-3 bg-card border-t border-border z-20">
                {replyTo && <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]"><div className="text-sm border-l-2 border-primary pl-2"><span className="text-primary font-bold block">Ответ</span><span className="text-muted-foreground text-xs truncate max-w-[200px] block">{replyTo.content || '[Вложение]'}</span></div><button onClick={() => setReplyTo(null)}><X size={16} /></button></div>}
                {files.length > 0 && (
                    <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]">
                        <div className="flex items-center gap-2 overflow-x-auto">
                            {files.map((f, idx) => (
                                <div key={idx} className="flex items-center gap-2 mr-2">
                                    {filePreviews[idx] ? (
                                        <img src={filePreviews[idx]} className="w-8 h-8 rounded object-cover" />
                                    ) : (
                                        <FileText className="text-primary" />
                                    )}
                                    <span className="text-sm text-foreground truncate max-w-[120px]">{f.name}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => {
                                setFiles([])
                                setFilePreviews([])
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}
                <div className="flex items-end gap-2">
                    {!editingMessage && (
                        <label className="p-3 rounded-xl cursor-pointer text-muted-foreground hover:bg-muted hover:text-primary transition h-[50px] flex items-center justify-center">
                            <Paperclip size={20} />
                            <input type="file" multiple onChange={handleFileSelect} className="hidden" ref={fileInputRef} />
                        </label>
                    )}
                    {isRecording && !editingMessage ? (
                        <div className="flex-grow bg-red-500/10 text-red-500 p-3 rounded-xl flex items-center justify-between h-[50px] animate-pulse border border-red-500/20"><span className="font-bold text-sm">Запись...</span><button onClick={stopRecording} className="bg-red-500 text-white p-1.5 rounded-full"><Square size={14} /></button></div>
                    ) : (
                        <textarea
                            value={editingMessage ? editingText : newMessage}
                            onChange={handleTyping}
                            onPaste={handlePaste}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    if (editingMessage) saveEdit()
                                    else sendMessage()
                                }
                            }}
                            placeholder={editingMessage ? 'Редактировать сообщение...' : 'Сообщение...'}
                            className="flex-grow bg-muted text-foreground p-3 rounded-xl focus:outline-none focus:border-primary border border-transparent transition placeholder-muted-foreground resize-none min-h-[50px] max-h-[120px]"
                            rows={1}
                        />
                    )}
                    {editingMessage ? (
                        <div className="flex gap-2">
                            <button
                                onClick={cancelEdit}
                                className="px-3 py-2 rounded-xl bg-muted text-muted-foreground hover:bg-muted/80 h-[50px] flex items-center text-sm"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={saveEdit}
                                className="bg-primary text-primary-foreground px-4 py-2 rounded-xl hover:bg-primary/90 transition shadow-lg h-[50px] flex items-center justify-center text-sm font-semibold"
                            >
                                Сохранить
                            </button>
                        </div>
                    ) : newMessage.trim() || files.length > 0 ? (
                        <button
                            onClick={() => sendMessage()}
                            className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition shadow-lg h-[50px] aspect-square flex items-center justify-center"
                        >
                            <Send size={20} />
                        </button>
                    ) : (
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`p-3 rounded-xl transition shadow-lg h-[50px] aspect-square flex items-center justify-center ${isRecording ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground hover:text-primary'
                                }`}
                        >
                            {isRecording ? <Send size={20} /> : <Mic size={20} />}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}