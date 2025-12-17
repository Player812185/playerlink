'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getClient() {
    // ... (тот же хелпер, можно вынести в отдельный файл utils/supabase-server.ts)
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

// 1. ОБНОВЛЕНИЕ ПРОФИЛЯ
export async function updateProfileAction(params: { username: string, fullName: string, avatarUrl: string }) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Валидация на сервере
    const username = params.username.toLowerCase().trim()
    if (username.length < 3) return { error: 'Никнейм слишком короткий' }
    if (!/^[a-z0-9_]+$/.test(username)) return { error: 'Недопустимые символы в нике' }

    const { error } = await supabase
        .from('profiles')
        .update({
            username: username,
            full_name: params.fullName.trim(),
            avatar_url: params.avatarUrl,
            updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

    if (error) {
        if (error.code === '23505') return { error: 'Этот никнейм уже занят' }
        return { error: 'Ошибка сохранения' }
    }

    return { success: true }
}

// 2. ПОДПИСКА / ОТПИСКА
export async function toggleFollowAction(targetId: string, isFollowing: boolean) {
    const supabase = await getClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    if (isFollowing) {
        await supabase.from('followers').delete().match({ follower_id: user.id, following_id: targetId })
    } else {
        await supabase.from('followers').insert({ follower_id: user.id, following_id: targetId })
    }
    return { success: true }
}