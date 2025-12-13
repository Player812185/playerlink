'use client'
import Link from 'next/link'

export default function AuthError() {
    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
            <h1 className="text-2xl font-bold text-red-500">Ошибка входа</h1>
            <p>Не удалось авторизоваться через Google.</p>
            <Link href="/login" className="bg-blue-500 text-white px-4 py-2 rounded">
                Попробовать снова
            </Link>
        </div>
    )
}