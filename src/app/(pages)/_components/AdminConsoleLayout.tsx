"use client"

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { ChevronDown, LayoutGrid, List } from "lucide-react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { cn } from "@/lib/utils"
import { signOut } from "next-auth/react"
import type { ConsoleAreaId, ConsoleMenuPolicy } from "@/lib/consoleMenuAccess/types"
import { canConsoleMenuRead, canConsoleMenuWrite } from "@/lib/consoleMenuAccess/client"
import { useConsoleMenuAccess } from "@/hooks/useConsoleMenuAccess"
import {
  ConsoleMenuAccessContext,
} from "@/app/(pages)/_components/ConsoleMenuAccessContext"
import { ConsoleMenuAccessDeniedDialog } from "@/app/(pages)/_components/ConsoleMenuAccessDeniedDialog"

export type AdminConsoleMenuItem = { id: string; label: string }
export type AdminConsoleMenuGroup = {
  id: string
  label: string
  menuIds: readonly string[]
  /** 사이드 메뉴 접힘 상태에서 표시할 아이콘 */
  icon?: ComponentType<{ className?: string }>
}

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
  /** 카드 제목 행 우측 액션 (예: 이력 버튼) */
  renderHeaderActions?: (menuId: string) => ReactNode
  onLogout?: () => void | Promise<void>
  /** 설정 시 서브메뉴별 console:{area}:{menuId} 권한 적용 */
  consoleArea?: ConsoleAreaId
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
  renderHeaderActions,
  onLogout,
  consoleArea,
}: AdminConsoleLayoutProps) {
  const { getPolicy, loading: accessLoading } = useConsoleMenuAccess()
  const [deniedOpen, setDeniedOpen] = useState(false)
  const [deniedMenuId, setDeniedMenuId] = useState<string>("")

  const resolvePolicy = (menuId: string): ConsoleMenuPolicy => {
    if (!consoleArea) return "write"
    return getPolicy(consoleArea, menuId)
  }

  const visibleMenuIds = useMemo(() => {
    if (!consoleArea) return menus.map((m) => m.id)
    return menus.filter((m) => resolvePolicy(m.id) !== "hidden").map((m) => m.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getPolicy(levels) drives visibility
  }, [consoleArea, menus, getPolicy])

  const pickDefaultMenu = (preferred: string): string => {
    if (visibleMenuIds.includes(preferred)) return preferred
    const readable = visibleMenuIds.find((id) => {
      const p = resolvePolicy(id)
      return p === "read" || p === "write"
    })
    if (readable) return readable
    const blockable = visibleMenuIds.find((id) => resolvePolicy(id) === "block")
    if (blockable) return blockable
    return visibleMenuIds[0] ?? preferred
  }

  const validDefault = pickDefaultMenu(
    menus.some((m) => m.id === defaultMenuId) ? defaultMenuId : menus[0]?.id ?? ""
  )
  const [selectedMenu, setSelectedMenu] = useState(validDefault)
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>(() => {
    const first = menuGroups?.[0]?.id ?? null
    return first ? [first] : []
  })
  const expandedGroupStorageKey = stateStorageKey ? `${stateStorageKey}:expandedGroupIds` : null
  const selectedMenuStorageKey = stateStorageKey ? `${stateStorageKey}:selectedMenu` : null
  const collapsedStorageKey = stateStorageKey ? `${stateStorageKey}:sidebarCollapsed` : null
  const [collapsed, setCollapsed] = useState(false)

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

  useEffect(() => {
    if (!collapsedStorageKey || typeof window === "undefined") return
    const saved = window.localStorage.getItem(collapsedStorageKey)
    if (saved !== null) setCollapsed(saved === "1")
  }, [collapsedStorageKey])

  useEffect(() => {
    if (!collapsedStorageKey || typeof window === "undefined") return
    window.localStorage.setItem(collapsedStorageKey, collapsed ? "1" : "0")
  }, [collapsed, collapsedStorageKey])

  useEffect(() => {
    if (accessLoading || !consoleArea) return
    const policy = resolvePolicy(selectedMenu)
    if (policy === "hidden") {
      setSelectedMenu(pickDefaultMenu(selectedMenu))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, consoleArea, selectedMenu, visibleMenuIds.join("|")])

  const currentPolicy = resolvePolicy(selectedMenu)
  const contextValue = useMemo(
    () => ({
      area: consoleArea ?? null,
      menuId: selectedMenu,
      policy: currentPolicy,
      canRead: canConsoleMenuRead(currentPolicy),
      canWrite: canConsoleMenuWrite(currentPolicy),
      loading: accessLoading,
    }),
    [consoleArea, selectedMenu, currentPolicy, accessLoading]
  )

  const handleMenuClick = (menuId: string) => {
    const policy = resolvePolicy(menuId)
    if (policy === "block") {
      setDeniedMenuId(menuId)
      setDeniedOpen(true)
      return
    }
    if (policy === "hidden") return
    setSelectedMenu(menuId)
  }

  const handleLogout = async () => {
    if (onLogout) await onLogout()
    else await signOut({ redirect: false })
  }

  const renderCollapsedIconRail = () => {
    if (!menuGroups || menuGroups.length === 0) {
      return (
        <div className="flex flex-col items-center gap-1 pt-2 px-1">
          {menus.map((menu) => {
            if (consoleArea && resolvePolicy(menu.id) === "hidden") return null
            const policy = resolvePolicy(menu.id)
            const isBlock = policy === "block"
            return (
              <button
                key={menu.id}
                type="button"
                title={menu.label}
                onClick={() => handleMenuClick(menu.id)}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-md text-[10px] font-semibold transition-colors",
                  selectedMenu === menu.id && !isBlock
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {menu.label.slice(0, 2)}
              </button>
            )
          })}
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-1 pt-2">
        {menuGroups.map((group) => {
          const visibleGroupMenuIds = group.menuIds.filter((id) => visibleMenuIds.includes(id))
          if (visibleGroupMenuIds.length === 0) return null
          const Icon = group.icon
          const isActiveGroup = group.menuIds.includes(selectedMenu)
          return (
            <div key={group.id} className="group/navicon relative w-full flex justify-center">
              <button
                type="button"
                title={group.label}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
                  isActiveGroup
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {Icon ? (
                  <Icon className="h-4 w-4" />
                ) : (
                  <span className="text-[10px] font-semibold">{group.label.slice(0, 2)}</span>
                )}
              </button>
              <div
                className={cn(
                  "absolute left-full top-0 z-50 -ml-1.5",
                  "invisible opacity-0 group-hover/navicon:visible group-hover/navicon:opacity-100",
                  "transition-opacity"
                )}
              >
                <div className="min-w-40 rounded-md border bg-popover shadow-md py-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground border-b mb-1 whitespace-nowrap">
                  {group.label}
                </div>
                {visibleGroupMenuIds.map((menuId) => {
                  const menu = menuById.get(menuId)
                  if (!menu) return null
                  const policy = resolvePolicy(menu.id)
                  const isBlock = policy === "block"
                  return (
                    <button
                      key={menu.id}
                      type="button"
                      onClick={() => handleMenuClick(menu.id)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                        selectedMenu === menu.id && !isBlock
                          ? "bg-primary text-primary-foreground"
                          : isBlock
                            ? "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {menu.label}
                    </button>
                  )
                })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const renderSidebarToggle = (compact = false) => {
    const ToggleIcon = collapsed ? LayoutGrid : List

    return (
    <div className={cn("shrink-0 border-t pt-2", compact ? "flex justify-center px-1 pb-2" : "px-2 pb-2")}>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={cn(compact ? "h-8 w-8 rounded-none" : "w-full justify-start rounded-none")}
        onClick={() => setCollapsed((prev) => !prev)}
        title={collapsed ? "아이콘 메뉴" : "전체 메뉴"}
      >
        <ToggleIcon className="h-3.5 w-3.5" />
        {!compact ? (collapsed ? "아이콘 메뉴" : "전체 메뉴") : null}
      </Button>
    </div>
    )
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

      <div className="flex flex-1 min-h-0 overflow-visible">
        {collapsed ? (
          <aside className="shrink-0 w-12 border-r bg-muted/30 flex flex-col min-h-0 overflow-visible">
            <div className="flex-1 min-h-0 overflow-x-visible py-2">
              {renderCollapsedIconRail()}
            </div>
            {renderSidebarToggle(true)}
          </aside>
        ) : (
        <aside className="shrink-0 border-r bg-muted/30 flex flex-col w-64 min-h-0">
          <div className="flex-1 min-h-0 overflow-auto py-2">
          {menuGroups && menuGroups.length > 0 ? (
            menuGroups.map((group) => {
              const visibleGroupMenuIds = group.menuIds.filter((id) => visibleMenuIds.includes(id))
              if (visibleGroupMenuIds.length === 0) return null
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
                      {visibleGroupMenuIds.map((menuId) => {
                        const menu = menuById.get(menuId)
                        if (!menu) return null
                        const policy = resolvePolicy(menu.id)
                        const isBlock = policy === "block"
                        return (
                          <button
                            key={menu.id}
                            type="button"
                            onClick={() => handleMenuClick(menu.id)}
                            className={cn(
                              "w-full text-left px-6 py-2 text-sm font-medium transition-colors",
                              selectedMenu === menu.id && !isBlock
                                ? "bg-primary text-primary-foreground"
                                : isBlock
                                  ? "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
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
            menus.map((menu) => {
              if (consoleArea && resolvePolicy(menu.id) === "hidden") return null
              const policy = resolvePolicy(menu.id)
              const isBlock = policy === "block"
              return (
                <button
                  key={menu.id}
                  type="button"
                  onClick={() => handleMenuClick(menu.id)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-sm font-medium transition-colors",
                    selectedMenu === menu.id && !isBlock
                      ? "bg-primary text-primary-foreground"
                      : isBlock
                        ? "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {menu.label}
                </button>
              )
            })
          )}
          </div>
          {renderSidebarToggle()}
        </aside>
        )}

        <main className="flex-1 overflow-auto p-4">
          <Card className="rounded-none min-h-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <CardTitle>{currentLabel}</CardTitle>
                  {renderTitleExtra?.(selectedMenu)}
                </div>
                {renderHeaderActions?.(selectedMenu)}
              </div>
              <CardDescription>{getDescription(selectedMenu)}</CardDescription>
            </CardHeader>
            <CardContent>
              {consoleArea && accessLoading ? (
                <p className="text-sm text-muted-foreground py-4">권한 정보를 불러오는 중…</p>
              ) : consoleArea && currentPolicy === "block" ? (
                <p className="text-sm text-muted-foreground py-4">
                  선택한 메뉴에 대한 접근 권한이 없습니다. 사이드바에서 메뉴를 선택하세요.
                </p>
              ) : (
                <ConsoleMenuAccessContext.Provider value={contextValue}>
                  <fieldset
                    disabled={currentPolicy === "read"}
                    className="min-w-0 border-0 p-0 m-0 disabled:opacity-100 [&_button:not([type='button'])]:disabled:opacity-60"
                  >
                    {currentPolicy === "read" ? (
                      <p className="mb-3 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-200 px-3 py-2 rounded border border-amber-200 dark:border-amber-800">
                        읽기 권한만 있습니다. 저장·추가·삭제는 할 수 없습니다.
                      </p>
                    ) : null}
                    {renderContent(selectedMenu)}
                  </fieldset>
                </ConsoleMenuAccessContext.Provider>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
      {consoleArea ? (
        <ConsoleMenuAccessDeniedDialog
          open={deniedOpen}
          onOpenChange={setDeniedOpen}
          area={consoleArea}
          menuId={deniedMenuId}
        />
      ) : null}
    </div>
  )
}
