"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

type Theme = "dark" | "light" | "system"

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: "dark" | "light"
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  }
  return theme
}

/** html class·localStorage를 클릭 시점(동기)에 반영 — useEffect 지연으로 테마가 늦게 바뀌는 것 방지 */
function applyDomTheme(theme: Theme): "dark" | "light" {
  const root = window.document.documentElement
  const resolved = resolveTheme(theme)
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  try {
    localStorage.setItem("theme", theme)
  } catch {
    /* ignore */
  }
  return resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("light")

  const setTheme = useCallback((next: Theme) => {
    const resolved = applyDomTheme(next)
    setThemeState(next)
    setResolvedTheme(resolved)
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null
    const initial = stored ?? "system"
    const resolved = applyDomTheme(initial)
    setThemeState(initial)
    setResolvedTheme(resolved)

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onSystemChange = () => {
      const current = (localStorage.getItem("theme") as Theme | null) ?? "system"
      if (current !== "system") return
      const nextResolved = applyDomTheme("system")
      setResolvedTheme(nextResolved)
    }
    mq.addEventListener("change", onSystemChange)
    return () => mq.removeEventListener("change", onSystemChange)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

/** Provider 밖·SSR/HMR 경계에서도 안전. 없으면 light */
export function useResolvedThemeSafe(): "dark" | "light" {
  const context = useContext(ThemeContext)
  return context?.resolvedTheme ?? "light"
}
