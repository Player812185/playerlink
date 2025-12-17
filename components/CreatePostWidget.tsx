'use client'
import { useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { createPostAction } from '@/app/actions/feed'
import { Send, Paperclip, X, Loader2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
    onPostCreated: () => void
}

export function CreatePostWidget({ onPostCreated }: Props) {
    const [content, setContent] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [isFocused, setIsFocused] = useState(false) // Для анимации фокуса
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
        <div className={`bg-card p-4 rounded-3xl border transition-all duration-300 ${isFocused ? 'border-primary/40 shadow-lg ring-4 ring-primary/5' : 'border-border shadow-sm'}`}>
            <div className="flex gap-3 items-start">
                <div className="flex-grow space-y-3">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onPaste={handlePaste}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder="Что нового?"
                        className="w-full bg-transparent text-foreground p-1 min-h-[50px] resize-none focus:outline-none placeholder-muted-foreground text-lg leading-relaxed"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                        disabled={loading}
                    />

                    {previewUrl && (
                        <div className="relative inline-block group animate-in fade-in zoom-in duration-200">
                            <img src={previewUrl} className="h-32 w-auto rounded-2xl border border-border object-cover" />
                            <button onClick={clearFile} className="absolute -top-2 -right-2 bg-black/50 backdrop-blur text-white p-1.5 rounded-full hover:bg-red-500 transition">
                                <X size={14} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex justify-between items-center mt-3 pt-3 border-t border-border/50">
                <label className="text-primary hover:bg-primary/10 p-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 text-sm font-medium">
                    <ImageIcon size={20} />
                    <span className="hidden sm:inline">Фото</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} ref={fileInputRef} />
                </label>

                <button
                    onClick={handleSubmit}
                    disabled={loading || (!content.trim() && !file)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                >
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <>Опубликовать <Send size={16} /></>}
                </button>
            </div>
        </div>
    )
}