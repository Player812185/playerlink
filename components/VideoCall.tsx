'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, User, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

// Google STUN (проверенный)
const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
}

interface Props {
    roomId: string
    userId: string
    isCaller: boolean
    callType: 'video' | 'audio'
    onEnd: () => void
}

export function VideoCall({ roomId, userId, isCaller, callType, onEnd }: Props) {
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(callType === 'audio')
    const [status, setStatus] = useState('Инициализация...')
    const [logs, setLogs] = useState<string[]>([])

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const peerConnection = useRef<RTCPeerConnection | null>(null)
    const localStream = useRef<MediaStream | null>(null)
    const channel = useRef<any>(null)
    const offerInterval = useRef<NodeJS.Timeout | null>(null)

    // Логгер на экран
    const log = (msg: string) => {
        console.log(`[${isCaller ? 'Caller' : 'Receiver'}] ${msg}`)
        setLogs(prev => [...prev.slice(-5), msg])
    }

    useEffect(() => {
        log(`Room: ${roomId}`)

        // 1. Очистка перед стартом (Fix для React Strict Mode)
        const activeChannel = supabase.getChannels().find(c => c.topic === `room:${roomId}`)
        if (activeChannel) {
            log('Found active channel, removing...')
            supabase.removeChannel(activeChannel)
        }

        init()

        return () => cleanup()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const init = async () => {
        try {
            // 1. MEDIA
            setStatus('Доступ к медиа...')
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video'
            })
            localStream.current = stream
            if (localVideoRef.current && callType === 'video') {
                localVideoRef.current.srcObject = stream
            }

            // 2. PEER CONNECTION
            setStatus('Создание P2P...')
            const pc = new RTCPeerConnection(STUN_SERVERS)
            peerConnection.current = pc

            // Добавляем треки
            stream.getTracks().forEach(track => pc.addTrack(track, stream))

            // Слушаем ICE кандидатов (сетевые маршруты)
            pc.onicecandidate = (event) => {
                if (event.candidate && channel.current) {
                    channel.current.send({
                        type: 'broadcast',
                        event: 'ice-candidate',
                        payload: { candidate: event.candidate, sender: userId }
                    })
                }
            }

            // Когда пришел поток собеседника
            pc.ontrack = (event) => {
                log('🎥 Remote stream received!')
                setStatus('Связь установлена!')
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0]
                }
                // Останавливаем спам офферами
                if (offerInterval.current) clearInterval(offerInterval.current)
            }

            pc.onconnectionstatechange = () => {
                const state = pc.connectionState
                log(`WebRTC State: ${state}`)
                if (state === 'failed' || state === 'disconnected') {
                    setStatus('Связь прервана')
                }
            }

            // 3. SIGNALING (Supabase)
            setStatus('Подключение к серверу...')
            setupSignaling(pc)

        } catch (err: any) {
            log(`FATAL: ${err.message}`)
            toast.error('Ошибка: ' + err.message)
        }
    }

    const setupSignaling = (pc: RTCPeerConnection) => {
        channel.current = supabase.channel(`room:${roomId}`, {
            config: { broadcast: { self: true } } // <--- ВАЖНО: self: true (слышим всех, фильтруем сами)
        })

        channel.current
            .on('broadcast', { event: 'signal' }, async (payload: any) => {
                const data = payload.payload

                // Фильтр: игнорируем свои сообщения
                if (data.sender === userId) return

                // --- ОБРАБОТКА СИГНАЛОВ ---

                // 1. Пришел OFFER (Вызов)
                if (data.type === 'offer') {
                    if (isCaller) return // Мы сами звоним, нам оффер не нужен
                    log('📨 Got OFFER')

                    try {
                        // Если мы уже в процессе соединения, не сбиваем
                        if (pc.signalingState !== 'stable') return

                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
                        const answer = await pc.createAnswer()
                        await pc.setLocalDescription(answer)

                        log('📤 Sent ANSWER')
                        channel.current.send({
                            type: 'broadcast',
                            event: 'signal',
                            payload: { type: 'answer', sdp: answer, sender: userId }
                        })
                    } catch (e) { log('Offer Err: ' + e) }
                }

                // 2. Пришел ANSWER (Ответ)
                if (data.type === 'answer') {
                    if (!isCaller) return
                    log('📨 Got ANSWER')
                    try {
                        // Если мы уже подключены, игнорируем повторы
                        if (pc.signalingState === 'stable') return

                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))

                        // Ответ получен — перестаем слать офферы
                        if (offerInterval.current) clearInterval(offerInterval.current)
                    } catch (e) { log('Answer Err: ' + e) }
                }
            })
            // 3. Пришел ICE Candidate (Маршрут)
            .on('broadcast', { event: 'ice-candidate' }, (payload: any) => {
                const data = payload.payload
                if (data.sender === userId) return
                // log('🧊 Got ICE Candidate')
                pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => { })
            })
            // 4. Завершение
            .on('broadcast', { event: 'end-call' }, (payload: any) => {
                if (payload.payload.sender === userId) return
                log('Peer ended call')
                onEnd()
            })
            .subscribe((status: string) => {
                log(`Socket: ${status}`)

                if (status === 'SUBSCRIBED') {
                    if (isCaller) {
                        setStatus('Вызов абонента...')
                        // Начинаем слать офферы (повторяем каждые 3 сек, пока не ответят)
                        startSendingOffers(pc)
                    } else {
                        setStatus('Ожидание вызова...')
                    }
                }
            })
    }

    const startSendingOffers = async (pc: RTCPeerConnection) => {
        // Создаем оффер один раз
        try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            // Функция отправки
            const send = () => {
                if (pc.connectionState === 'connected') return
                log('📤 Sending OFFER...')
                channel.current?.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'offer', sdp: offer, sender: userId }
                })
            }

            // Шлем сразу и потом в интервале
            send()
            offerInterval.current = setInterval(send, 3000)

        } catch (e) { log('CreateOffer Err: ' + e) }
    }

    const cleanup = () => {
        if (offerInterval.current) clearInterval(offerInterval.current)
        localStream.current?.getTracks().forEach(t => t.stop())
        peerConnection.current?.close()

        // Отправляем сигнал завершения перед выходом
        if (channel.current) {
            channel.current.send({ type: 'broadcast', event: 'end-call', payload: { sender: userId } })
            supabase.removeChannel(channel.current)
        }
    }

    // --- UI ---
    const toggleMute = () => {
        if (localStream.current) {
            localStream.current.getAudioTracks()[0].enabled = !localStream.current.getAudioTracks()[0].enabled
            setIsMuted(!isMuted)
        }
    }

    const toggleVideo = () => {
        if (callType === 'audio') return toast.error('Только аудио')
        if (localStream.current) {
            localStream.current.getVideoTracks()[0].enabled = !localStream.current.getVideoTracks()[0].enabled
            setIsVideoOff(!isVideoOff)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center p-4">

            <div className="relative w-full max-w-4xl aspect-video bg-black/50 rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">

                {callType === 'video' ? (
                    <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center gap-4 animate-pulse">
                        <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center border-4 border-primary/50">
                            <User size={64} className="text-primary" />
                        </div>
                    </div>
                )}

                {/* Логи статуса */}
                <div className="absolute top-4 left-4 font-mono text-[10px] text-green-400 bg-black/80 p-2 rounded max-w-xs pointer-events-none z-50 overflow-hidden">
                    <p className="font-bold text-white mb-1">STATUS: {status}</p>
                    {logs.map((l, i) => <div key={i} className="truncate">{l}</div>)}
                </div>

                {callType === 'video' && (
                    <div className="absolute bottom-4 right-4 w-32 md:w-48 aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-white/20">
                        <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover mirror-mode ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
                    </div>
                )}
            </div>

            <div className="mt-8 flex items-center gap-6">
                <button onClick={toggleMute} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
                    {isMuted ? <MicOff /> : <Mic />}
                </button>

                <button onClick={onEnd} className="p-5 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg transform hover:scale-110 transition-all">
                    <PhoneOff size={32} />
                </button>

                <button onClick={toggleVideo} disabled={callType === 'audio'} className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white'} ${callType === 'audio' ? 'opacity-50' : ''}`}>
                    {isVideoOff ? <VideoOff /> : <Video />}
                </button>

                {/* Кнопка ручного перезапуска (если совсем все плохо) */}
                <button onClick={() => isCaller ? startSendingOffers(peerConnection.current!) : null} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white/50 hover:text-white" title="Resend Offer">
                    <RefreshCw size={16} />
                </button>
            </div>
        </div>
    )
}