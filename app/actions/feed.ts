'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Хелпер для клиента (DRY)
async function getClient() {
    const cookieStore = await cookies()
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { } },
            },
        }
    )
}

// 1. СОЗДАНИЕ ПОСТА
export async function createPostAction(content: string, imageUrl?: string | null) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    if (!content.trim() && !imageUrl) return { error: 'Empty post' }

    const { error } = await supabase.from('posts').insert({
        user_id: user.id,
        content,
        image_url: imageUrl || null
    })

    if (error) return { error: 'Failed to create post' }
    return { success: true }
}

// 2. УДАЛЕНИЕ ПОСТА
export async function deletePostAction(postId: string) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Удаляем (RLS в базе должен разрешать удаление только своего поста, но проверим и тут для надежности)
    const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id)

    if (error) return { error: 'Delete failed' }
    return { success: true }
}

// 3. ЛАЙК / ДИЗЛАЙК
export async function toggleLikeAction(postId: string, isLiked: boolean) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    if (isLiked) {
        // Убираем лайк
        await supabase.from('likes').delete().match({ user_id: user.id, post_id: postId })
    } else {
        // Ставим лайк
        await supabase.from('likes').insert({ user_id: user.id, post_id: postId })
    }
    return { success: true }
}

// 4. КОММЕНТАРИЙ
export async function sendCommentAction(postId: string, content: string) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    if (!content.trim()) return { error: 'Empty comment' }

    const { error } = await supabase.from('comments').insert({
        user_id: user.id,
        post_id: postId,
        content
    })

    if (error) return { error: 'Failed to comment' }
    return { success: true }
}

// 5. ЗАГРУЗКА КОММЕНТАРИЕВ (Чтение тоже можно перенести)
export async function getCommentsAction(postId: string) {
    const supabase = await getClient()
    const { data } = await supabase
        .from('comments')
        .select('*, profiles(username, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })

    return { data: data || [] }
}