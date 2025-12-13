'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Settings, Heart, MessageCircle, Mail, UserCheck, UserPlus } from 'lucide-react'

export default function UserProfile() {
    const { id } = useParams() // Получаем ID из URL
    const router = useRouter()

    const [profile, setProfile] = useState<any>(null)
    const [posts, setPosts] = useState<any[]>([])
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followersCount, setFollowersCount] = useState(0)
    const [followingCount, setFollowingCount] = useState(0)

    const PLACEHOLDER_IMG = '/placeholder.png'

    useEffect(() => {
        fetchData()
    }, [id])

    const fetchData = async () => {
        // 1. Кто я?
        const { data: { user } } = await supabase.auth.getUser()
        setCurrentUser(user)

        // 2. Чей профиль смотрим?
        const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single()

        setProfile(profileData)

        // 3. Посты этого юзера
        const { data: postsData } = await supabase
            .from('posts')
            .select('*, likes(count), comments(count)')
            .eq('user_id', id)
            .order('created_at', { ascending: false })

        setPosts(postsData || [])

        // 4. Подписчики (Меня читают)
        const { count: followers } = await supabase
            .from('followers')
            .select('*', { count: 'exact', head: true })
            .eq('following_id', id)
        setFollowersCount(followers || 0)

        // 5. Подписки (Я читаю)
        const { count: following } = await supabase
            .from('followers')
            .select('*', { count: 'exact', head: true })
            .eq('follower_id', id)
        setFollowingCount(following || 0)

        // 6. Подписан ли я на него?
        if (user && user.id !== id) {
            const { data } = await supabase
                .from('followers')
                .select('*')
                .match({ follower_id: user.id, following_id: id })
                .single()
            setIsFollowing(!!data)
        }
    }

    const handleFollow = async () => {
        if (!currentUser) return router.push('/login')

        if (isFollowing) {
            // Отписка
            await supabase.from('followers').delete().match({ follower_id: currentUser.id, following_id: id })
            setFollowersCount(prev => prev - 1)
        } else {
            // Подписка
            await supabase.from('followers').insert({ follower_id: currentUser.id, following_id: id })
            setFollowersCount(prev => prev + 1)
        }
        setIsFollowing(!isFollowing)
    }

    if (!profile) return <div className="min-h-screen bg-background flex items-center justify-center">Загрузка...</div>

    const isMe = currentUser?.id === profile.id

    return (
        <div className="min-h-screen bg-background text-foreground pb-20 font-sans">

            {/* Шапка профиля */}
            <div className="bg-card border-b border-border pb-8 pt-4 px-4">
                <div className="max-w-xl mx-auto">
                    <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition">
                        <ArrowLeft size={20} className="mr-2" /> Назад
                    </Link>

                    <div className="flex flex-col items-center">
                        <img
                            src={profile.avatar_url || PLACEHOLDER_IMG}
                            className="w-24 h-24 rounded-3xl object-cover border-4 border-background shadow-xl mb-4"
                            onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                        />
                        <h1 className="text-2xl font-bold mb-1">{profile.username}</h1>

                        {/* Статистика */}
                        <div className="flex gap-6 text-sm text-muted-foreground mb-6">
                            <div className="text-center">
                                <span className="block text-foreground font-bold text-lg">{posts.length}</span>
                                Постов
                            </div>
                            <div className="text-center">
                                <span className="block text-foreground font-bold text-lg">{followersCount}</span>
                                Подписчиков
                            </div>
                            <div className="text-center">
                                <span className="block text-foreground font-bold text-lg">{followingCount}</span>
                                Подписок
                            </div>
                        </div>

                        {/* --- НАЧАЛО БЛОКА КНОПОК ДЕЙСТВИЯ --- */}
                        <div className="flex gap-3 mt-6">
                            {isMe ? (
                                // ВАРИАНТ 1: Это мой профиль -> Показываем настройки
                                <Link
                                    href="/settings"
                                    className="flex items-center gap-2 bg-muted hover:bg-muted/80 text-foreground px-6 py-2.5 rounded-xl font-medium transition border border-border"
                                >
                                    <Settings size={18} />
                                    Настройки
                                </Link>
                            ) : (
                                // ВАРИАНТ 2: Это чужой профиль -> Показываем Подписку и Сообщение
                                <>
                                    <button
                                        onClick={handleFollow}
                                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition shadow-lg ${isFollowing
                                            ? 'bg-muted text-muted-foreground border border-border hover:bg-muted/80 hover:text-foreground' // Стиль "Вы подписаны" (серый)
                                            : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20' // Стиль "Подписаться" (синий)
                                            }`}
                                    >
                                        {isFollowing ? (
                                            <>
                                                <UserCheck size={18} /> Вы подписаны
                                            </>
                                        ) : (
                                            <>
                                                <UserPlus size={18} /> Подписаться
                                            </>
                                        )}
                                    </button>

                                    {/* Кнопка сообщения */}
                                    <Link
                                        href={`/messages/${profile.id}`}
                                        className="flex items-center justify-center bg-muted hover:bg-muted/80 text-foreground px-4 py-2.5 rounded-xl border border-border transition hover:border-primary/50 hover:text-primary"
                                        title="Написать сообщение"
                                    >
                                        <Mail size={20} />
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Список постов */}
            <div className="max-w-xl mx-auto p-4 space-y-4">
                <h2 className="text-lg font-bold ml-1">Публикации</h2>
                {posts.map(post => (
                    <div key={post.id} className="bg-card border border-border p-5 rounded-3xl">
                        <p className="mb-4 text-foreground leading-relaxed whitespace-pre-wrap">{post.content}</p>
                        <div className="flex gap-4 text-muted-foreground text-sm">
                            <span className="flex gap-1 items-center"><Heart size={16} /> {post.likes[0]?.count || 0}</span>
                            <span className="flex gap-1 items-center"><MessageCircle size={16} /> {post.comments[0]?.count || 0}</span>
                            <span className="ml-auto text-xs opacity-50">{new Date(post.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
                {posts.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground bg-card/50 rounded-3xl border border-dashed border-border">
                        У пользователя пока нет постов
                    </div>
                )}
            </div>
        </div>
    )
}