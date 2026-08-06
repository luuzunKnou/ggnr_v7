"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { useTheme } from "./theme-provider"

type ThemeToggleProps = {
  variant?: "default" | "mapIcon"
  /** variant=mapIcon 일 때 버튼 외곽 class (검색바 공통 스타일) */
  iconBtnClassName?: string
}

function ThemeIcon({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme()
  const iconClass = cn("block", className)

  if (resolvedTheme === "dark") {
    return (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    )
  }

  return (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  )
}

export function ThemeToggle({ variant = "default", iconBtnClassName }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  if (variant === "mapIcon") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={cn(iconBtnClassName, "flex items-center justify-center")}
        aria-label="테마 변경"
        title="테마 변경"
      >
        <span className="flex shrink-0 items-center justify-center leading-none">
          <ThemeIcon className="h-5 w-5" />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors rounded-[5px] cursor-pointer"
      aria-label="테마 변경"
      title="테마 변경"
    >
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center">
        <ThemeIcon className="h-4.5 w-4.5" />
      </span>
      <span className="text-[13px] leading-none mr-1">테마변경</span>
    </button>
  )
}
