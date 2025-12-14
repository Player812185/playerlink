'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from 'next/link'

export function RichContent({ content }: { content: string }) {
    // 1. Ищем @username (латиница, цифры, подчеркивание).
    // Если ваши юзернеймы поддерживают кириллицу, используйте /@([\p{L}\p{N}_]+)/gu
    // Но обычно юзернеймы технические (латиница).
    const processedContent = content.replace(
        /@([a-zA-Z0-9_]+)/g,
        '[@$1](/u/$1)'
    )

    return (
        <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ node, href, children, ...props }) => {
                        // Обработка внутренних ссылок на профиль
                        if (href?.startsWith('/u/')) {
                            return (
                                <Link
                                    href={href}
                                    className="text-primary font-bold bg-primary/10 px-1 rounded hover:bg-primary/20 transition no-underline"
                                >
                                    {children}
                                </Link>
                            )
                        }
                        // Внешние ссылки
                        return (
                            <a href={href} className="text-blue-500 hover:underline break-all" target="_blank" rel="noopener noreferrer" {...props}>
                                {children}
                            </a>
                        )
                    },
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic bg-muted/30 py-1 my-2 rounded-r" {...props} />
                    ),
                    code: ({ node, className, children, ...props }: any) => {
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