'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Paperclip, X, Reply, Trash2, FileText, Mic, Square, Check, CheckCheck } from 'lucide-react'

type Message = {
    id: string
    content: string
    file_url: string | null
    reply_to_id: string | null
    sender_id: string
    receiver_id: string
    created_at: string
    is_read: boolean // Новое поле
}

export default function ChatPage() {
    const { id: partnerId } = useParams()
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [partnerProfile, setPartnerProfile] = useState<any>(null)
    
    // Файлы
    const [file, setFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [replyTo, setReplyTo] = useState<Message | null>(null)
    
    // Голосовые
    const [isRecording, setIsRecording] = useState(false)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])

    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 1. Инициализация и подписка
    useEffect(() => {
        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            setCurrentUser(user)
            
            const { data: profile } = await supabase.from('profiles').select('*').eq('id', partnerId).single()
            setPartnerProfile(profile)

            fetchMessages(user.id)
            markMessagesAsRead(user.id) // Сразу помечаем прочитанными

            // --- REALTIME ---
            const channel = supabase
                .channel(`room:${partnerId}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
                    
                    // А. Новое сообщение
                    if (payload.eventType === 'INSERT') {
                        const msg = payload.new as Message
                        if ((msg.sender_id === partnerId) || (msg.receiver_id === partnerId)) {
                            setMessages((prev) => [...prev, msg])
                            // Если сообщение от партнера и мы тут - помечаем прочитанным
                            if (msg.sender_id === partnerId) {
                                markMessagesAsRead(user.id)
                            }
                        }
                    }

                    // Б. Удаление
                    if (payload.eventType === 'DELETE') {
                        setMessages((prev) => prev.filter(m => m.id !== payload.old.id))
                    }

                    // В. Обновление (статус прочитано)
                    if (payload.eventType === 'UPDATE') {
                        setMessages((prev) => prev.map(m => m.id === payload.new.id ? payload.new as Message : m))
                    }
                })
                .subscribe()

            return () => { supabase.removeChannel(channel) }
        }

        init()
    }, [partnerId])

    // Автоскролл
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, replyTo, filePreview, isRecording])

    const fetchMessages = async (myId: string) => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${myId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${myId})`)
            .order('created_at', { ascending: true })
        if (data) setMessages(data)
    }

    const markMessagesAsRead = async (myId: string) => {
        // Обновляем все сообщения ОТ партнера, которые еще не прочитаны
        await supabase
            .from('messages')
            .update({ is_read: true })
            .eq('sender_id', partnerId)
            .eq('receiver_id', myId)
            .eq('is_read', false)
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
            const mediaRecorder = new MediaRecorder(stream)
            mediaRecorderRef.current = mediaRecorder
            audioChunksRef.current = []

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data)
            }

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                const audioFile = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' })
                // Сразу отправляем как файл
                await sendMessage(audioFile, 'audio')
                
                // Останавливаем стрим (выключаем микрофон)
                stream.getTracks().forEach(track => track.stop())
            }

            mediaRecorder.start()
            setIsRecording(true)
        } catch (err) {
            alert('Не удалось получить доступ к микрофону')
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop()
            setIsRecording(false)
        }
    }

    // --- ОТПРАВКА ---
    const sendMessage = async (overrideFile?: File, type: 'text' | 'audio' = 'text') => {
        const fileToSend = overrideFile || file
        const textToSend = type === 'audio' ? '' : newMessage

        if ((!textToSend.trim() && !fileToSend) || !currentUser) return

        let uploadedUrl = null

        // Загрузка файла/аудио
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
            sender_id: currentUser.id,
            receiver_id: partnerId,
            content: textToSend,
            file_url: uploadedUrl,
            reply_to_id: replyTo?.id || null
        })

        if (!error && type !== 'audio') {
            // Пуш только для текста/обычных файлов (чтобы не усложнять)
            fetch('/api/send-push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receiverId: partnerId,
                    message: fileToSend ? (type === 'audio' ? 'Голосовое сообщение 🎤' : 'Отправил файл 📎') : textToSend,
                    senderName: currentUser.user_metadata?.full_name || 'Пользователь'
                })
            })
        }

        // Очистка
        setNewMessage('')
        setFile(null)
        setFilePreview(null)
        setReplyTo(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    // --- УДАЛЕНИЕ ---
    const deleteMessage = async (msg: Message) => {
        if(!confirm('Удалить сообщение?')) return
        
        // 1. Сначала удаляем файл, если он есть
        if (msg.file_url) {
            try {
                // Вытаскиваем имя файла из URL
                const fileName = msg.file_url.split('/').pop()
                if (fileName) {
                    await supabase.storage.from('chat-attachments').remove([fileName])
                }
            } catch (e) { console.log('Ошибка удаления файла', e) }
        }

        // 2. Удаляем запись из БД
        await supabase.from('messages').delete().eq('id', msg.id)
    }

    return (
        <div className="flex flex-col h-screen bg-background text-foreground max-w-xl mx-auto border-x border-border">
            
            <div className="flex items-center gap-4 p-4 border-b border-border bg-card shadow-sm z-10">
                <Link href="/messages" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft />
                </Link>
                {partnerProfile ? (
                   <Link href={`/u/${partnerProfile.id}`} className="flex items-center gap-3 hover:opacity-80 transition">
                     <img src={partnerProfile.avatar_url || '/placeholder.png'} className="w-9 h-9 rounded-full object-cover"/>
                     <div className="flex flex-col">
                        <span className="font-bold leading-none">{partnerProfile.username}</span>
                        {/* Можно добавить статус "в сети", если будет время */}
                     </div>
                   </Link>
                ) : <span>Загрузка...</span>}
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-1 bg-background" ref={scrollRef}>
                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUser?.id
                    const replyMsg = messages.find(m => m.id === msg.reply_to_id)
                    const isImage = msg.file_url && (msg.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null)
                    const isAudio = msg.file_url && (msg.file_url.match(/\.(webm|mp3|wav|m4a)$/i) != null)

                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group mb-4`}>
                            <div 
                                className={`relative max-w-[85%] p-3 rounded-2xl shadow-sm border border-transparent ${
                                    isMe 
                                        ? 'bg-primary text-primary-foreground rounded-br-none' 
                                        : 'bg-muted text-foreground rounded-bl-none border-border'
                                }`}
                            >
                                {replyMsg && (
                                    <div className={`mb-2 text-xs border-l-2 pl-2 py-1 cursor-pointer opacity-80 ${isMe ? 'border-white/50' : 'border-primary'}`}>
                                        <span className="font-bold block">{replyMsg.sender_id === currentUser?.id ? 'Вы' : partnerProfile?.username}</span>
                                        <span className="truncate block max-w-[150px]">
                                            {replyMsg.file_url ? '[Вложение]' : replyMsg.content}
                                        </span>
                                    </div>
                                )}

                                {/* Вложения */}
                                {msg.file_url && (
                                    <div className="mb-2">
                                        {isImage ? (
                                            <a href={msg.file_url} target="_blank" rel="noreferrer">
                                                <img src={msg.file_url} className="rounded-lg max-w-full max-h-64 object-cover" />
                                            </a>
                                        ) : isAudio ? (
                                            <audio controls src={msg.file_url} className="max-w-[240px] h-10" />
                                        ) : (
                                            <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition">
                                                <FileText size={20} />
                                                <span className="underline text-sm">Файл</span>
                                            </a>
                                        )}
                                    </div>
                                )}

                                {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                                
                                <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-muted-foreground'}`}>
                                   <span>{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                   {isMe && (
                                       <span>
                                           {msg.is_read ? <CheckCheck size={14}/> : <Check size={14}/>}
                                       </span>
                                   )}
                                </div>

                                {/* Меню (Ответ/Удалить) */}
                                <div className={`absolute top-0 ${isMe ? '-left-16' : '-right-16'} h-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity px-2`}>
                                   <button onClick={() => setReplyTo(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary shadow-sm"><Reply size={14} /></button>
                                   {isMe && (
                                     <button onClick={() => deleteMessage(msg)} className="p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-red-500 shadow-sm"><Trash2 size={14} /></button>
                                   )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Ввод */}
            <div className="p-3 bg-card border-t border-border">
                {replyTo && (
                   <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]">
                     <div className="text-sm border-l-2 border-primary pl-2">
                       <span className="text-primary font-bold block">Ответ</span>
                       <span className="text-muted-foreground text-xs truncate max-w-[200px] block">{replyTo.content || '[Вложение]'}</span>
                     </div>
                     <button onClick={() => setReplyTo(null)}><X size={16}/></button>
                   </div>
                )}

                {file && (
                   <div className="flex items-center justify-between bg-muted/50 p-2 px-4 rounded-t-xl border-x border-t border-border mb-[-1px]">
                     <div className="flex items-center gap-2">
                       {filePreview ? <img src={filePreview} className="w-8 h-8 rounded object-cover"/> : <FileText className="text-primary"/>}
                       <span className="text-sm text-foreground truncate max-w-[200px]">{file.name}</span>
                     </div>
                     <button onClick={() => {setFile(null); setFilePreview(null)}}><X size={16}/></button>
                   </div>
                )}

                <div className="flex items-end gap-2">
                    {/* Кнопка Файл */}
                    <label className="p-3 rounded-xl cursor-pointer text-muted-foreground hover:bg-muted hover:text-primary transition h-[50px] flex items-center justify-center">
                        <Paperclip size={20} />
                        <input type="file" onChange={handleFileSelect} className="hidden" ref={fileInputRef}/>
                    </label>

                    {/* Поле ввода или индикатор записи */}
                    {isRecording ? (
                        <div className="flex-grow bg-red-500/10 text-red-500 p-3 rounded-xl flex items-center justify-between h-[50px] animate-pulse border border-red-500/20">
                            <span className="font-bold text-sm">Запись голосового...</span>
                            <button onClick={stopRecording} className="bg-red-500 text-white p-1.5 rounded-full"><Square size={14}/></button>
                        </div>
                    ) : (
                        <textarea 
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
                            placeholder="Сообщение..."
                            className="flex-grow bg-muted text-foreground p-3 rounded-xl focus:outline-none focus:border-primary border border-transparent transition placeholder-muted-foreground resize-none min-h-[50px] max-h-[120px]"
                            rows={1}
                        />
                    )}

                    {/* Кнопка Микрофон или Отправить */}
                    {newMessage.trim() || file ? (
                        <button onClick={() => sendMessage()} className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition shadow-lg shadow-primary/20 h-[50px] aspect-square flex items-center justify-center">
                            <Send size={20} />
                        </button>
                    ) : (
                        <button 
                            onClick={isRecording ? stopRecording : startRecording} 
                            className={`p-3 rounded-xl transition shadow-lg h-[50px] aspect-square flex items-center justify-center ${isRecording ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground hover:text-primary'}`}
                        >
                            {isRecording ? <Send size={20} /> : <Mic size={20} />}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}