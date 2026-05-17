"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { cn } from "@/lib/utils"
import { signOut } from "next-auth/react"

export type AdminConsoleMenuItem = { id: string; label: string }
export type AdminConsoleMenuGroup = { id: string; label: string; menuIds: readonly string[] }

type AdminConsoleLayoutProps = {
  title: string
  menus: readonly AdminConsoleMenuItem[]
  menuGroups?: readonly AdminConsoleMenuGroup[]
  stateStorageKey?: string
  defaultMenuId: string
  getDescription: (menuId: string) => string
  renderContent: (menuId: string) => ReactNode
  /** 카드 제목 옆 보조 UI (예: 개발자 모드 LAS 샘플 버튼) */
  renderTitleExtra?: (menuId: string) => ReactNode
  onLogout?: () => void | Promise<void>
}

export function AdminConsoleLayout({
  title,
  menus,
  menuGroups,
  stateStorageKey,
  defaultMenuId,
  getDescription,
  renderContent,
  renderTitleExtra,
  onLogout,
}: AdminConsoleLayoutProps) {
  const validDefault = menus.some((m) => m.id === defaultMenuId) ? defaultMenuId : menus[0]?.id ?? ""
  const [selectedMenu, setSelectedMenu] = useState(validDefault)
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>(() => {
    const first = menuGroups?.[0]?.id ?? null
    return first ? [first] : []
  })
  const expandedGroupStorageKey = stateStorageKey ? `${stateStorageKey}:expandedGroupIds` : null
  const selectedMenuStorageKey = stateStorageKey ? `${stateStorageKey}:selectedMenu` : null

  const currentLabel = menus.find((m) => m.id === selectedMenu)?.label ?? selectedMenu
  const menuById = new Map(menus.map((m) => [m.id, m]))

  useEffect(() => {
    if (!selectedMenuStorageKey || typeof window === "undefined") return
    const savedMenu = window.localStorage.getItem(selectedMenuStorageKey)
    if (savedMenu && menus.some((menu) => menu.id === savedMenu)) {
      setSelectedMenu(savedMenu)
    }
  }, [menus, selectedMenuStorageKey])

  useEffect(() => {
    if (!selectedMenuStorageKey || typeof window === "undefined") return
    if (!selectedMenu) return
    window.localStorage.setItem(selectedMenuStorageKey, selectedMenu)
  }, [selectedMenu, selectedMenuStorageKey])

  useEffect(() => {
    if (!menuGroups || menuGroups.length === 0) return
    if (!expandedGroupStorageKey || typeof window === "undefined") return

    const saved = window.localStorage.getItem(expandedGroupStorageKey)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as unknown
        if (Array.isArray(parsed)) {
          const validIds = parsed
            .filter((value): value is string => typeof value === "string")
            .filter((id) => menuGroups.some((group) => group.id === id))
          setExpandedGroupIds(validIds)
          return
        }
      } catch {
        // Backward compatibility: older value was a single group id string.
        if (menuGroups.some((group) => group.id === saved)) {
          setExpandedGroupIds([saved])
          return
        }
        if (saved === "") {
          setExpandedGroupIds([])
          return
        }
      }
    }
  }, [menuGroups, expandedGroupStorageKey])

  useEffect(() => {
    if (!menuGroups || menuGroups.length === 0) return
    if (!expandedGroupStorageKey || typeof window === "undefined") return
    window.localStorage.setItem(expandedGroupStorageKey, JSON.stringify(expandedGroupIds))
  }, [expandedGroupIds, menuGroups, expandedGroupStorageKey])

  const handleLogout = async () => {
    if (onLogout) await onLogout()
    else await signOut({ redirect: false })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" className="rounded-none" onClick={() => void handleLogout()}>
            로그아웃
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-none">
            <Link href="/">메인으로</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-64 shrink-0 border-r bg-muted/30 flex flex-col py-2 overflow-auto">
          {menuGroups && menuGroups.length > 0 ? (
            menuGroups.map((group) => {
              const isOpen = expandedGroupIds.includes(group.id)
              return (
                <div key={group.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors flex items-center justify-between gap-2",
                      isOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                    onClick={() =>
                      setExpandedGroupIds((prev) =>
                        prev.includes(group.id) ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                      )
                    }
                  >
                    <span>{group.label}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen ? "rotate-180" : "rotate-0")} />
                  </button>
                  {isOpen && (
                    <div className="py-1">
                      {group.menuIds.map((menuId) => {
                        const menu = menuById.get(menuId)
                        if (!menu) return null
                        return (
                          <button
                            key={menu.id}
                            type="button"
                            onClick={() => setSelectedMenu(menu.id)}
                            className={cn(
                              "w-full text-left px-6 py-2 text-sm font-medium transition-colors",
                              selectedMenu === menu.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {menu.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            menus.map((menu) => (
              <button
                key={menu.id}
                type="button"
                onClick={() => setSelectedMenu(menu.id)}
                className={cn(
                  "w-full text-left px-4 py-2.5 text-sm font-medium transition-colors",
                  selectedMenu === menu.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {menu.label}
              </button>
            ))
          )}
        </aside>

        <main className="flex-1 overflow-auto p-4">
          <Card className="rounded-none min-h-full">
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle>{currentLabel}</CardTitle>
                {renderTitleExtra?.(selectedMenu)}
              </div>
              <CardDescription>{getDescription(selectedMenu)}</CardDescription>
            </CardHeader>
            <CardContent>{renderContent(selectedMenu)}</CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
