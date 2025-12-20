'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, User, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
}

interface Props {
    roomId: string
    userId: string      // Я
    partnerId: string   // Собеседник
    isCaller: boolean
    callType: 'video' | 'audio'
    onEnd: () => void
}

export function VideoCall({ roomId, userId, partnerId, isCaller, callType, onEnd }: Props) {
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(callType === 'audio')
    const [status, setStatus] = useState('Подключение...')
    const [logs, setLogs] = useState<string[]>([])

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const peerConnection = useRef<RTCPeerConnection | null>(null)
    const localStream = useRef<MediaStream | null>(null)
    const channel = useRef<any>(null)
    const processedSignals = useRef<Set<string>>(new Set()) // Чтобы не обрабатывать повторы

    const log = (msg: string) => {
        console.log(`[${isCaller ? 'Caller' : 'Receiver'}] ${msg}`)
        setLogs(prev => [...prev.slice(-4), msg])
    }

    useEffect(() => {
        // Очищаем старые сигналы перед началом, чтобы не подхватить мусор
        cleanOldSignals().then(() => init())
        return () => cleanup()
    }, [])

    const cleanOldSignals = async () => {
        await supabase.from('call_signals').delete().eq('room_id', roomId)
    }

    const init = async () => {
        try {
            // 1. MEDIA
            setStatus('Устройства...')
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video'
            })
            localStream.current = stream
            if (localVideoRef.current && callType === 'video') {
                localVideoRef.current.srcObject = stream
            }

            // 2. P2P SETUP
            setStatus('Настройка сети...')
            const pc = new RTCPeerConnection(STUN_SERVERS)
            peerConnection.current = pc

            stream.getTracks().forEach(track => pc.addTrack(track, stream))

            // Отправляем ICE кандидатов через базу
            pc.onicecandidate = async (event) => {
                if (event.candidate) {
                    await sendSignal('ice-candidate', event.candidate)
                }
            }

            pc.ontrack = (event) => {
                log('🎥 Stream received!')
                setStatus('Связь установлена')
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0]
                }
            }

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'disconnected') setStatus('Связь прервана')
                if (pc.connectionState === 'failed') setStatus('Ошибка сети')
            }

            // 3. SIGNALING (DB)
            setStatus('Подключение к базе...')

            // Сначала подписываемся на новые сигналы
            channel.current = supabase.channel(`signals:${roomId}`)
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `receiver_id=eq.${userId}` },
                    (payload) => handleNewSignal(payload.new, pc)
                )
                .subscribe()

            // Если мы принимаем звонок — проверяем, нет ли уже Оффера в базе (Race condition fix)
            if (!isCaller) {
                const { data } = await supabase.from('call_signals')
                    .select('*')
                    .eq('room_id', roomId)
                    .eq('type', 'offer')
                    .order('created_at', { ascending: false })
                    .limit(1)

                if (data && data[0]) {
                    log('Found pending OFFER in DB')
                    await handleNewSignal(data[0], pc)
                }
            } else {
                // Если мы звоним — создаем и пишем Оффер
                setStatus('Вызов...')
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                await sendSignal('offer', offer)
            }

        } catch (err: any) {
            log(`Err: ${err.message}`)
            toast.error(err.message)
        }
    }

    // Обработка входящего сигнала
    const handleNewSignal = async (signal: any, pc: RTCPeerConnection) => {
        if (processedSignals.current.has(signal.id)) return
        processedSignals.current.add(signal.id)

        // log(`📥 Got ${signal.type}`)

        try {
            if (signal.type === 'offer') {
                if (isCaller) return // Конфликт, игнорируем
                if (pc.signalingState !== 'stable') return // Уже соединяемся

                await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)

                log('📤 Sending ANSWER')
                await sendSignal('answer', answer)
            }
            else if (signal.type === 'answer') {
                if (!isCaller) return
                if (pc.signalingState === 'stable') return

                await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
                log('✅ Connected!')
            }
            else if (signal.type === 'ice-candidate') {
                await pc.addIceCandidate(new RTCIceCandidate(signal.payload))
            }
            else if (signal.type === 'end-call') {
                toast.info('Звонок завершен')
                onEnd()
            }
        } catch (e) {
            console.error('Signal error', e)
        }
    }

    // Отправка сигнала в базу
    const sendSignal = async (type: string, payload: any) => {
        await supabase.from('call_signals').insert({
            room_id: roomId,
            sender_id: userId,
            receiver_id: partnerId,
            type,
            payload
        })
    }

    const cleanup = () => {
        // Отправляем сигнал завершения (опционально)
        // sendSignal('end-call', {}) 
        // Лучше просто почистить базу
        supabase.from('call_signals').delete().eq('room_id', roomId).then(() => { })

        localStream.current?.getTracks().forEach(t => t.stop())
        peerConnection.current?.close()
        if (channel.current) supabase.removeChannel(channel.current)
    }

    // --- UI HELPERS ---
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
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center border-4 border-primary/50 animate-pulse">
                            <User size={64} className="text-primary" />
                        </div>
                    </div>
                )}

                {/* LOGS */}
                <div className="absolute top-4 left-4 font-mono text-[10px] text-green-400 bg-black/80 p-2 rounded max-w-xs pointer-events-none z-50">
                    <p className="font-bold text-white mb-1">STATUS: {status}</p>
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
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

                <button onClick={() => { sendSignal('end-call', {}); onEnd() }} className="p-5 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg transform hover:scale-110 transition-all">
                    <PhoneOff size={32} />
                </button>

                <button onClick={toggleVideo} disabled={callType === 'audio'} className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white'} ${callType === 'audio' ? 'opacity-50' : ''}`}>
                    {isVideoOff ? <VideoOff /> : <Video />}
                </button>
            </div>
        </div>
    )
}