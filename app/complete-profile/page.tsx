'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/utils/supabase'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

export default function CompleteProfile() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [username, setUsername] = useState('')
    const [avatarUrl, setAvatarUrl] = useState('')
    const [userId, setUserId] = useState<string | null>(null)

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }
            setUserId(user.id)

            // Если у пользователя уже есть данные (например, аватарка от Google), подгрузим их
            const { data: profile } = await supabase
                .from('profiles')
                .select('avatar_url, username')
                .eq('id', user.id)
                .single()

            if (profile?.username) {
                // Если ник уже есть, нечего тут делать, идем в ленту
                router.push('/')
            }
            if (profile?.avatar_url) setAvatarUrl(profile.avatar_url)
        }
        getUser()
    }, [])

    const handleSave = async () => {
        // ВАЛИДАЦИЯ:
        if (!username.trim() || username.trim().length < 3) return toast.error('Никнейм должен быть минимум 3 символа!')
        if (!userId) return

        setLoading(true)

        // Проверка: свободен ли ник?
        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .neq('id', userId) // Исключаем себя
            .single()

        if (existing) {
            setLoading(false)
            return toast.error('Этот ник уже занят!')
        }

        // Сохраняем
        const { error } = await supabase
            .from('profiles')
            .update({
                username: username.trim(), // Обрезаем пробелы
                avatar_url: avatarUrl,
                full_name: username.trim() // Или добавьте отдельное поле ввода для имени
            })
            .eq('id', userId)

        if (error) {
            toast.error('Ошибка: ' + error.message)
        } else {
            router.refresh() // Обновить кэш
            router.push('/') // Пускаем в ленту
        }
        setLoading(false)
    }

    const uploadAvatar = async (event: any) => {
        try {
            const file = event.target.files[0]
            if (!file) return

            // --- НОВАЯ ПРОВЕРКА ---
            if (file.type === 'image/gif') {
                toast.error('GIF аватарки запрещены! Используйте JPG или PNG.')
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
            toast.error('Ошибка загрузки. Возможно, формат файла не поддерживается.')
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                <h1 className="text-2xl font-bold mb-2">Добро пожаловать!</h1>
                <p className="text-gray-500 mb-6">Давайте оформим ваш профиль, прежде чем начать.</p>

                {/* Аватар */}
                <div className="relative w-32 h-32 mx-auto mb-6">
                    <div className="w-full h-full rounded-full overflow-hidden bg-gray-200 border-2 border-dashed border-gray-400 flex items-center justify-center">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-gray-400 text-4xl">+</span>
                        )}
                    </div>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={uploadAvatar}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <p className="text-xs text-gray-400 mt-2">Нажмите на круг для фото</p>
                </div>

                {/* Никнейм */}
                <div className="text-left mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Придумайте никнейм (@)</label>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} // Только латиница и цифры
                        placeholder="super_player"
                        className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                </div>

                <button
                    onClick={handleSave}
                    disabled={loading}
                    className="w-full bg-black text-white py-3 rounded-lg font-bold hover:bg-gray-800 transition disabled:opacity-50"
                >
                    {loading ? 'Сохранение...' : 'Начать пользоваться'}
                </button>
            </div>
        </div>
    )
}