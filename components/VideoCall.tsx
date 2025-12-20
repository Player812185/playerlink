'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, User, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

// Используем Google STUN, они надежные
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
    const [logs, setLogs] = useState<string[]>([]) // Логи на экран

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const peerConnection = useRef<RTCPeerConnection | null>(null)
    const localStream = useRef<MediaStream | null>(null)
    const channel = useRef<any>(null)

    // Хелпер для логов
    const log = (msg: string) => {
        console.log(`[Call ${isCaller ? 'Caller' : 'Receiver'}] ${msg}`)
        setLogs(prev => [...prev.slice(-4), msg]) // Держим последние 5 логов
    }

    useEffect(() => {
        log(`Starting call in room: ${roomId}`)
        init()
        return () => cleanup()
    }, [])

    const init = async () => {
        try {
            setStatus('Доступ к устройствам...')
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video'
            })
            localStream.current = stream
            if (localVideoRef.current && callType === 'video') {
                localVideoRef.current.srcObject = stream
            }

            setStatus('Создание P2P...')
            createPeerConnection()

            stream.getTracks().forEach(track => {
                peerConnection.current?.addTrack(track, stream)
            })

            setStatus('Подключение к серверу...')
            setupSignaling()

        } catch (err: any) {
            log(`Error: ${err.message}`)
            toast.error('Ошибка оборудования: ' + err.message)
        }
    }

    const createPeerConnection = () => {
        peerConnection.current = new RTCPeerConnection(STUN_SERVERS)

        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
                // log('Found ICE candidate, sending...')
                channel.current?.send({ type: 'broadcast', event: 'ice-candidate', payload: event.candidate })
            }
        }

        peerConnection.current.ontrack = (event) => {
            log('Received remote stream!')
            setStatus('Подключено')
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0]
            }
        }

        peerConnection.current.onconnectionstatechange = () => {
            const state = peerConnection.current?.connectionState
            log(`Connection state: ${state}`)
            if (state === 'connected') setStatus('Разговор')
            if (state === 'disconnected' || state === 'failed') {
                setStatus('Связь прервана')
                // onEnd() // Пока не закрываем автоматом, чтобы видеть ошибки
            }
        }
    }

    const setupSignaling = () => {
        channel.current = supabase.channel(`room:${roomId}`, {
            config: { broadcast: { self: false } } // self: false, чтобы не ловить свои сигналы
        })

        channel.current
            .on('broadcast', { event: 'sdp-offer' }, async (payload: any) => {
                log('Received OFFER')
                if (isCaller) return // Если мы звонили, нам оффер не нужен (конфликт)

                try {
                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                    const answer = await peerConnection.current?.createAnswer()
                    await peerConnection.current?.setLocalDescription(answer)
                    log('Sent ANSWER')
                    channel.current.send({ type: 'broadcast', event: 'sdp-answer', payload: answer })
                } catch (e) { log('Error handling offer: ' + e) }
            })
            .on('broadcast', { event: 'sdp-answer' }, async (payload: any) => {
                log('Received ANSWER')
                try {
                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                } catch (e) { log('Error handling answer: ' + e) }
            })
            .on('broadcast', { event: 'ice-candidate' }, (payload: any) => {
                // log('Received ICE candidate')
                peerConnection.current?.addIceCandidate(new RTCIceCandidate(payload.payload))
                    .catch(e => { })
            })
            .on('broadcast', { event: 'end-call' }, () => {
                log('Peer ended call')
                onEnd()
            })
            .subscribe((status: string) => {
                log(`Supabase Status: ${status}`)
                if (status === 'SUBSCRIBED') {
                    if (isCaller) {
                        setStatus('Ожидание ответа...')
                        sendOffer() // Отправляем оффер сразу
                    } else {
                        setStatus('Ожидание данных...')
                    }
                }
            })
    }

    const sendOffer = async () => {
        if (!peerConnection.current) return
        log('Creating and sending OFFER...')
        try {
            const offer = await peerConnection.current.createOffer()
            await peerConnection.current.setLocalDescription(offer)
            channel.current?.send({ type: 'broadcast', event: 'sdp-offer', payload: offer })
        } catch (e) { log('Offer error: ' + e) }
    }

    const cleanup = () => {
        localStream.current?.getTracks().forEach(t => t.stop())
        peerConnection.current?.close()
        if (channel.current) supabase.removeChannel(channel.current)
    }

    // --- UI Helpers ---
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

                {/* DEBUG LOGS OVERLAY */}
                <div className="absolute top-4 left-4 font-mono text-[10px] text-green-400 bg-black/80 p-2 rounded max-w-xs pointer-events-none">
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

                {isCaller && status !== 'Разговор' && (
                    <button onClick={sendOffer} className="p-4 rounded-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/40" title="Повторить отправку вызова">
                        <RefreshCw />
                    </button>
                )}

                <button onClick={toggleVideo} disabled={callType === 'audio'} className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white'} ${callType === 'audio' ? 'opacity-50' : ''}`}>
                    {isVideoOff ? <VideoOff /> : <Video />}
                </button>
            </div>
        </div>
    )
}