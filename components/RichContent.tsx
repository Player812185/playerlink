'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Link from 'next/link'

export function RichContent({ content }: { content: string }) {
    // 1. Обрабатываем упоминания (превращаем в markdown ссылку)
    // Мы используем хитрый трюк: делаем ссылку вида /u/@username
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
                        // Если ссылка начинается с /u/ (наша внутренняя)
                        if (href?.startsWith('/u/')) {
                            return (
                                <Link href={href} className="text-primary font-bold bg-primary/10 px-1 rounded hover:bg-primary/20 transition">
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