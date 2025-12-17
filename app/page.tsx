'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Heart, MessageCircle, Send, Trash2, Mail } from 'lucide-react' // Убрали лишние иконки (Bold, Paperclip и т.д.)
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ExpandableContent } from '@/components/ExpandableContent'
import { CreatePostWidget } from '@/components/CreatePostWidget' // <--- Наш новый виджет
import {
  deletePostAction,
  toggleLikeAction,
  sendCommentAction,
  getCommentsAction
} from '@/app/actions/feed' // <--- Server Actions
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

// ... (Типы Comment и Post оставляем как были) ...
type Comment = {
  id: string
  content: string
  created_at: string
  profiles: { username: string; avatar_url: string }
}

type Post = {
  id: string
  content: string
  image_url: string | null
  created_at: string
  profiles: { id: string; username: string; avatar_url: string }
  likes_count: number
  is_liked: boolean
  comments_count: number
  show_comments: boolean
  comments: Comment[]
}

export default function Home() {
  const router = useRouter()
  const [posts, setPosts] = useState<Post[]>([])
  const [user, setUser] = useState<any>(null)

  // Мы УДАЛИЛИ: content, file, previewUrl, fileInputRef - это теперь внутри виджета

  const PLACEHOLDER_IMG = '/placeholder.png'
  const [userAvatar, setUserAvatar] = useState(PLACEHOLDER_IMG)
  const [currentUsername, setCurrentUsername] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<{ [key: string]: string }>({})

  const checkUserAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setUser(user)
      const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
      if (!profile?.username) router.push('/settings')
      else {
        setUserAvatar(profile.avatar_url || PLACEHOLDER_IMG)
        setCurrentUsername(profile.username)
      }
    }
    fetchPosts(user)
  }

  const fetchPosts = async (currentUser = user) => {
    // Оставляем старый fetch или переносим его в Server Action (getFeedAction) - по желанию. 
    // Пока оставим клиентский fetch для простоты, так как он сложный (join-ы).
    const { data } = await supabase
      .from('posts')
      .select(`*, profiles(id, username, avatar_url), likes(user_id), comments(count)`)
      .order('created_at', { ascending: false })

    if (data) {
      const formatted = data.map((post: any) => ({
        ...post,
        likes_count: post.likes.length,
        comments_count: post.comments[0]?.count || 0,
        is_liked: currentUser ? post.likes.some((l: any) => l.user_id === currentUser.id) : false,
        show_comments: false,
        comments: []
      }))

      // Логика сохранения открытых комментариев при обновлении
      setPosts(prev => {
        if (prev.length === 0) return formatted
        return formatted.map((newPost: any) => {
          const oldPost = prev.find(p => p.id === newPost.id)
          if (oldPost?.show_comments) return { ...newPost, show_comments: true, comments: oldPost.comments }
          return newPost
        })
      })
    }
  }

  // --- ACTIONS ---

  // 1. УДАЛЕНИЕ (Server Action)
  const deletePost = async (postId: string) => {
    if (!confirm('Удалить пост?')) return

    // Optimistic
    const oldPosts = [...posts]
    setPosts(prev => prev.filter(p => p.id !== postId))

    const res = await deletePostAction(postId)

    if (res.error) {
      toast.error(res.error)
      setPosts(oldPosts)
    } else {
      toast.success('Пост удален')
    }
  }

  // 2. ЛАЙК (Server Action)
  const toggleLike = async (postId: string, isLiked: boolean) => {
    if (!user) return router.push('/login')

    // Optimistic UI
    setPosts(current => current.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          is_liked: !isLiked,
          likes_count: isLiked ? p.likes_count - 1 : p.likes_count + 1
        }
      }
      return p
    }))

    const res = await toggleLikeAction(postId, isLiked)
    if (res.error) {
      toast.error('Не удалось лайкнуть')
      fetchPosts() // Откат
    }
  }

  // 3. КОММЕНТАРИИ (Server Action)
  const toggleComments = async (postId: string) => {
    setPosts(currentPosts => currentPosts.map(post => {
      if (post.id === postId) {
        if (!post.show_comments) loadComments(postId)
        return { ...post, show_comments: !post.show_comments }
      }
      return post
    }))
  }

  const loadComments = async (postId: string) => {
    // Используем наш новый Action для загрузки
    const res = await getCommentsAction(postId)
    if (res.data) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: res.data as any } : p))
    }
  }

  const sendComment = async (postId: string) => {
    const text = commentInputs[postId]
    if (!text?.trim() || !user) return

    // Optimistic UI для комментов сложнее, поэтому просто ждем (или можно добавить "фейковый")
    const res = await sendCommentAction(postId, text)

    if (res.error) {
      toast.error(res.error)
    } else {
      setCommentInputs(prev => ({ ...prev, [postId]: '' }))
      loadComments(postId)
      toast.success('Комментарий отправлен')
    }
  }

  useEffect(() => {
    checkUserAndFetch()
    const channel = supabase.channel('realtime_feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchPosts())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="min-h-screen pb-20 font-sans bg-background text-foreground transition-colors duration-300">

      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border px-4 py-4 transition-colors duration-300">
        <div className="max-w-xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Playerlink</h1>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && (
              <Link href="/messages" className="p-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition relative">
                <Mail size={20} />
              </Link>
            )}
            {user ? (
              <Link href={currentUsername ? `/u/${currentUsername}` : '#'} className="block relative ml-1">
                <img src={userAvatar} className="w-10 h-10 rounded-2xl object-cover border border-border hover:border-primary transition duration-300" onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG} />
              </Link>
            ) : (
              <Link href="/login" className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-xl text-sm font-semibold transition shadow-lg shadow-primary/20">Войти</Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">

        {/* --- ВИДЖЕТ СОЗДАНИЯ ПОСТА --- */}
        {/* Заменили огромный кусок кода на одну строку */}
        {user && (
          <CreatePostWidget onPostCreated={() => fetchPosts(user)} />
        )}

        {/* --- ЛЕНТА --- */}
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-card border border-border p-5 rounded-3xl hover:border-muted-foreground/30 transition duration-300 shadow-sm relative group">

              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <Link href={`/u/${post.profiles?.username}`} className="group block">
                    <div className="w-10 h-10 rounded-2xl overflow-hidden bg-muted border border-border group-hover:border-primary transition duration-300">
                      <img
                        src={post.profiles?.avatar_url || PLACEHOLDER_IMG}
                        className="w-full h-full object-cover"
                        onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                      />
                    </div>
                  </Link>
                  <div>
                    <Link href={`/u/${post.profiles?.username}`} className="font-bold text-sm text-foreground hover:text-primary transition">
                      {post.profiles?.username || 'User'}
                    </Link>
                    <p className="text-xs text-muted-foreground">{new Date(post.created_at).toLocaleDateString()}</p>
                  </div>
                </div>

                {/* КНОПКА УДАЛЕНИЯ (Теперь через Action) */}
                {user && user.id === post.profiles?.id && (
                  <button
                    onClick={() => deletePost(post.id)}
                    className="p-2 rounded-xl hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* Контент */}
              <div className="mb-5 text-foreground leading-relaxed pl-1">
                <ExpandableContent content={post.content} />
              </div>

              {/* Картинка */}
              {post.image_url && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-border bg-muted">
                  <img src={post.image_url} className="w-full h-auto max-h-96 object-cover" />
                </div>
              )}

              {/* Футер поста (Лайки, Комменты) */}
              <div className="flex gap-4">
                <button
                  onClick={() => toggleLike(post.id, post.is_liked)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition duration-300 ${post.is_liked ? 'bg-red-500/10 text-red-500' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
                >
                  <Heart size={18} className={post.is_liked ? "fill-current" : ""} />
                  {post.likes_count}
                </button>

                <button
                  onClick={() => toggleComments(post.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition duration-300 ${post.show_comments ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
                >
                  <MessageCircle size={18} />
                  {post.comments_count > 0 ? post.comments_count : 'Коммент'}
                </button>
              </div>

              {/* Секция комментариев */}
              {post.show_comments && (
                <div className="mt-4 pt-4 border-t border-border animate-in slide-in-from-top-2 fade-in duration-200">
                  <div className="space-y-3 mb-4 max-h-64 overflow-y-auto custom-scrollbar">
                    {post.comments?.length > 0 ? post.comments.map(comment => (
                      <div key={comment.id} className="flex gap-3 bg-muted/50 p-3 rounded-2xl border border-border">
                        <img
                          src={comment.profiles?.avatar_url || PLACEHOLDER_IMG}
                          className="w-8 h-8 rounded-xl object-cover mt-0.5"
                          onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                        />
                        <div className="text-sm w-full">
                          <span className="font-bold mr-2 text-xs text-primary block mb-0.5">{comment.profiles.username}</span>
                          <span className="text-foreground/90">{comment.content}</span>
                        </div>
                      </div>
                    )) : (
                      <p className="text-center text-muted-foreground text-sm py-2">Здесь пока пусто.</p>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      value={commentInputs[post.id] || ''}
                      onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                      placeholder="Написать ответ..."
                      className="w-full bg-muted text-foreground text-sm p-3 pr-10 rounded-xl border border-transparent focus:border-primary/50 focus:bg-background focus:outline-none transition"
                      onKeyDown={(e) => e.key === 'Enter' && sendComment(post.id)}
                    />
                    <button
                      onClick={() => sendComment(post.id)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-primary rounded-lg text-primary-foreground hover:bg-primary/90 transition"
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}