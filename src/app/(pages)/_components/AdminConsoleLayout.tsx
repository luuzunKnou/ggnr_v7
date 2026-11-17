"use client"

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { ChevronDown, LayoutGrid, List } from "lucide-react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { cn } from "@/lib/utils"
import { withBasePath } from "@/lib/basePath"
import { signOut } from "next-auth/react"
import type { ConsoleAreaId, ConsoleMenuPolicy } from "@/lib/consoleMenuAccess/types"
import { canConsoleMenuRead, canConsoleMenuWrite } from "@/lib/consoleMenuAccess/client"
import { useConsoleMenuAccess } from "@/hooks/useConsoleMenuAccess"
import {
  ConsoleMenuAccessContext,
} from "@/app/(pages)/_components/ConsoleMenuAccessContext"
import { ConsoleMenuAccessDeniedDialog } from "@/app/(pages)/_components/ConsoleMenuAccessDeniedDialog"

export type AdminConsoleMenuItem = {
  id: string
  label: string
  /** 단독·하위 메뉴 아이콘 (접힘·펼침 공통) */
  icon?: ComponentType<{ className?: string }>
}
export type AdminConsoleMenuGroup = {
  id: string
  label: string
  menuIds: readonly string[]
  /** 그룹 아이콘 (접힘·펼침 공통) */
  icon?: ComponentType<{ className?: string }>
}

type AdminConsoleLayoutProps = {
  title: string
  menus: readonly AdminConsoleMenuItem[]
  menuGroups?: readonly AdminConsoleMenuGroup[]
  /**
   * 그룹 헤더 없이 사이드바 상단에 단독 표시할 메뉴 id
   * (menuGroups와 함께 쓸 때, 해당 id는 그룹에도 넣지 않는 것을 권장)
   */
  ungroupedMenuIds?: readonly string[]
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
  /** 해당 메뉴 선택 시 사이드바를 아이콘 모드로 접음 (예: 레이어 관리) */
  autoCollapseMenuIds?: readonly string[]
  /** true면 그룹 메뉴를 처음부터 모두 펼침 (기본은 첫 그룹만) */
  defaultExpandAllGroups?: boolean
  /** 사이드바 접힘/펼침 토글 위치 (기본 하단) */
  sidebarTogglePlacement?: "top" | "bottom"
  /** 본문 외곽 — card(기본) | plain(카드·제목 헤더 없음) */
  contentChrome?: "card" | "plain"
  /** 사이드바 상단(접힘 토글 아래·메뉴 위) 추가 영역 */
  renderSidebarTop?: ReactNode | ((ctx: { collapsed: boolean }) => ReactNode)
  /** 사이드바 하단(메뉴 아래·하단 토글 위) 추가 영역 — 로그인/내 정보 등 */
  renderSidebarBottom?: ReactNode | ((ctx: { collapsed: boolean }) => ReactNode)
  /**
   * nonce가 바뀔 때 menuId로 선택 메뉴를 맞춤 (외부 radio 등).
   * 같은 menuId라도 nonce만 바꾸면 재적용됨.
   */
  selectMenuSignal?: { menuId: string; nonce: number } | null
  /** 루트 컨테이너 클래스 (기본 h-screen). 높이 유틸은 className이 있으면 그걸 씀 */
  className?: string
  /** aside+본문 행(relative) 위 오버레이 — 우측 하단 플로팅 모달 등 */
  renderBodyOverlay?: ReactNode
}

export function AdminConsoleLayout({
  title,
  menus,
  menuGroups,
  ungroupedMenuIds,
  stateStorageKey,
  defaultMenuId,
  getDescription,
  renderContent,
  renderTitleExtra,
  renderHeaderActions,
  onLogout,
  consoleArea,
  autoCollapseMenuIds,
  defaultExpandAllGroups = false,
  sidebarTogglePlacement = "bottom",
  contentChrome = "card",
  renderSidebarTop,
  renderSidebarBottom,
  selectMenuSignal = null,
  className,
  renderBodyOverlay,
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
  const expandedGroupStorageKey = stateStorageKey ? `${stateStorageKey}:expandedGroupIds` : null
  const selectedMenuStorageKey = stateStorageKey ? `${stateStorageKey}:selectedMenu` : null
  const collapsedStorageKey = stateStorageKey ? `${stateStorageKey}:sidebarCollapsed` : null

  const defaultExpandedGroupIds = (): string[] => {
    if (!menuGroups?.length) return []
    if (defaultExpandAllGroups) return menuGroups.map((g) => g.id)
    const first = menuGroups[0]?.id ?? null
    return first ? [first] : []
  }

  const ungroupedVisibleIds = useMemo(() => {
    const ids = ungroupedMenuIds ?? []
    return ids.filter((id) => visibleMenuIds.includes(id))
  }, [ungroupedMenuIds, visibleMenuIds])

  const renderFlatMenuButton = (menu: AdminConsoleMenuItem, indent = false) => {
    const policy = resolvePolicy(menu.id)
    const isBlock = policy === "block"
    const MenuIcon = menu.icon
    return (
      <button
        key={menu.id}
        type="button"
        onClick={() => handleMenuClick(menu.id)}
        className={cn(
          "flex w-full items-center gap-2 text-left text-sm font-medium transition-colors",
          indent ? "px-6 py-2" : "px-4 py-2.5",
          selectedMenu === menu.id && !isBlock
            ? "bg-primary text-primary-foreground"
            : isBlock
              ? "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {MenuIcon ? <MenuIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
        <span className="min-w-0 truncate">{menu.label}</span>
      </button>
    )
  }

  // SSR·클라 첫 렌더는 동일 기본값. localStorage는 마운트 후 복원 (hydration 불일치 방지).
  // 저장 effect는 storageReady 이후에만 동작해 기본값으로 저장값을 덮어쓰지 않음.
  const [selectedMenu, setSelectedMenu] = useState(validDefault)
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>(defaultExpandedGroupIds)
  const [collapsed, setCollapsed] = useState(false)
  const [storageReady, setStorageReady] = useState(!stateStorageKey)
  /** 축소 아이콘 레일 그룹 메뉴 — overflow에 잘리지 않도록 body 포털 + fixed */
  const [collapsedFlyout, setCollapsedFlyout] = useState<{
    groupId: string
    top: number
    left: number
  } | null>(null)
  const collapsedFlyoutCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCollapsedFlyoutTimer = () => {
    if (collapsedFlyoutCloseTimer.current) {
      clearTimeout(collapsedFlyoutCloseTimer.current)
      collapsedFlyoutCloseTimer.current = null
    }
  }

  const openCollapsedFlyout = (groupId: string, anchor: HTMLElement) => {
    clearCollapsedFlyoutTimer()
    const rect = anchor.getBoundingClientRect()
    setCollapsedFlyout({
      groupId,
      top: rect.top,
      left: rect.right - 6,
    })
  }

  const scheduleCloseCollapsedFlyout = () => {
    clearCollapsedFlyoutTimer()
    collapsedFlyoutCloseTimer.current = setTimeout(() => {
      setCollapsedFlyout(null)
      collapsedFlyoutCloseTimer.current = null
    }, 120)
  }

  useEffect(() => {
    return () => clearCollapsedFlyoutTimer()
  }, [])

  useEffect(() => {
    if (!collapsed) setCollapsedFlyout(null)
  }, [collapsed])

  useEffect(() => {
    if (!selectMenuSignal) return
    const { menuId } = selectMenuSignal
    if (!menus.some((m) => m.id === menuId)) return
    if (consoleArea && resolvePolicy(menuId) === "hidden") return
    setSelectedMenu(menuId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce로만 트리거
  }, [selectMenuSignal?.nonce])

  const currentLabel = menus.find((m) => m.id === selectedMenu)?.label ?? selectedMenu
  const menuById = new Map(menus.map((m) => [m.id, m]))

  useEffect(() => {
    if (!stateStorageKey) {
      setStorageReady(true)
      return
    }
    if (selectedMenuStorageKey) {
      const savedMenu = window.localStorage.getItem(selectedMenuStorageKey)
      if (savedMenu && menus.some((menu) => menu.id === savedMenu)) {
        setSelectedMenu(savedMenu)
      }
    }
    if (expandedGroupStorageKey && menuGroups?.length) {
      const saved = window.localStorage.getItem(expandedGroupStorageKey)
      const allIds = menuGroups.map((g) => g.id)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as unknown
          if (Array.isArray(parsed)) {
            const next = parsed
              .filter((value): value is string => typeof value === "string")
              .filter((id) => menuGroups.some((group) => group.id === id))
            setExpandedGroupIds(
              next.length > 0 ? next : defaultExpandAllGroups ? allIds : next
            )
          }
        } catch {
          // Backward compatibility: older value was a single group id string.
          if (menuGroups.some((group) => group.id === saved)) setExpandedGroupIds([saved])
          else if (saved === "") {
            setExpandedGroupIds(defaultExpandAllGroups ? allIds : [])
          }
        }
      } else if (defaultExpandAllGroups) {
        setExpandedGroupIds(allIds)
      }
    }
    if (collapsedStorageKey) {
      setCollapsed(window.localStorage.getItem(collapsedStorageKey) === "1")
    }
    setStorageReady(true)
    // mount 1회 복원만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!storageReady || !selectedMenuStorageKey) return
    if (!selectedMenu) return
    window.localStorage.setItem(selectedMenuStorageKey, selectedMenu)
  }, [selectedMenu, selectedMenuStorageKey, storageReady])

  useEffect(() => {
    if (!storageReady) return
    if (!menuGroups || menuGroups.length === 0) return
    if (!expandedGroupStorageKey) return
    window.localStorage.setItem(expandedGroupStorageKey, JSON.stringify(expandedGroupIds))
  }, [expandedGroupIds, menuGroups, expandedGroupStorageKey, storageReady])

  useEffect(() => {
    if (!storageReady || !collapsedStorageKey) return
    window.localStorage.setItem(collapsedStorageKey, collapsed ? "1" : "0")
  }, [collapsed, collapsedStorageKey, storageReady])

  useEffect(() => {
    if (!autoCollapseMenuIds?.length) return
    if (autoCollapseMenuIds.includes(selectedMenu)) {
      setCollapsed(true)
    }
  }, [selectedMenu, autoCollapseMenuIds])

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
      setCollapsedFlyout(null)
      return
    }
    if (policy === "hidden") return
    setCollapsedFlyout(null)
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
            const MenuIcon = menu.icon
            return (
              <button
                key={menu.id}
                type="button"
                title={menu.label}
                onClick={() => handleMenuClick(menu.id)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-semibold transition-colors",
                  selectedMenu === menu.id && !isBlock
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {MenuIcon ? (
                  <MenuIcon className="h-4 w-4" aria-hidden />
                ) : (
                  menu.label.slice(0, 2)
                )}
              </button>
            )
          })}
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-1 pt-2">
        {ungroupedVisibleIds.map((menuId) => {
          const menu = menuById.get(menuId)
          if (!menu) return null
          const policy = resolvePolicy(menu.id)
          const isBlock = policy === "block"
          const MenuIcon = menu.icon
          return (
            <button
              key={menu.id}
              type="button"
              title={menu.label}
              onClick={() => handleMenuClick(menu.id)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-semibold transition-colors",
                selectedMenu === menu.id && !isBlock
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {MenuIcon ? (
                <MenuIcon className="h-4 w-4" aria-hidden />
              ) : (
                menu.label.slice(0, 2)
              )}
            </button>
          )
        })}
        {menuGroups.map((group) => {
          const visibleGroupMenuIds = group.menuIds.filter((id) => visibleMenuIds.includes(id))
          if (visibleGroupMenuIds.length === 0) return null
          const Icon = group.icon
          const isActiveGroup = group.menuIds.includes(selectedMenu)
          const isFlyoutOpen = collapsedFlyout?.groupId === group.id
          return (
            <div
              key={group.id}
              className="relative flex w-full justify-center"
              onMouseEnter={(e) => openCollapsedFlyout(group.id, e.currentTarget)}
              onMouseLeave={scheduleCloseCollapsedFlyout}
              onFocus={(e) => openCollapsedFlyout(group.id, e.currentTarget)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  scheduleCloseCollapsedFlyout()
                }
              }}
            >
              <button
                type="button"
                title={group.label}
                aria-expanded={isFlyoutOpen}
                aria-haspopup="menu"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  isActiveGroup || isFlyoutOpen
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
            </div>
          )
        })}
      </div>
    )
  }

  const collapsedFlyoutGroup = collapsedFlyout
    ? menuGroups?.find((g) => g.id === collapsedFlyout.groupId) ?? null
    : null
  const collapsedFlyoutMenuIds = collapsedFlyoutGroup
    ? collapsedFlyoutGroup.menuIds.filter((id) => visibleMenuIds.includes(id))
    : []

  const collapsedFlyoutPortal =
    typeof document !== "undefined" &&
    collapsed &&
    collapsedFlyout &&
    collapsedFlyoutGroup &&
    collapsedFlyoutMenuIds.length > 0
      ? createPortal(
          <div
            role="menu"
            aria-label={collapsedFlyoutGroup.label}
            className="fixed z-[200] min-w-40 rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
            style={{ top: collapsedFlyout.top, left: collapsedFlyout.left }}
            onMouseEnter={clearCollapsedFlyoutTimer}
            onMouseLeave={scheduleCloseCollapsedFlyout}
          >
            <div className="mb-1 whitespace-nowrap border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              {collapsedFlyoutGroup.label}
            </div>
            {collapsedFlyoutMenuIds.map((menuId) => {
              const menu = menuById.get(menuId)
              if (!menu) return null
              const policy = resolvePolicy(menu.id)
              const isBlock = policy === "block"
              return (
                <button
                  key={menu.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleMenuClick(menu.id)}
                  className={cn(
                    "w-full cursor-pointer whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                    selectedMenu === menu.id && !isBlock
                      ? "bg-primary text-primary-foreground"
                      : isBlock
                        ? "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title={menu.label}
                >
                  {menu.label}
                </button>
              )
            })}
          </div>,
          document.body
        )
      : null

  const renderSidebarToggle = (compact = false) => {
    const atTop = sidebarTogglePlacement === "top"

    if (atTop) {
      /** w-12(48px) 기준 아이콘 중앙 = px-2.5 — 접힘/펼침 동일해 좌측 공백·튐 방지 */
      return (
        <div className="flex shrink-0 items-center justify-start px-2.5 py-2">
          <button
            type="button"
            title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
            onClick={() => setCollapsed((prev) => !prev)}
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 hover:opacity-70"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath("/image/mapSplit/standardWidth_sl.svg")}
              alt=""
              width={14}
              height={14}
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-300 ease-in-out dark:brightness-0 dark:invert dark:opacity-70",
                collapsed && "scale-x-[-1]"
              )}
              aria-hidden
            />
          </button>
        </div>
      )
    }

    const ToggleIcon = collapsed ? LayoutGrid : List
    return (
      <div
        className={cn(
          "shrink-0 border-t pt-2",
          compact ? "flex justify-center px-1 pb-2" : "px-2 pb-2"
        )}
      >
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

  const toggleAtTop = sidebarTogglePlacement === "top"
  const sidebarTopNode =
    typeof renderSidebarTop === "function"
      ? renderSidebarTop({ collapsed })
      : renderSidebarTop
  const sidebarBottomNode =
    typeof renderSidebarBottom === "function"
      ? renderSidebarBottom({ collapsed })
      : renderSidebarBottom

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        className ?? "h-screen"
      )}
    >
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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            "flex shrink-0 flex-col min-h-0 overflow-hidden border-r bg-muted/30 transition-[width] duration-300 ease-in-out",
            collapsed ? "w-12" : "w-64"
          )}
        >
          {toggleAtTop ? renderSidebarToggle(collapsed) : null}
          {sidebarTopNode ? (
            <div className={cn("shrink-0 border-b", collapsed ? "px-1 py-1" : "px-3 py-2")}>
              {sidebarTopNode}
            </div>
          ) : null}
          {collapsed ? (
            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-0 pb-0"
              onScroll={() => setCollapsedFlyout(null)}
            >
              {renderCollapsedIconRail()}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto pt-0 pb-0">
              {ungroupedVisibleIds.length > 0 ? (
                <div className="border-b">
                  {ungroupedVisibleIds.map((menuId) => {
                    const menu = menuById.get(menuId)
                    if (!menu) return null
                    return renderFlatMenuButton(menu, false)
                  })}
                </div>
              ) : null}
              {menuGroups && menuGroups.length > 0 ? (
                menuGroups.map((group) => {
                  const visibleGroupMenuIds = group.menuIds.filter((id) => visibleMenuIds.includes(id))
                  if (visibleGroupMenuIds.length === 0) return null
                  const isOpen = expandedGroupIds.includes(group.id)
                  const GroupIcon = group.icon
                  return (
                    <div key={group.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold transition-colors",
                          isOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        )}
                        onClick={() =>
                          setExpandedGroupIds((prev) =>
                            prev.includes(group.id) ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                          )
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {GroupIcon ? <GroupIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
                          <span className="truncate">{group.label}</span>
                        </span>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen ? "rotate-180" : "rotate-0")} />
                      </button>
                      {isOpen && (
                        <div className="py-1">
                          {visibleGroupMenuIds.map((menuId) => {
                            const menu = menuById.get(menuId)
                            if (!menu) return null
                            return renderFlatMenuButton(menu, true)
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                menus.map((menu) => {
                  if (consoleArea && resolvePolicy(menu.id) === "hidden") return null
                  return renderFlatMenuButton(menu, false)
                })
              )}
            </div>
          )}
          {sidebarBottomNode ? (
            <div className="shrink-0 border-t">{sidebarBottomNode}</div>
          ) : null}
          {!toggleAtTop ? renderSidebarToggle(collapsed) : null}
        </aside>

        <main
          className={cn(
            "flex h-full min-h-0 flex-1 flex-col overflow-hidden",
            contentChrome === "plain" ? "px-8 py-4" : "p-4"
          )}
        >
          {contentChrome === "plain" ? (
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              {(renderTitleExtra || renderHeaderActions) && (
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {renderTitleExtra?.(selectedMenu)}
                  </div>
                  {renderHeaderActions?.(selectedMenu)}
                </div>
              )}
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
                    className="m-0 flex h-full min-h-0 min-w-0 flex-1 flex-col border-0 p-0 disabled:opacity-100 [&_button:not([type='button'])]:disabled:opacity-60"
                  >
                    {currentPolicy === "read" ? (
                      <p className="mb-3 shrink-0 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        읽기 권한만 있습니다. 저장·추가·삭제는 할 수 없습니다.
                      </p>
                    ) : null}
                    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                      {renderContent(selectedMenu)}
                    </div>
                  </fieldset>
                </ConsoleMenuAccessContext.Provider>
              )}
            </div>
          ) : (
            <Card className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-none pt-6 pb-3">
              <CardHeader className="shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CardTitle>{currentLabel}</CardTitle>
                    {renderTitleExtra?.(selectedMenu)}
                  </div>
                  {renderHeaderActions?.(selectedMenu)}
                </div>
                <CardDescription>{getDescription(selectedMenu)}</CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-auto">
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
                      className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0 disabled:opacity-100 [&_button:not([type='button'])]:disabled:opacity-60"
                    >
                      {currentPolicy === "read" ? (
                        <p className="mb-3 shrink-0 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                          읽기 권한만 있습니다. 저장·추가·삭제는 할 수 없습니다.
                        </p>
                      ) : null}
                      {renderContent(selectedMenu)}
                    </fieldset>
                  </ConsoleMenuAccessContext.Provider>
                )}
              </CardContent>
            </Card>
          )}
        </main>
        {renderBodyOverlay}
      </div>
      {consoleArea ? (
        <ConsoleMenuAccessDeniedDialog
          open={deniedOpen}
          onOpenChange={setDeniedOpen}
          area={consoleArea}
          menuId={deniedMenuId}
        />
      ) : null}
      {collapsedFlyoutPortal}
    </div>
  )
}
