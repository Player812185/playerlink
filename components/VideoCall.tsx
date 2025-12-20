'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, User } from 'lucide-react'
import { toast } from 'sonner'

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
    const [status, setStatus] = useState('Подключение...')
    const [logs, setLogs] = useState<string[]>([])

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const peerConnection = useRef<RTCPeerConnection | null>(null)
    const localStream = useRef<MediaStream | null>(null)
    const channel = useRef<any>(null)
    const offerInterval = useRef<NodeJS.Timeout | null>(null) // <--- Таймер для повтора

    const log = (msg: string) => {
        console.log(`[Call ${isCaller ? 'Caller' : 'Receiver'}] ${msg}`)
        setLogs(prev => [...prev.slice(-4), msg])
    }

    useEffect(() => {
        log(`Room: ${roomId}`)
        init()
        return () => cleanup()
    }, [])

    const init = async () => {
        try {
            setStatus('Устройства...')
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video'
            })
            localStream.current = stream

            if (localVideoRef.current && callType === 'video') {
                localVideoRef.current.srcObject = stream
            }

            setStatus('Настройка P2P...')
            createPeerConnection()

            stream.getTracks().forEach(track => {
                peerConnection.current?.addTrack(track, stream)
            })

            setStatus('Сигналинг...')
            setupSignaling()

        } catch (err: any) {
            log(`Err: ${err.message}`)
            toast.error('Ошибка доступа: ' + err.message)
        }
    }

    const createPeerConnection = () => {
        peerConnection.current = new RTCPeerConnection(STUN_SERVERS)

        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
                channel.current?.send({ type: 'broadcast', event: 'ice-candidate', payload: event.candidate })
            }
        }

        peerConnection.current.ontrack = (event) => {
            log('Stream received!')
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0]
            }
        }

        peerConnection.current.onconnectionstatechange = () => {
            const state = peerConnection.current?.connectionState
            log(`State: ${state}`)
            if (state === 'connected') {
                setStatus('Связь установлена')
                // Как только соединились — перестаем спамить офферами
                if (offerInterval.current) clearInterval(offerInterval.current)
            }
            if (state === 'disconnected') setStatus('Разрыв связи')
        }
    }

    const setupSignaling = () => {
        channel.current = supabase.channel(`room:${roomId}`, {
            config: { broadcast: { self: false } }
        })

        channel.current
            .on('broadcast', { event: 'ready' }, () => {
                // Собеседник вошел и готов! Если мы Caller, шлем оффер сразу
                if (isCaller) sendOffer()
            })
            .on('broadcast', { event: 'sdp-offer' }, async (payload: any) => {
                if (isCaller) return // Игнорируем (мы сами звоним)
                log('Got OFFER')

                try {
                    // Если мы уже обрабатываем оффер, не сбрасываем (защита от повторов)
                    if (peerConnection.current?.signalingState !== 'stable') return

                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                    const answer = await peerConnection.current?.createAnswer()
                    await peerConnection.current?.setLocalDescription(answer)

                    log('Sent ANSWER')
                    channel.current.send({ type: 'broadcast', event: 'sdp-answer', payload: answer })
                } catch (e) { log('Offer Err: ' + e) }
            })
            .on('broadcast', { event: 'sdp-answer' }, async (payload: any) => {
                if (!isCaller) return
                log('Got ANSWER')

                try {
                    // Перестаем слать офферы, нам ответили
                    if (offerInterval.current) clearInterval(offerInterval.current)

                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                } catch (e) { log('Answer Err: ' + e) }
            })
            .on('broadcast', { event: 'ice-candidate' }, (payload: any) => {
                peerConnection.current?.addIceCandidate(new RTCIceCandidate(payload.payload)).catch(() => { })
            })
            .on('broadcast', { event: 'end-call' }, () => {
                onEnd()
            })
            .subscribe((status: string) => {
                log(`Subscribed: ${status}`)
                if (status === 'SUBSCRIBED') {
                    // 1. Сообщаем всем, что мы подключились
                    channel.current.send({ type: 'broadcast', event: 'ready', payload: {} })

                    // 2. Если мы звоним — начинаем долбить офферами, пока не ответят
                    if (isCaller) {
                        setStatus('Вызов...')
                        sendOffer()
                        // Повторяем каждые 2 сек, пока не получим ANSWER
                        offerInterval.current = setInterval(sendOffer, 2000)
                    } else {
                        setStatus('Ожидание...')
                    }
                }
            })
    }

    const sendOffer = async () => {
        if (!peerConnection.current) return
        // Если уже есть локальное описание (мы уже создали оффер), просто шлем его снова
        if (peerConnection.current.localDescription) {
            channel.current?.send({ type: 'broadcast', event: 'sdp-offer', payload: peerConnection.current.localDescription })
            return
        }

        try {
            const offer = await peerConnection.current.createOffer()
            await peerConnection.current.setLocalDescription(offer)
            channel.current?.send({ type: 'broadcast', event: 'sdp-offer', payload: offer })
        } catch (e) { log('CreateOffer Err: ' + e) }
    }

    const cleanup = () => {
        if (offerInterval.current) clearInterval(offerInterval.current)
        localStream.current?.getTracks().forEach(t => t.stop())
        peerConnection.current?.close()
        if (channel.current) supabase.removeChannel(channel.current)
    }

    // ... (toggleMute, toggleVideo остаются без изменений) ...
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

                {/* VIDEO / AVATAR */}
                {callType === 'video' ? (
                    <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center gap-4 animate-pulse">
                        <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center border-4 border-primary/50">
                            <User size={64} className="text-primary" />
                        </div>
                    </div>
                )}

                {/* DEBUG LOGS */}
                <div className="absolute top-4 left-4 font-mono text-[10px] text-green-400 bg-black/80 p-2 rounded max-w-xs pointer-events-none z-50">
                    <p className="font-bold text-white mb-1">STATUS: {status}</p>
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>

                {/* SELF VIDEO */}
                {callType === 'video' && (
                    <div className="absolute bottom-4 right-4 w-32 md:w-48 aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-white/20">
                        <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover mirror-mode ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
                    </div>
                )}
            </div>

            {/* CONTROLS */}
            <div className="mt-8 flex items-center gap-6">
                <button onClick={toggleMute} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
                    {isMuted ? <MicOff /> : <Mic />}
                </button>

                <button onClick={() => { channel.current?.send({ type: 'broadcast', event: 'end-call', payload: {} }); onEnd() }} className="p-5 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 hover:scale-110 transition-all">
                    <PhoneOff size={32} />
                </button>

                <button onClick={toggleVideo} disabled={callType === 'audio'} className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white'} ${callType === 'audio' ? 'opacity-50' : ''}`}>
                    {isVideoOff ? <VideoOff /> : <Video />}
                </button>
            </div>
        </div>
    )
}