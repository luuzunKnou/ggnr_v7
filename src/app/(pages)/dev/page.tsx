"use client"

import { useState, useEffect } from "react"
import { Lock } from "lucide-react"
import Link from "next/link"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { Input } from "@/app/shadcnComponents/ui/input"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/app/(pages)/(index)/theme-toggle"
import { DevTestContent } from "./_components/DevTestContent"
import { DbManagerContent } from "./_components/DbManagerContent"
import { SystemListManager } from "./_components/SystemListManager"
import { ServiceListManager } from "./_components/ServiceListManager"
import { LayerInfoManager } from "./_components/LayerInfoManager"
import { LayerAttrManager } from "./_components/LayerAttrManager"

const DEV_AUTH_KEY = "dev_mode_auth"
const DEV_PASSWORD = "admin00!!"

const DEV_SUBMENUS = [
  { id: "systemList", label: "시스템 목록관리" },
  { id: "serviceList", label: "기능 목록관리" },
  { id: "layerInfo", label: "레이어 정보관리" },
  { id: "layerAttr", label: "레이어 속성관리" },
  { id: "layerCode", label: "레이어 코드관리" },
  { id: "systemVar", label: "시스템 변수" },
  { id: "dbManager", label: "DB Manager" },
  { id: "devTest", label: "devTest" },
] as const

type DevSubmenuId = (typeof DEV_SUBMENUS)[number]["id"]

export default function DevPage() {
  const [mounted, setMounted] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [selectedMenu, setSelectedMenu] = useState<DevSubmenuId>("systemList")

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const stored = typeof window !== "undefined" ? sessionStorage.getItem(DEV_AUTH_KEY) : null
    setAuthenticated(stored === "1")
  }, [mounted])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password === DEV_PASSWORD) {
      if (typeof window !== "undefined") sessionStorage.setItem(DEV_AUTH_KEY, "1")
      setAuthenticated(true)
      setPassword("")
    } else {
      setError("비밀번호가 올바르지 않습니다.")
    }
  }

  const handleLogout = () => {
    if (typeof window !== "undefined") sessionStorage.removeItem(DEV_AUTH_KEY)
    setAuthenticated(false)
    setPassword("")
    setError("")
  }

  const handleLockDoubleClick = () => {
    if (typeof window !== "undefined") sessionStorage.setItem(DEV_AUTH_KEY, "1")
    setAuthenticated(true)
    setPassword("")
    setError("")
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm rounded-xl border-slate-200/80 dark:border-slate-700/80 shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 overflow-hidden -translate-y-[200px]">
          <CardHeader className="text-center pb-2 pt-8">
            <div
              role="button"
              tabIndex={0}
              onDoubleClick={handleLockDoubleClick}
              className="mx-auto mb-4 w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center select-none"
              title="더블클릭 시 비밀번호 없이 진입"
            >
              <Lock className="w-7 h-7 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
            </div>
            <CardTitle className="text-xl">개발자 모드</CardTitle>
            <CardDescription className="mt-1.5">
              비밀번호를 입력하면 접근할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="dev-password" className="text-sm font-medium text-foreground/90 sr-only">
                  비밀번호
                </label>
                <Input
                  id="dev-password"
                  type="password"
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 dark:focus-visible:ring-slate-500"
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
              <Button type="submit" size="sm" className="h-11 rounded-lg w-full font-medium">
                확인
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t border-slate-200/80 dark:border-slate-700/80 text-center -mb-[33px]">
              <Link
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← 메인으로 돌아가기
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentLabel = DEV_SUBMENUS.find((m) => m.id === selectedMenu)?.label ?? selectedMenu

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-foreground">개발자 모드</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" className="rounded-none" onClick={handleLogout}>
            로그아웃
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-none">
            <Link href="/">메인으로</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-52 shrink-0 border-r bg-muted/30 flex flex-col py-2">
          {DEV_SUBMENUS.map((menu) => (
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
              <CardTitle>{currentLabel}</CardTitle>
              <CardDescription>
                {selectedMenu === "systemList"
                  ? "시스템 목록관리 설정 화면입니다."
                  : selectedMenu === "serviceList"
                    ? "기능 목록관리 설정 화면입니다."
                    : selectedMenu === "layerInfo"
                      ? "레이어 정보관리 설정 화면입니다."
                      : selectedMenu === "layerAttr"
                        ? "레이어 속성관리 설정 화면입니다."
                        : selectedMenu === "devTest"
                          ? "데이터베이스 연결 테스트"
                          : selectedMenu === "dbManager"
                            ? "데이터 가져오기 / 백업 / 업데이트"
                            : `${currentLabel} 설정 화면입니다. (구현 예정)`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedMenu === "systemList" ? (
                <SystemListManager />
              ) : selectedMenu === "serviceList" ? (
                <ServiceListManager />
              ) : selectedMenu === "layerInfo" ? (
                <LayerInfoManager />
              ) : selectedMenu === "layerAttr" ? (
                <LayerAttrManager />
              ) : selectedMenu === "devTest" ? (
                <DevTestContent />
              ) : selectedMenu === "dbManager" ? (
                <DbManagerContent />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {currentLabel} 설정을 위한 화면이 여기에 표시됩니다.
                </p>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
