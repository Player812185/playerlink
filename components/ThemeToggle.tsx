"use client"

import { useTheme } from "next-themes"
import { Moon, Sun, Monitor } from "lucide-react"
import { useEffect, useState } from "react"

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    // Ждем загрузки на клиенте, чтобы избежать ошибок гидратации
    useEffect(() => setMounted(true), [])

    if (!mounted) return null

    return (
        <div className="flex bg-muted/50 p-1 rounded-full border border-border">
            <button
                onClick={() => setTheme("light")}
                className={`p-2 rounded-full transition-all ${theme === 'light' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
                <Sun size={18} />
            </button>
            <button
                onClick={() => setTheme("system")}
                className={`p-2 rounded-full transition-all ${theme === 'system' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
                <Monitor size={18} />
            </button>
            <button
                onClick={() => setTheme("dark")}
                className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
                <Moon size={18} />
            </button>
        </div>
    )
}