'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Camera, LogOut } from 'lucide-react'

export default function Settings() {
    const [loading, setLoading] = useState(true)
    const [username, setUsername] = useState('')
    const [avatarUrl, setAvatarUrl] = useState('')
    const [userId, setUserId] = useState<string | null>(null)

    const PLACEHOLDER_IMG = '/placeholder.png'

    useEffect(() => {
        getProfile()
    }, [])

    const getProfile = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            setUserId(user.id)
            const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
            if (data) {
                setUsername(data.username || '')
                setAvatarUrl(data.avatar_url || '')
            }
        }
        setLoading(false)
    }

    const updateProfile = async () => {
        if (!userId) return
        const { error } = await supabase.from('profiles').update({ username, avatar_url: avatarUrl }).eq('id', userId)
        if (!error) alert('Настройки сохранены')
        else alert('Ошибка')
    }

    const uploadAvatar = async (event: any) => {
        try {
            if (!event.target.files || event.target.files.length === 0) return

            const file = event.target.files[0]
            const fileExt = file.name.split('.').pop()
            // Генерируем чистое имя файла (только латиница и цифры), чтобы избежать проблем с кодировкой
            const randomString = Math.random().toString(36).substring(7)
            const filePath = `${userId}-${Date.now()}-${randomString}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file, { upsert: true }) // <--- ВАЖНО: upsert: true

            if (uploadError) throw uploadError

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
            setAvatarUrl(data.publicUrl)
        } catch (error: any) { // Добавьте :any или :Error
            alert('Ошибка загрузки картинки: ' + error.message)
            console.log(error)
        }
    }

    if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-primary">...</div>

    return (
        <div className="min-h-screen bg-background text-foreground p-4 font-sans">
            <div className="max-w-md mx-auto mt-10">
                <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition">
                    <ArrowLeft size={18} className="mr-2" /> На главную
                </Link>

                <div className="bg-card p-8 rounded-3xl border border-border shadow-xl">
                    <h1 className="text-xl font-bold mb-6 text-center">Редактировать профиль</h1>

                    <div className="flex flex-col items-center mb-8 relative group w-fit mx-auto">
                        <div className="relative w-28 h-28">
                            <img
                                src={avatarUrl || PLACEHOLDER_IMG}
                                className="w-full h-full rounded-3xl object-cover border-4 border-background"
                                onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                            />
                            <label className="absolute -bottom-2 -right-2 bg-primary p-2.5 rounded-xl cursor-pointer hover:bg-primary/90 transition shadow-lg text-primary-foreground border-4 border-background">
                                <Camera size={16} />
                                <input type="file" onChange={uploadAvatar} className="hidden" accept="image/*" />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground ml-1">Никнейм</label>
                            <input
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-background border border-border p-3 rounded-xl focus:outline-none focus:border-primary transition"
                            />
                        </div>

                        <button onClick={updateProfile} className="w-full bg-primary text-primary-foreground font-semibold p-3.5 rounded-xl hover:bg-primary/90 transition shadow-lg shadow-primary/20 mt-2">
                            Сохранить
                        </button>

                        <button onClick={() => supabase.auth.signOut().then(() => location.href = '/login')} className="w-full flex items-center justify-center gap-2 text-red-500/80 text-sm py-3 hover:text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-xl transition mt-4">
                            <LogOut size={16} /> Выйти
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}