'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/utils/supabase'
import Link from 'next/link'
import { ArrowLeft, Camera, LogOut, User, AtSign, Loader2 } from 'lucide-react'

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

        // Валидация юзернейма
        if (username.length < 3) return alert('Юзернейм слишком короткий!')

        setSaving(true)

        try {
            const updates = {
                username: username,     // Технический ник (для ссылок @)
                full_name: fullName,    // Отображаемое имя (Иван Иванов)
                avatar_url: avatarUrl,
                updated_at: new Date().toISOString(),
            }

            const { error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', userId)

            if (error) {
                // Ошибка уникальности (код 23505 в Postgres)
                if (error.code === '23505') alert('Этот юзернейм уже занят!')
                else throw error
            } else {
                alert('Профиль обновлен!')
            }
        } catch (error: any) {
            alert('Ошибка обновления: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    const uploadAvatar = async (event: any) => {
        try {
            const file = event.target.files[0]
            if (!file) return

            // --- НОВАЯ ПРОВЕРКА ---
            if (file.type === 'image/gif') {
                alert('GIF аватарки запрещены! Используйте JPG или PNG.')
                return
            }
            // ----------------------

            const fileExt = file.name.split('.').pop()
            const filePath = `${userId}-${Date.now()}.${fileExt}`

            const { error } = await supabase.storage.from('avatars').upload(filePath, file)

            if (error) throw error

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
            setAvatarUrl(data.publicUrl)
        } catch (error) {
            alert('Ошибка загрузки. Возможно, формат файла не поддерживается.')
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
                                <input type="file" onChange={uploadAvatar} className="hidden" accept="image/*" disabled={saving} />
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