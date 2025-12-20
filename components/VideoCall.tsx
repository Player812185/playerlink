'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Mic, MicOff, Video, VideoOff, PhoneOff, User } from 'lucide-react' // Добавил User иконку
import { toast } from 'sonner'

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
}

interface Props {
    roomId: string
    userId: string
    isCaller: boolean
    callType: 'video' | 'audio' // <--- НОВЫЙ ПРОП
    onEnd: () => void
}

export function VideoCall({ roomId, userId, isCaller, callType, onEnd }: Props) {
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(callType === 'audio') // Если аудио, видео выключено сразу
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
            // 1. Запрашиваем медиа в зависимости от типа звонка
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video' // true или false
            })
            localStream.current = stream

            // Для аудиозвонка видео-трека просто не будет
            if (localVideoRef.current && callType === 'video') {
                localVideoRef.current.srcObject = stream
            }

            // 2. Создаем P2P (код идентичен)
            peerConnection.current = new RTCPeerConnection(STUN_SERVERS)

            stream.getTracks().forEach(track => {
                peerConnection.current?.addTrack(track, stream)
            })

            peerConnection.current.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0]
                    setConnectionStatus('Идет разговор')
                }
            }

            peerConnection.current.onicecandidate = (event) => {
                if (event.candidate) {
                    channel.current?.send({ type: 'broadcast', event: 'ice-candidate', payload: event.candidate })
                }
            }

            peerConnection.current.onconnectionstatechange = () => {
                if (peerConnection.current?.connectionState === 'disconnected' ||
                    peerConnection.current?.connectionState === 'failed') {
                    onEnd()
                }
            }

            // 3. Сигналинг
            channel.current = supabase.channel(`call:${roomId}`)

            channel.current
                .on('broadcast', { event: 'ice-candidate' }, (payload: any) => {
                    peerConnection.current?.addIceCandidate(new RTCIceCandidate(payload.payload))
                })
                .on('broadcast', { event: 'sdp-answer' }, async (payload: any) => {
                    await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                })
                .on('broadcast', { event: 'sdp-offer' }, async (payload: any) => {
                    if (!isCaller) {
                        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(payload.payload))
                        const answer = await peerConnection.current?.createAnswer()
                        await peerConnection.current?.setLocalDescription(answer)
                        channel.current.send({ type: 'broadcast', event: 'sdp-answer', payload: answer })
                    }
                })
                .on('broadcast', { event: 'end-call' }, () => {
                    toast.info('Звонок завершен')
                    onEnd()
                })
                .subscribe(async (status: string) => {
                    if (status === 'SUBSCRIBED') {
                        if (isCaller) {
                            const offer = await peerConnection.current?.createOffer()
                            await peerConnection.current?.setLocalDescription(offer)
                            setTimeout(() => {
                                channel.current.send({ type: 'broadcast', event: 'sdp-offer', payload: offer })
                            }, 1000)
                        }
                    }
                })

        } catch (err) {
            console.error(err)
            toast.error('Ошибка доступа к микрофону/камере')
            onEnd()
        }
    }

    const endCallCleanup = () => {
        channel.current?.send({ type: 'broadcast', event: 'end-call', payload: {} })
        localStream.current?.getTracks().forEach(track => track.stop())
        peerConnection.current?.close()
        supabase.removeChannel(channel.current)
    }

    const toggleMute = () => {
        if (localStream.current) {
            const track = localStream.current.getAudioTracks()[0]
            if (track) {
                track.enabled = !track.enabled
                setIsMuted(!isMuted)
            }
        }
    }

    const toggleVideo = () => {
        // Если звонок был только аудио, включить видео нельзя (не запрашивали права)
        if (callType === 'audio') {
            return toast.error('В аудиозвонке нельзя включить камеру')
        }
        if (localStream.current) {
            const track = localStream.current.getVideoTracks()[0]
            if (track) {
                track.enabled = !track.enabled
                setIsVideoOff(!isVideoOff)
            }
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">

            <div className="relative w-full max-w-4xl aspect-video bg-black/50 rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">

                {/* REMOTE VIDEO / AVATAR */}
                {callType === 'video' ? (
                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                    />
                ) : (
                    // Плейсхолдер для аудиозвонка
                    <div className="flex flex-col items-center gap-4 animate-pulse">
                        <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center border-4 border-primary/50">
                            <User size={64} className="text-primary" />
                        </div>
                        <span className="text-xl font-semibold text-white/80">{connectionStatus}</span>
                    </div>
                )}

                {/* Status Overlay (только для видео, в аудио он по центру) */}
                {callType === 'video' && (
                    <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl text-white text-sm font-medium">
                        {connectionStatus}
                    </div>
                )}

                {/* LOCAL VIDEO (только если видеозвонок) */}
                {callType === 'video' && (
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
                )}
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

                {/* Кнопка видео доступна только в видео-режиме для выключения */}
                <button
                    onClick={toggleVideo}
                    className={`p-4 rounded-full transition-all duration-200 ${callType === 'audio' ? 'opacity-50 cursor-not-allowed bg-white/5' :
                            isVideoOff ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                    disabled={callType === 'audio'}
                >
                    {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                </button>
            </div>
        </div>
    )
}