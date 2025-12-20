'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Monitor } from 'lucide-react'
import { toast } from 'sonner'

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // Бесплатный Google STUN
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
}

interface Props {
    roomId: string
    userId: string
    isCaller: boolean
    onEnd: () => void
}

export function VideoCall({ roomId, userId, isCaller, onEnd }: Props) {
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(false)
    const [connectionStatus, setConnectionStatus] = useState('Подключение...')

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const peerConnection = useRef<RTCPeerConnection | null>(null)
    const localStream = useRef<MediaStream | null>(null)
    const channel = useRef<any>(null)

    useEffect(() => {
        startCall()
        return () => {
            endCallCleanup()
        }
    }, [])

    const startCall = async () => {
        try {
            // 1. Получаем доступ к камере/микрофону
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            localStream.current = stream

            if (localVideoRef.current) localVideoRef.current.srcObject = stream

            // 2. Создаем P2P соединение
            peerConnection.current = new RTCPeerConnection(STUN_SERVERS)

            // Добавляем треки (потоки) в соединение
            stream.getTracks().forEach(track => {
                peerConnection.current?.addTrack(track, stream)
            })

            // Когда получаем поток от собеседника
            peerConnection.current.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0]
                    setConnectionStatus('Идет разговор')
                }
            }

            // ICE Candidates (маршруты сети)
            peerConnection.current.onicecandidate = (event) => {
                if (event.candidate) {
                    channel.current?.send({ type: 'broadcast', event: 'ice-candidate', payload: event.candidate })
                }
            }

            peerConnection.current.onconnectionstatechange = () => {
                if (peerConnection.current?.connectionState === 'disconnected') {
                    onEnd()
                }
            }

            // 3. Подключаемся к сигналингу (Supabase)
            channel.current = supabase.channel(`call:${roomId}`)

            channel.current
                .on('broadcast', { event: 'ice-candidate' }, (payload: any) => {
                    peerConnection.current?.addIceCandidate(new RTCIceCandidate(payload.payload))
                })
                .on('broadcast', { event: 'sdp-answer' }, async (payload: any) => {
                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                })
                .on('broadcast', { event: 'sdp-offer' }, async (payload: any) => {
                    // Если мы принимаем звонок
                    if (!isCaller) {
                        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                        const answer = await peerConnection.current?.createAnswer()
                        await peerConnection.current?.setLocalDescription(answer)
                        channel.current.send({ type: 'broadcast', event: 'sdp-answer', payload: answer })
                    }
                })
                .on('broadcast', { event: 'end-call' }, () => {
                    toast.info('Собеседник завершил звонок')
                    onEnd()
                })
                .subscribe(async (status: string) => {
                    if (status === 'SUBSCRIBED') {
                        // Если мы звоним — создаем Offer
                        if (isCaller) {
                            const offer = await peerConnection.current?.createOffer()
                            await peerConnection.current?.setLocalDescription(offer)
                            // Небольшая задержка, чтобы собеседник успел подписаться
                            setTimeout(() => {
                                channel.current.send({ type: 'broadcast', event: 'sdp-offer', payload: offer })
                            }, 1000)
                        }
                    }
                })

        } catch (err) {
            console.error(err)
            toast.error('Ошибка доступа к устройствам')
            onEnd()
        }
    }

    const endCallCleanup = () => {
        // Отправляем сигнал завершения
        channel.current?.send({ type: 'broadcast', event: 'end-call', payload: {} })

        // Останавливаем треки
        localStream.current?.getTracks().forEach(track => track.stop())

        // Закрываем соединение
        peerConnection.current?.close()

        // Отписываемся
        supabase.removeChannel(channel.current)
    }

    const toggleMute = () => {
        if (localStream.current) {
            localStream.current.getAudioTracks()[0].enabled = !localStream.current.getAudioTracks()[0].enabled
            setIsMuted(!isMuted)
        }
    }

    const toggleVideo = () => {
        if (localStream.current) {
            localStream.current.getVideoTracks()[0].enabled = !localStream.current.getVideoTracks()[0].enabled
            setIsVideoOff(!isVideoOff)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">

            <div className="relative w-full max-w-4xl aspect-video bg-black/50 rounded-3xl overflow-hidden shadow-2xl border border-white/10">
                {/* REMOTE VIDEO (Собеседник) */}
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                />

                {/* Status Overlay */}
                <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl text-white text-sm font-medium">
                    {connectionStatus}
                </div>

                {/* LOCAL VIDEO (Я) */}
                <div className="absolute bottom-4 right-4 w-32 md:w-48 aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-white/20">
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className={`w-full h-full object-cover mirror-mode ${isVideoOff ? 'opacity-0' : 'opacity-100'}`}
                    />
                    {isVideoOff && <div className="absolute inset-0 flex items-center justify-center text-white text-xs">Камера выкл.</div>}
                </div>
            </div>

            {/* CONTROLS */}
            <div className="mt-8 flex items-center gap-6">
                <button
                    onClick={toggleMute}
                    className={`p-4 rounded-full transition-all duration-200 ${isMuted ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>

                <button
                    onClick={onEnd}
                    className="p-5 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 transform hover:scale-110 transition-all duration-200"
                >
                    <PhoneOff size={32} />
                </button>

                <button
                    onClick={toggleVideo}
                    className={`p-4 rounded-full transition-all duration-200 ${isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                >
                    {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                </button>
            </div>
        </div>
    )
}