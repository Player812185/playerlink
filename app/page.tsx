'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { Bold, Italic, List, Code, Heart, MessageCircle, Send, Trash2, Paperclip, X, Mail } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ExpandableContent } from '@/components/ExpandableContent'

export const dynamic = 'force-dynamic'

type Comment = {
  id: string
  content: string
  created_at: string
  profiles: { username: string; avatar_url: string }
}

type Post = {
  id: string
  content: string
  image_url: string | null // Новое поле
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
  const [content, setContent] = useState('')
  const [user, setUser] = useState<any>(null)

  // Для загрузки картинок
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const PLACEHOLDER_IMG = '/placeholder.png'
  const [userAvatar, setUserAvatar] = useState(PLACEHOLDER_IMG)
  const [currentUsername, setCurrentUsername] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<{ [key: string]: string }>({})

  const checkUserAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setUser(user)
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .single()

      if (!profile?.username) {
        router.push('/settings') // Или complete-profile
      } else {
        setUserAvatar(profile.avatar_url || PLACEHOLDER_IMG)
        setCurrentUsername(profile.username) // <--- СОХРАНЯЕМ ЮЗЕРНЕЙМ
      }
    }
    fetchPosts(user)
  }

  const fetchPosts = async (currentUser = user) => {
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

  // Обработка выбора файла
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      setFile(selectedFile)
      setPreviewUrl(URL.createObjectURL(selectedFile))
    }
  }

  const clearFile = () => {
    setFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const createPost = async () => {
    if ((!content.trim() && !file) || !user) return

    let uploadedImageUrl = null

    // 1. Если есть файл, загружаем его
    if (file) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${user.id}-${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(fileName, file)

      if (!uploadError) {
        const { data } = supabase.storage.from('post-images').getPublicUrl(fileName)
        uploadedImageUrl = data.publicUrl
      }
    }

    // 2. Создаем пост
    await supabase.from('posts').insert({
      user_id: user.id,
      content,
      image_url: uploadedImageUrl
    })

    setContent('')
    clearFile()
    fetchPosts()
  }

  // ... остальные функции (toggleLike, toggleComments и т.д.) без изменений ...
  const toggleLike = async (postId: string, isLiked: boolean) => {
    if (!user) return router.push('/login')
    if (isLiked) await supabase.from('likes').delete().match({ user_id: user.id, post_id: postId })
    else await supabase.from('likes').insert({ user_id: user.id, post_id: postId })
    fetchPosts()
  }

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
    const { data } = await supabase.from('comments').select('*, profiles(username, avatar_url)').eq('post_id', postId).order('created_at', { ascending: true })
    if (data) setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: data } : p))
  }

  const sendComment = async (postId: string) => {
    const text = commentInputs[postId]
    if (!text?.trim() || !user) return
    const { error } = await supabase.from('comments').insert({ user_id: user.id, post_id: postId, content: text })
    if (!error) {
      setCommentInputs(prev => ({ ...prev, [postId]: '' }))
      loadComments(postId)
    }
  }

  const deletePost = async (postId: string) => {
    if (!confirm('Удалить пост?')) return
    await supabase.from('posts').delete().eq('id', postId)
    fetchPosts()
  }

  const insertFormat = (prefix: string, suffix: string) => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value

    const before = text.substring(0, start)
    const selection = text.substring(start, end)
    const after = text.substring(end)

    setContent(`${before}${prefix}${selection}${suffix}${after}`)
    textarea.focus()
  }

  useEffect(() => {
    checkUserAndFetch()
    const channel = supabase
      .channel('realtime_feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchPosts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, () => fetchPosts())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="min-h-screen pb-20 font-sans bg-background text-foreground transition-colors duration-300">

      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border px-4 py-4 transition-colors duration-300">
        <div className="max-w-xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Playerlink
          </h1>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            {user && (
              <Link
                href="/messages"
                className="p-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition relative"
                title="Мои сообщения"
              >
                <Mail size={20} />
              </Link>
            )}

            {user ? (
              <Link href={currentUsername ? `/u/${currentUsername}` : '#'} className="block relative ml-1">
                <img
                  src={userAvatar}
                  className="w-10 h-10 rounded-2xl object-cover border border-border hover:border-primary transition duration-300"
                  onError={(e) => e.currentTarget.src = PLACEHOLDER_IMG}
                />
              </Link>
            ) : (
              <Link href="/login" className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2 rounded-xl text-sm font-semibold transition shadow-lg shadow-primary/20">
                Войти
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {/* Создание поста с Редактором */}
        {user && (
          <div className="mb-6 bg-card p-4 rounded-3xl border border-border shadow-sm">
            {/* Тулбар */}
            <div className="flex gap-1 mb-2 overflow-x-auto pb-2 border-b border-border/50">
              <button onClick={() => insertFormat('**', '**')} className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground" title="Жирный">
                <Bold size={16} />
              </button>
              <button onClick={() => insertFormat('*', '*')} className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground" title="Курсив">
                <Italic size={16} />
              </button>
              <button onClick={() => insertFormat('\n- ', '')} className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground" title="Список">
                <List size={16} />
              </button>
              <button onClick={() => insertFormat('`', '`')} className="p-2 hover:bg-muted rounded text-muted-foreground hover:text-foreground" title="Код">
                <Code size={16} />
              </button>
              {/* Подсказка про упоминания */}
              <span className="ml-auto text-xs text-muted-foreground flex items-center px-2">
                @ник для упоминания
              </span>
            </div>

            <div className="flex gap-3 items-start">
              <div className="flex-grow space-y-3">
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Что нового?"
                  className="w-full bg-transparent text-foreground p-2 min-h-[80px] resize-none focus:outline-none placeholder-muted-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createPost() } }}
                />

                {/* Превью картинки */}
                {previewUrl && (
                  <div className="relative inline-block">
                    <img src={previewUrl} className="h-24 w-auto rounded-xl border border-border object-cover" />
                    <button onClick={clearFile} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md hover:bg-red-600 transition">
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {/* Кнопка отправки */}
                <button
                  onClick={createPost}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground p-4 rounded-2xl transition shadow-lg shadow-primary/20 flex items-center justify-center aspect-square"
                >
                  <Send size={20} />
                </button>

                {/* Кнопка скрепки */}
                <label className="bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground p-4 rounded-2xl transition cursor-pointer flex items-center justify-center aspect-square">
                  <Paperclip size={20} />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                    ref={fileInputRef}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Лента */}
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-card border border-border p-5 rounded-3xl hover:border-muted-foreground/30 transition duration-300 shadow-sm">

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
                {user && user.id === post.profiles?.id && (
                  <button onClick={() => deletePost(post.id)} className="p-2 rounded-xl hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* Контент с Markdown */}
              <div className="mb-5 text-foreground leading-relaxed pl-1">
                <ExpandableContent content={post.content} />
              </div>
              {/* Картинка поста */}
              {post.image_url && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-border bg-muted">
                  <img src={post.image_url} className="w-full h-auto max-h-96 object-cover" />
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => toggleLike(post.id, post.is_liked)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition duration-300 ${post.is_liked
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                    }`}
                >
                  <Heart size={18} className={post.is_liked ? "fill-current" : ""} />
                  {post.likes_count}
                </button>

                <button
                  onClick={() => toggleComments(post.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition duration-300 ${post.show_comments
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                    }`}
                >
                  <MessageCircle size={18} />
                  {post.comments_count > 0 ? post.comments_count : 'Коммент'}
                </button>
              </div>

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