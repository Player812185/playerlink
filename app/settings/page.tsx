'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Camera, LogOut, User, AtSign, Loader2 } from 'lucide-react'
import { updateProfileAction } from '@/app/actions/profile'
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

export default function Settings() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Два отдельных состояния
    const [username, setUsername] = useState('')
    const [fullName, setFullName] = useState('')

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
            const { data } = await supabase
                .from('profiles')
                .select('username, full_name, avatar_url') // Запрашиваем оба поля
                .eq('id', user.id)
                .single()

            if (data) {
                setUsername(data.username || '')
                setFullName(data.full_name || '') // Заполняем имя
                setAvatarUrl(data.avatar_url || '')
            }
        }
        setLoading(false)
    }

    const updateProfile = async () => {
        if (!userId) return

        setSaving(true) // Показываем спиннер

        // Вызов Server Action
        const res = await updateProfileAction({
            username,
            fullName,
            avatarUrl
        })

        setSaving(false)

        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success('Профиль обновлен!')
        }
    }

    const convertToJpg = (file: File): Promise<File> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            const url = URL.createObjectURL(file)

            img.onload = () => {
                // Создаем холст
                const canvas = document.createElement('canvas')
                canvas.width = img.width
                canvas.height = img.height
                const ctx = canvas.getContext('2d')

                if (!ctx) {
                    reject(new Error('Canvas context failed'))
                    return
                }

                // Заливаем белым (на случай прозрачного PNG), иначе будет черный фон
                ctx.fillStyle = '#FFFFFF'
                ctx.fillRect(0, 0, canvas.width, canvas.height)

                // Рисуем картинку (это берет только ПЕРВЫЙ кадр, если это анимация)
                ctx.drawImage(img, 0, 0)

                // Конвертируем в JPG Blob
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Conversion failed'))
                        return
                    }
                    // Создаем новый файл
                    const newFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
                    resolve(newFile)

                    // Чистим память
                    URL.revokeObjectURL(url)
                }, 'image/jpeg', 0.9) // 0.9 - качество (90%)
            }

            img.onerror = (err) => reject(err)
            img.src = url
        })
    }

    const uploadAvatar = async (event: any) => {
        try {
            const originalFile = event.target.files[0]
            if (!originalFile) return

            // 1. КОНВЕРТАЦИЯ
            // Превращаем что угодно (WebP, PNG, GIF, APNG) в статичный JPG
            const jpgFile = await convertToJpg(originalFile)

            // 2. ЗАГРУЗКА
            // Имя файла теперь всегда заканчивается на .jpg
            const filePath = `${userId}-${Date.now()}.jpg`

            const { error } = await supabase.storage.from('avatars').upload(filePath, jpgFile)
            if (error) throw error

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
            setAvatarUrl(data.publicUrl)

        } catch (error) {
            console.error(error)
            toast.error('Ошибка обработки картинки')
        }
    }

    if (loading) return (
        <div className="min-h-screen bg-background flex items-center justify-center text-primary">
            <Loader2 className="animate-spin" />
        </div>
    )

    return (
        <div className="min-h-screen bg-background text-foreground p-4 font-sans">
            <div className="max-w-md mx-auto mt-6">
                <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition">
                    <ArrowLeft size={18} className="mr-2" /> На главную
                </Link>

                <div className="bg-card p-8 rounded-3xl border border-border shadow-xl">
                    <h1 className="text-xl font-bold mb-6 text-center">Редактировать профиль</h1>

                    {/* Аватар */}
                    <div className="flex flex-col items-center mb-8 relative group w-fit mx-auto">
                        <div className="relative w-28 h-28">
                            <img
                                src={avatarUrl || PLACEHOLDER_IMG}
                                className="w-full h-full rounded-3xl object-cover border-4 border-background shadow-sm"
                                onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                            />
                            <label className="absolute -bottom-2 -right-2 bg-primary p-2.5 rounded-xl cursor-pointer hover:bg-primary/90 transition shadow-lg text-primary-foreground border-4 border-background">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                                <input type="file" onChange={uploadAvatar} className="hidden" accept="image/*" />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-5">

                        {/* Поле 1: Отображаемое имя */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground ml-1 flex items-center gap-1">
                                <User size={12} /> Отображаемое имя
                            </label>
                            <input
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="Иван Иванов"
                                className="w-full bg-background border border-border p-3 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
                            />
                            <p className="text-[10px] text-muted-foreground ml-1">Это имя видно в шапке профиля.</p>
                        </div>

                        {/* Поле 2: Юзернейм */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground ml-1 flex items-center gap-1">
                                <AtSign size={12} /> Юзернейм (ID)
                            </label>
                            <input
                                value={username}
                                // Строгая фильтрация: только латиница, цифры, _
                                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                placeholder="ivan_ivanov"
                                className="w-full bg-background border border-border p-3 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
                            />
                            <p className="text-[10px] text-muted-foreground ml-1">Используется для входа и ссылок (@). Только латиница.</p>
                        </div>

                        <button
                            onClick={updateProfile}
                            disabled={saving}
                            className="w-full bg-primary text-primary-foreground font-semibold p-3.5 rounded-xl hover:bg-primary/90 transition shadow-lg shadow-primary/20 mt-4 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 className="animate-spin" /> : 'Сохранить изменения'}
                        </button>

                        <div className="h-px bg-border my-4"></div>

                        <button
                            onClick={() => supabase.auth.signOut().then(() => location.href = '/login')}
                            className="w-full flex items-center justify-center gap-2 text-red-500/80 text-sm py-3 hover:text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-xl transition"
                        >
                            <LogOut size={16} /> Выйти из аккаунта
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}