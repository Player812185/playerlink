'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from 'next/link'

// Функция для превращения @ник в markdown-ссылку перед рендером
const processMentions = (text: string) => {
    // Находит @word и заменяет на [@word](/u/profile_id_placeholder)
    // У нас нет ID пользователя здесь, поэтому мы будем искать по username.
    // Но так как у нас роутинг по ID (/u/id), это сложно.
    // ПРОСТОЙ ВАРИАНТ: Ссылка будет вести на поиск или мы просто подсветим ник.
    // ЛУЧШИЙ ВАРИАНТ для MVP: Предположим, что ссылка выглядит как /u/username (если переделаем роутинг)
    // ИЛИ просто сделаем визуальное выделение.

    // Давай сделаем так: @username -> ссылка на /search?q=username (или просто стиль)
    return text.replace(/@(\w+)/g, '[@$1](/u/$1)')
    // Примечание: В реальном app нужен ID, но пока оставим так, клик будет вести на страницу, 
    // где в URL будет username. Нам придется подправить страницу профиля, чтобы она понимала username, 
    // либо оставить это просто как визуальную фичу.
}

export function RichContent({ content }: { content: string }) {
    // 1. Обрабатываем упоминания (превращаем в markdown ссылку)
    // Мы используем хитрый трюк: делаем ссылку вида /u/@username
    const processedContent = content.replace(
        /@([a-zA-Z0-9_]+)/g,
        '[@$1](/u/@$1)'
    )

    return (
        <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ node, href, children, ...props }) => {
                        // Если это упоминание (начинается с /u/@)
                        if (href?.startsWith('/u/@')) {
                            const username = href.replace('/u/@', '')
                            // Здесь мы просто возвращаем красивый span, так как у нас нет ID юзера для ссылки
                            // Либо можно сделать ссылку на поиск
                            return (
                                <span className="text-primary font-bold bg-primary/10 px-1 rounded cursor-pointer hover:bg-primary/20 transition">
                                    @{username}
                                </span>
                            )
                        }
                        // Обычная ссылка
                        return (
                            <a href={href} className="text-blue-500 hover:underline break-all" target="_blank" rel="noopener noreferrer" {...props}>
                                {children}
                            </a>
                        )
                    },
                    // Стилизация цитат
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic bg-muted/30 py-1 my-2 rounded-r" {...props} />
                    ),
                    // Стилизация кода
                    code: ({ node, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '')
                        return (
                            <code className={`${className} bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-red-400`} {...props}>
                                {children}
                            </code>
                        )
                    }
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    )
}