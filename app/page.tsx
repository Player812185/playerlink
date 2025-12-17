'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Heart, MessageCircle, Trash2, Mail, Sparkles, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ExpandableContent } from '@/components/ExpandableContent'
import { CreatePostWidget } from '@/components/CreatePostWidget'
import {
  deletePostAction,
  toggleLikeAction,
  sendCommentAction,
  getCommentsAction
} from '@/app/actions/feed'
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

// ... (типы Comment и Post без изменений) ...
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
    <div className="min-h-screen pb-20 font-sans bg-background text-foreground transition-colors duration-500">

      {/* HEADER: Glassmorphism */}
      <header className="sticky top-0 z-50 glass px-4 py-4 transition-all duration-300">
        <div className="max-w-xl mx-auto flex justify-between items-center">

          {/* Logo with Gradient */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="bg-primary/10 p-2 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <Sparkles className="text-primary w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gradient">
              Playerlink
            </h1>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && (
              <Link href="/messages" className="relative p-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 hover:scale-105" title="Мои сообщения">
                <Mail size={20} />
                {/* Индикатор можно добавить позже */}
              </Link>
            )}

            {/* Аватар с мягким свечением */}
            {user ? (
              <Link href={currentUsername ? `/u/${currentUsername}` : '#'} className="block relative ml-1 group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-blue-400 rounded-2xl opacity-0 group-hover:opacity-50 blur transition duration-500"></div>
                <img
                  src={userAvatar}
                  className="relative w-10 h-10 rounded-2xl object-cover border-2 border-background transition-transform duration-300 group-hover:scale-105"
                  onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                />
              </Link>
            ) : (
              <Link href="/login" className="bg-gradient-to-r from-primary to-blue-600 hover:opacity-90 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5">
                Войти
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4 space-y-6">

        {/* Create Widget */}
        {user && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
            <CreatePostWidget onPostCreated={() => fetchPosts(user)} />
          </div>
        )}

        {/* FEED */}
        <div className="space-y-6">
          {posts.map((post, index) => (
            <div
              key={post.id}
              className="bg-card border border-border/60 p-6 rounded-3xl shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300 group relative animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards"
              style={{ animationDelay: `${index * 50}ms` }}
            >

              {/* Header карточки */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <Link href={`/u/${post.profiles?.username}`} className="group/avatar block relative">
                    <div className="w-11 h-11 rounded-2xl overflow-hidden bg-muted border border-border group-hover/avatar:border-primary/50 transition-all duration-300">
                      <img
                        src={post.profiles?.avatar_url || PLACEHOLDER_IMG}
                        className="w-full h-full object-cover transform group-hover/avatar:scale-110 transition-transform duration-500"
                        onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                      />
                    </div>
                  </Link>
                  <div>
                    <Link href={`/u/${post.profiles?.username}`} className="font-bold text-[15px] text-foreground hover:text-primary transition-colors">
                      {post.profiles?.username || 'User'}
                    </Link>
                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                      {new Date(post.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>

                {user && user.id === post.profiles?.id && (
                  <button
                    onClick={() => deletePost(post.id)}
                    className="p-2 rounded-xl text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/5 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>

              {/* Контент */}
              <div className="mb-4 text-foreground/90 leading-relaxed text-[15px] pl-1">
                <ExpandableContent content={post.content} />
              </div>

              {/* Картинка (Modern Card Style) */}
              {post.image_url && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-border/50 bg-muted/30 shadow-inner">
                  <img src={post.image_url} className="w-full h-auto max-h-[500px] object-cover hover:scale-[1.01] transition-transform duration-500" />
                </div>
              )}

              {/* Actions Bar */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => toggleLike(post.id, post.is_liked)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95 ${post.is_liked
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <Heart size={18} className={post.is_liked ? "fill-current" : ""} />
                  <span>{post.likes_count > 0 && post.likes_count}</span>
                </button>

                <button
                  onClick={() => toggleComments(post.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95 ${post.show_comments
                      ? 'bg-primary/10 text-primary'
                      : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <MessageCircle size={18} />
                  <span>{post.comments_count > 0 && post.comments_count}</span>
                </button>
              </div>

              {/* Комментарии */}
              {post.show_comments && (
                <div className="mt-4 pt-4 border-t border-border/50 animate-in slide-in-from-top-2 fade-in duration-300">
                  <div className="space-y-3 mb-4 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                    {post.comments?.length > 0 ? post.comments.map(comment => (
                      <div key={comment.id} className="flex gap-3 p-2 rounded-2xl hover:bg-muted/50 transition-colors">
                        <img
                          src={comment.profiles?.avatar_url || PLACEHOLDER_IMG}
                          className="w-8 h-8 rounded-xl object-cover mt-1"
                          onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                        />
                        <div className="text-sm w-full">
                          <span className="font-bold mr-2 text-xs text-primary block mb-0.5">{comment.profiles.username}</span>
                          <span className="text-foreground/80 leading-relaxed">{comment.content}</span>
                        </div>
                      </div>
                    )) : (
                      <p className="text-center text-muted-foreground text-sm py-4 italic">Нет комментариев</p>
                    )}
                  </div>

                  <div className="relative flex items-center gap-2">
                    <input
                      value={commentInputs[post.id] || ''}
                      onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                      placeholder="Написать ответ..."
                      className="flex-grow bg-muted/50 hover:bg-muted focus:bg-background text-foreground text-sm p-3 rounded-xl border border-transparent focus:border-primary/30 focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all"
                      onKeyDown={(e) => e.key === 'Enter' && sendComment(post.id)}
                    />
                    <button
                      onClick={() => sendComment(post.id)}
                      className="p-3 bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition shadow-lg shadow-primary/20 active:scale-90"
                    >
                      <Send size={16} />
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