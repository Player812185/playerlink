'use client'
import { useState, useRef } from 'react'
import { supabase } from '@/utils/supabase' // Клиент для загрузки файлов
import { createPostAction } from '@/app/actions/feed' // Твой Server Action
import { Send, Paperclip, X, Image as ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
    onPostCreated: () => void
}

export function CreatePostWidget({ onPostCreated }: Props) {
    const [content, setContent] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // --- ЛОГИКА ВСТАВКИ ИЗ БУФЕРА (PASTE) ---
    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const blob = item.getAsFile()
                if (blob) {
                    processFile(blob)
                    e.preventDefault() // Чтобы не вставлялось имя файла текстом
                }
            }
        }
    }
    // ----------------------------------------

    const processFile = (selectedFile: File) => {
        setFile(selectedFile)
        setPreviewUrl(URL.createObjectURL(selectedFile))
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) processFile(e.target.files[0])
    }

    const clearFile = () => {
        setFile(null)
        setPreviewUrl(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleSubmit = async () => {
        if (!content.trim() && !file) return

        setLoading(true)
        let uploadedImageUrl = null

        // 1. Загрузка файла (Client-side, так быстрее и меньше нагрузки на сервер Next.js)
        if (file) {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const fileExt = file.name.split('.').pop() || 'png'
                const fileName = `${user.id}-${Date.now()}.${fileExt}`
                const { error } = await supabase.storage.from('post-images').upload(fileName, file)

                if (error) {
                    toast.error('Ошибка загрузки картинки')
                    setLoading(false)
                    return
                }
                const { data } = supabase.storage.from('post-images').getPublicUrl(fileName)
                uploadedImageUrl = data.publicUrl
            }
        }

        // 2. Создание поста (Server Action)
        const res = await createPostAction(content, uploadedImageUrl)

        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success('Опубликовано!')
            setContent('')
            clearFile()
            onPostCreated() // Обновляем список в родителе
        }
        setLoading(false)
    }

    return (
        <div className="mb-6 bg-card p-4 rounded-3xl border border-border shadow-sm">
            <div className="flex gap-3 items-start">
                <div className="flex-grow space-y-3">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onPaste={handlePaste} // <--- СЛУШАЕМ ВСТАВКУ
                        placeholder="Что нового? (Можно вставить картинку Ctrl+V)"
                        className="w-full bg-transparent text-foreground p-2 min-h-[80px] resize-none focus:outline-none placeholder-muted-foreground"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                        disabled={loading}
                    />

                    {/* Превью картинки */}
                    {previewUrl && (
                        <div className="relative inline-block group">
                            <img src={previewUrl} className="h-24 w-auto rounded-xl border border-border object-cover" />
                            <button onClick={clearFile} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md hover:bg-red-600 transition">
                                <X size={12} />
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={handleSubmit}
                        disabled={loading || (!content.trim() && !file)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground p-4 rounded-2xl transition shadow-lg shadow-primary/20 flex items-center justify-center aspect-square disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
                    </button>

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
    )
}