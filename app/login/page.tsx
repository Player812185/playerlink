'use client'
import { supabase } from '@/utils/supabase'
import { useState } from 'react'
import { toast } from 'sonner'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
  }

  const handleAuth = async () => {
    setLoading(true)
    if (isRegistering) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: email.split('@')[0], avatar_url: '' } }
      })
      if (error) toast.error(error.message)
      else toast.info('Проверьте почту!')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) toast.error(error.message)
      else location.href = '/'
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0b0e14] text-white p-4 font-sans">
      <div className="w-full max-w-sm">

        <div className="bg-[#151a23] p-8 rounded-3xl border border-white/5 shadow-2xl flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-1">Playerlink</h1>
            <p className="text-gray-500 text-sm">
              {isRegistering ? 'Создание аккаунта' : 'Добро пожаловать'}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 ml-1">Email</label>
              <input
                className="w-full bg-[#0b0e14] border border-white/5 p-3 rounded-xl focus:outline-none focus:border-blue-600 transition text-white placeholder-gray-600"
                placeholder="name@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 ml-1">Пароль</label>
              <input
                className="w-full bg-[#0b0e14] border border-white/5 p-3 rounded-xl focus:outline-none focus:border-blue-600 transition text-white placeholder-gray-600"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              />
            </div>
          </div>

          <button
            onClick={handleAuth}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold p-3.5 rounded-xl transition shadow-lg shadow-blue-900/20"
          >
            {loading ? 'Загрузка...' : (isRegistering ? 'Создать аккаунт' : 'Войти')}
          </button>

          <div className="flex items-center gap-4 my-1">
            <div className="h-px bg-white/5 flex-grow"></div>
            <span className="text-xs text-gray-600 uppercase">Или</span>
            <div className="h-px bg-white/5 flex-grow"></div>
          </div>

          <button onClick={handleGoogleLogin} className="w-full bg-[#0b0e14] border border-white/10 hover:border-white/20 text-white font-medium p-3 rounded-xl flex items-center justify-center gap-2 transition">
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
            Google
          </button>

          <div className="text-center text-sm">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-gray-500 hover:text-white transition"
            >
              {isRegistering ? 'Вернуться ко входу' : 'Нет аккаунта? Регистрация'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}