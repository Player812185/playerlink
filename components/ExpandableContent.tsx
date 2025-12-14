'use client'
import { useState } from 'react'
import { RichContent } from './RichContent'

interface Props {
    content: string
}

export function ExpandableContent({ content }: Props) {
    const [isExpanded, setIsExpanded] = useState(false)

    // Порог срабатывания (например, 300 символов или 4 переноса строки)
    const isLongText = content.length > 300 || content.split('\n').length > 4

    // Если текст короткий, просто показываем его
    if (!isLongText) {
        return <RichContent content={content} />
    }

    return (
        <div className="relative">
            <div
                className={`transition-all duration-300 ${isExpanded ? '' : 'max-h-[120px] overflow-hidden mask-fade-bottom'
                    }`}
            >
                <RichContent content={content} />
            </div>

            <button
                onClick={(e) => {
                    e.preventDefault() // Чтобы не кликалось по ссылке поста, если она есть
                    setIsExpanded(!isExpanded)
                }}
                className="mt-2 text-sm font-bold text-primary hover:underline focus:outline-none"
            >
                {isExpanded ? 'Свернуть' : 'Читать полностью...'}
            </button>
        </div>
    )
}