'use client'
import { useEffect, useState, use } from 'react' // use для params в Next 15
import { supabase } from '@/utils/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Settings, Heart, MessageCircle, Mail, UserCheck, UserPlus } from 'lucide-react'

// В Next.js 15 params - это Promise
export default function UserProfile({ params }: { params: Promise<{ username: string }> }) {
    // Разворачиваем параметры через хук use (или await, если компонент серверный, но у нас client)
    const { username } = use(params)
    const router = useRouter()

    const [profile, setProfile] = useState<any>(null)
    const [posts, setPosts] = useState<any[]>([])
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followersCount, setFollowersCount] = useState(0)
    const [followingCount, setFollowingCount] = useState(0)
    const [loading, setLoading] = useState(true)

    const PLACEHOLDER_IMG = '/placeholder.png'

    useEffect(() => {
        fetchData()
    }, [username])

    const fetchData = async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            setCurrentUser(user)

            // 1. Ищем профиль по USERNAME, а не по ID
            // Используем decodeURIComponent, чтобы русские ники и спецсимволы работали
            const decodedUsername = decodeURIComponent(username)
            const { data: profileData, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('username', decodedUsername)
                .single()

            if (error || !profileData) {
                alert('Пользователь не найден')
                router.push('/')
                return
            }

            setProfile(profileData)

            // 2. Посты этого юзера (используем ID из найденного профиля)
            const { data: postsData } = await supabase
                .from('posts')
                .select('*, likes(count), comments(count)')
                .eq('user_id', profileData.id)
                .order('created_at', { ascending: false })

            setPosts(postsData || [])

            // 3. Подписки/Подписчики
            const { count: followers } = await supabase
                .from('followers')
                .select('*', { count: 'exact', head: true })
                .eq('following_id', profileData.id)
            setFollowersCount(followers || 0)

            const { count: following } = await supabase
                .from('followers')
                .select('*', { count: 'exact', head: true })
                .eq('follower_id', profileData.id)
            setFollowingCount(following || 0)

            // 4. Подписан ли я?
            if (user && user.id !== profileData.id) {
                const { data } = await supabase
                    .from('followers')
                    .select('*')
                    .match({ follower_id: user.id, following_id: profileData.id })
                    .single()
                setIsFollowing(!!data)
            }
        } finally {
            setLoading(false)
        }
    }

    const handleFollow = async () => {
        if (!currentUser) return router.push('/login')
        if (!profile) return

        if (isFollowing) {
            await supabase.from('followers').delete().match({ follower_id: currentUser.id, following_id: profile.id })
            setFollowersCount(prev => prev - 1)
        } else {
            await supabase.from('followers').insert({ follower_id: currentUser.id, following_id: profile.id })
            setFollowersCount(prev => prev + 1)
        }
        setIsFollowing(!isFollowing)
    }

    if (loading) return <div className="min-h-screen bg-background flex items-center justify-center">Загрузка...</div>
    if (!profile) return null

    const isMe = currentUser?.id === profile.id

    return (
        <div className="min-h-screen bg-background text-foreground pb-20 font-sans">
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
                        <p className="text-sm text-muted-foreground">{profile.full_name}</p>

                        <div className="flex gap-6 text-sm text-muted-foreground mb-6 mt-4">
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

                        <div className="flex gap-3 mt-2">
                            {isMe ? (
                                <Link
                                    href="/settings"
                                    className="flex items-center gap-2 bg-muted hover:bg-muted/80 text-foreground px-6 py-2.5 rounded-xl font-medium transition border border-border"
                                >
                                    <Settings size={18} />
                                    Настройки
                                </Link>
                            ) : (
                                <>
                                    <button
                                        onClick={handleFollow}
                                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition shadow-lg ${isFollowing
                                            ? 'bg-muted text-muted-foreground border border-border hover:bg-muted/80 hover:text-foreground'
                                            : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20'
                                            }`}
                                    >
                                        {isFollowing ? <><UserCheck size={18} /> Вы подписаны</> : <><UserPlus size={18} /> Подписаться</>}
                                    </button>

                                    <Link
                                        href={`/messages/${profile.id}`} // Чат остается по ID, так надежнее для БД, но можно переделать на username, если сильно надо
                                        className="flex items-center justify-center bg-muted hover:bg-muted/80 text-foreground px-4 py-2.5 rounded-xl border border-border transition hover:border-primary/50 hover:text-primary"
                                    >
                                        <Mail size={20} />
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-xl mx-auto p-4 space-y-4">
                <h2 className="text-lg font-bold ml-1">Публикации</h2>
                {posts.map(post => (
                    <div key={post.id} className="bg-card border border-border p-5 rounded-3xl">
                        <p className="mb-4 text-foreground leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
                        {post.image_url && (
                            <div className="mb-4 rounded-2xl overflow-hidden border border-border bg-muted">
                                <img src={post.image_url} className="w-full h-auto object-cover" />
                            </div>
                        )}
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