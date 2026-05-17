"use client"

import { useState, useEffect } from "react"
import { Lock, FlaskConical } from "lucide-react"
import Link from "next/link"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { Input } from "@/app/shadcnComponents/ui/input"
import { AdminConsoleLayout } from "@/app/(pages)/_components/AdminConsoleLayout"
import { DEV_MENU_GROUPS, DEV_SUBMENUS, getDevMenuDescription, renderDevMenuContent } from "./_components/devConsolePanels"
import { call } from "@/lib/api"
import { signOut } from "next-auth/react"

const DEV_AUTH_KEY = "dev_mode_auth"
const DEV_PASSWORD = "admin00!!"

export default function DevPage() {
  const [mounted, setMounted] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [sampleGenLoading, setSampleGenLoading] = useState(false)
  const [sampleGenMessage, setSampleGenMessage] = useState("")

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

  const handleLogout = async () => {
    if (typeof window !== "undefined") sessionStorage.removeItem(DEV_AUTH_KEY)
    setAuthenticated(false)
    setPassword("")
    setError("")
    await signOut({ redirect: false })
  }

  const handleLockDoubleClick = () => {
    if (typeof window !== "undefined") sessionStorage.setItem(DEV_AUTH_KEY, "1")
    setAuthenticated(true)
    setPassword("")
    setError("")
  }

  const runSamplePipeline = async () => {
    setSampleGenLoading(true)
    setSampleGenMessage("")
    try {
      await call("", "POST", {
        service: "pipelineService",
        action: "runLasPipeline",
        params: { lasRelativePath: "upload_data/las/sampleData16.las" },
      })
      setSampleGenMessage("파이프라인을 시작했습니다. LAS File Uploader 이력에서 결과를 확인하세요.")
    } catch (err) {
      setSampleGenMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSampleGenLoading(false)
    }
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

  return (
    <AdminConsoleLayout
      title="개발자 모드"
      menus={DEV_SUBMENUS}
      menuGroups={DEV_MENU_GROUPS}
      stateStorageKey="devConsoleMenu"
      defaultMenuId="systemList"
      getDescription={getDevMenuDescription}
      renderContent={renderDevMenuContent}
      renderTitleExtra={(menuId) =>
        menuId === "fileManager" ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none"
              onClick={runSamplePipeline}
              disabled={sampleGenLoading}
            >
              <FlaskConical className="w-3.5 h-3.5 mr-1" />
              {sampleGenLoading ? "실행 중…" : "샘플 생성 (sampleData16.las)"}
            </Button>
            {sampleGenMessage && (
              <span className="text-xs text-muted-foreground">{sampleGenMessage}</span>
            )}
          </>
        ) : null
      }
      onLogout={handleLogout}
    />
  )
}
