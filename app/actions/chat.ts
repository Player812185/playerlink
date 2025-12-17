'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Типы для входных данных
type SendMessageParams = {
    id: string // Мы генерируем ID на клиенте для Optimistic UI
    content: string
    receiverId: string
    fileUrl?: string | null
    fileUrls?: string[] | null
    fileNames?: string[] | null
    replyToId?: string | null
}

export async function sendMessageAction(params: SendMessageParams) {
    const cookieStore = await cookies()

    // 1. Создаем клиент в контексте сервера
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) {
                    // В Server Action мы обычно не ставим куки, но метод нужен
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
                    } catch {}
                },
            },
        }
    )

    // 2. Получаем юзера (Серверная проверка авторизации)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return { error: 'Unauthorized' }
    }

    // 3. Валидация (Минимальная, можно расширить Zod)
    if (!params.content.trim() && (!params.fileUrls || params.fileUrls.length === 0)) {
        return { error: 'Message cannot be empty' }
    }

    // 4. Вставка в БД
    const { error: dbError } = await supabase.from('messages').insert({
        id: params.id, // Используем ID с клиента для связки с Optimistic UI
        sender_id: user.id,
        receiver_id: params.receiverId,
        content: params.content,
        file_url: params.fileUrl || null,
        file_urls: params.fileUrls || null,
        file_names: params.fileNames || null,
        reply_to_id: params.replyToId
    })

    if (dbError) {
        console.error('DB Error:', dbError)
        return { error: 'Failed to save message' }
    }

    // 5. Отправка Push-уведомления (ПРЯМО НА СЕРВЕРЕ)
    // Нам больше не нужно дергать внешний /api/route, делаем всё тут
    const APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
    const API_KEY = process.env.ONESIGNAL_REST_API_KEY

    if (APP_ID && API_KEY) {
        // Получаем имя отправителя для красивого пуша
        const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single()
        
        const senderName = profile?.username || 'User'
        const hasFiles = params.fileUrls && params.fileUrls.length > 0

        try {
            await fetch('https://onesignal.com/api/v1/notifications', {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    Authorization: `Basic ${API_KEY}`
                },
                body: JSON.stringify({
                    app_id: APP_ID,
                    include_aliases: { external_id: [params.receiverId] },
                    target_channel: "push",
                    contents: { en: hasFiles ? '📷 Отправил файл' : params.content },
                    headings: { en: `Новое сообщение от ${senderName}` },
                    url: 'https://www.playerlink.fun/messages' // Лучше вынести в ENV
                })
            })
        } catch (e) {
            console.error('Push error:', e)
            // Ошибку пуша не возвращаем клиенту, чтобы не пугать, сообщение-то ушло
        }
    }

    return { success: true }
}

const LIMIT = 50 // Константа для пагинации

// 1. ПОЛУЧЕНИЕ СООБЩЕНИЙ (Fetch)
export async function getMessagesAction(partnerId: string, offset: number = 0) {
    const supabase = await createServerSupabaseClient() // См. ниже helper
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return { error: 'Unauthorized', data: [] }

    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false }) // Берем с конца
        .range(offset, offset + LIMIT - 1)

    if (error) {
        console.error('Fetch error:', error)
        return { error: 'Failed to fetch messages', data: [] }
    }

    // Возвращаем в правильном порядке (для UI: старые -> новые)
    return { data: data ? data.reverse() : [] }
}

// 2. ПОМЕТКА ПРОЧИТАННЫМ (Mark as Read)
export async function markAsReadAction(partnerId: string) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', partnerId)
        .eq('receiver_id', user.id)
        .eq('is_read', false)
}

// 3. РЕДАКТИРОВАНИЕ (Edit)
export async function editMessageAction(messageId: string, newContent: string) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('messages')
        .update({ content: newContent })
        .eq('id', messageId)
        .eq('sender_id', user.id) // Важно: проверяем, что это мое сообщение

    if (error) return { error: 'Update failed' }
    return { success: true }
}

// 4. УДАЛЕНИЕ (Delete) + Очистка файлов
export async function deleteMessageAction(messageId: string) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return { error: 'Unauthorized' }

    // Сначала получаем сообщение, чтобы узнать, есть ли файлы
    const { data: msg } = await supabase
        .from('messages')
        .select('file_url, file_urls, sender_id')
        .eq('id', messageId)
        .single()

    if (!msg || msg.sender_id !== user.id) return { error: 'Cannot delete' }

    // Удаляем файлы из Storage (Серверная операция!)
    const allUrls = (msg.file_urls && msg.file_urls.length > 0) 
        ? msg.file_urls 
        : (msg.file_url ? [msg.file_url] : [])

    if (allUrls.length > 0) {
        const paths = allUrls.map(u => u.split('/').pop()).filter(Boolean) as string[]
        if (paths.length > 0) {
            await supabase.storage.from('chat-attachments').remove(paths)
        }
    }

    // Удаляем запись из БД
    const { error } = await supabase.from('messages').delete().eq('id', messageId)

    if (error) return { error: 'Delete failed' }
    return { success: true }
}

// --- Helper для создания клиента (чтобы не дублировать код) ---
async function createServerSupabaseClient() {
    const cookieStore = await cookies()
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
            },
        }
    )
}