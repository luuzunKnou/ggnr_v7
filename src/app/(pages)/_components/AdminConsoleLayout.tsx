"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { cn } from "@/lib/utils"
import { signOut } from "next-auth/react"

export type AdminConsoleMenuItem = { id: string; label: string }

type AdminConsoleLayoutProps = {
  title: string
  menus: readonly AdminConsoleMenuItem[]
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
  defaultMenuId,
  getDescription,
  renderContent,
  renderTitleExtra,
  onLogout,
}: AdminConsoleLayoutProps) {
  const validDefault = menus.some((m) => m.id === defaultMenuId) ? defaultMenuId : menus[0]?.id ?? ""
  const [selectedMenu, setSelectedMenu] = useState(validDefault)

  const currentLabel = menus.find((m) => m.id === selectedMenu)?.label ?? selectedMenu

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
        <aside className="w-52 shrink-0 border-r bg-muted/30 flex flex-col py-2">
          {menus.map((menu) => (
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
          ))}
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
