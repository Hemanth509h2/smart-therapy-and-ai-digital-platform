'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggle: () => {},
})

export const useTheme = () => useContext(ThemeContext)

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  // The STAAD design system keys off `data-theme` on <html>; the older pages key
  // off the `dark` class. Both are applied so either styling layer works.
  const apply = (t: Theme) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
    document.documentElement.setAttribute('data-theme', t)
  }

  useEffect(() => {
    let stored: Theme | null = null
    try {
      stored = localStorage.getItem('staad-theme') as Theme | null
    } catch {}
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initial = stored || (prefersDark ? 'dark' : 'light')
    setTheme(initial)
    apply(initial)
    setMounted(true)
  }, [])

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try {
      localStorage.setItem('staad-theme', next)
    } catch {}
    apply(next)
  }

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
