import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    // Проверка переменных
    const APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
    const API_KEY = process.env.ONESIGNAL_REST_API_KEY

    if (!APP_ID || !API_KEY) {
        return NextResponse.json({ error: 'Server config error: Missing keys' }, { status: 500 })
    }

    const { receiverId, message, senderName } = await request.json()

    const options = {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            Authorization: `Basic ${API_KEY}` // <--- БЕРЕМ ИЗ ENV
        },
        body: JSON.stringify({
            app_id: APP_ID, // <--- БЕРЕМ ИЗ ENV
            include_aliases: { external_id: [receiverId] },
            target_channel: "push",
            contents: { en: message },
            headings: { en: `Новое сообщение от ${senderName}` },
            // Ссылка должна вести на продакшн, если мы не на локалке
            url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/messages`
        })
    }

    try {
        const response = await fetch('https://onesignal.com/api/v1/notifications', options)
        const data = await response.json()
        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json({ error: 'Failed to send push' }, { status: 500 })
    }
}