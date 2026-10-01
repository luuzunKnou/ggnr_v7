"use client"

import React, { useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Card } from "@/app/shadcnComponents/ui/card"
import { ChevronRight, Droplets, CloudRain, Waves, Plane } from "lucide-react"
import { canAccessPrivateSystem } from "@/lib/accessClient"
import { useMyAccessSnapshot } from "@/hooks/useMyAccessSnapshot"
import { ResourceAccessDeniedDialog } from "@/app/(pages)/_components/AccessRequest"
import { useLoginModal } from "@/app/login-modal-context"
import { withBasePath, withBasePathNav } from "@/lib/basePath"
import { cn } from "@/lib/utils"

export type SystemItem = {
  sys_key: string
  sys_kor: string
  sys_eng?: string
  sys_detail?: string
  sys_img: string
  sys_idx: number
  sys_col: string
  sys_link: string
  serviceList: string[]
  layerGroupList: string[]
  sys_is_private?: boolean | null
}

interface SystemManagementSectionProps {
  systems: SystemItem[]
}

const DEFAULT_COLORS: Record<string, string> = {
  wtl: "#0EA5E9",
  swl: "#8B5CF6",
  water: "#06B6D4",
  uav: "#6366F1",
  uav_view: "#ea580c",
}

/** 시스템별 기본 로고(아이콘). sys_img가 비어 있을 때 사용 */
const DEFAULT_ICONS: Record<string, React.ReactNode> = {
  wtl: <Droplets className="w-8 h-8" strokeWidth={1.5} />,
  swl: <CloudRain className="w-8 h-8" strokeWidth={1.5} />,
  water: <Waves className="w-8 h-8" strokeWidth={1.5} />,
  uav: <Plane className="w-8 h-8" strokeWidth={1.5} />,
  uav_view: <Plane className="w-8 h-8" strokeWidth={1.5} />,
}

export function SystemManagementSection({ systems }: SystemManagementSectionProps) {
  const { data: session, status } = useSession()
  const { openLogin } = useLoginModal()
  const { snapshot, loading: accessLoading, reload } = useMyAccessSnapshot()
  const [deniedOpen, setDeniedOpen] = useState(false)
  const [deniedSysKey, setDeniedSysKey] = useState("")

  const sorted = useMemo(() => {
    const isAllowed = (sys: SystemItem) =>
      sys.sys_is_private !== true ||
      canAccessPrivateSystem(snapshot, sys.sys_key, sys.sys_is_private)

    return [...systems].sort((a, b) => {
      // 권한 로드 전에는 기존 순번 유지. 로드 후 권한 없는 시스템을 뒤로
      if (!accessLoading) {
        const aOk = isAllowed(a)
        const bOk = isAllowed(b)
        if (aOk !== bOk) return aOk ? -1 : 1
      }
      return a.sys_idx - b.sys_idx
    })
  }, [systems, snapshot, accessLoading])

  if (systems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        등록된 시스템이 없습니다.
      </div>
    )
  }

  return (
    <section className="w-full relative">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {sorted.map((sys) => {
          const accent = sys.sys_col || DEFAULT_COLORS[sys.sys_key] || "#64748b"
          const href = sys.sys_link || `/map?system=${sys.sys_key}`
          const isPrivate = sys.sys_is_private === true
          const allowed =
            !isPrivate || canAccessPrivateSystem(snapshot, sys.sys_key, sys.sys_is_private)
          const gated = isPrivate && accessLoading
          const locked = !gated && !allowed
          const color = locked ? "#94a3b8" : accent

          const inner = (
            <Card
              className={cn(
                "px-5 py-3.5 h-full transition-all duration-300 rounded-[5px] border flex flex-row items-center gap-4",
                locked
                  ? "border-border/70 bg-muted/60 text-muted-foreground shadow-none"
                  : "border-border bg-card",
                allowed && !gated && "hover:shadow-lg hover:-translate-y-0.5",
                gated && "opacity-60"
              )}
              style={{
                borderLeftWidth: "4px",
                borderLeftColor: color,
              }}
            >
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-wide",
                      locked ? "text-muted-foreground/50" : "text-muted-foreground/55"
                    )}
                    style={{ marginTop: "3px", marginBottom: "-3px" }}
                  >
                    {sys.sys_eng ?? sys.sys_key}
                  </span>
                  <h3
                    className={cn(
                      "text-sm font-semibold leading-tight",
                      locked ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {sys.sys_kor}
                  </h3>
                  {sys.sys_detail && (
                    <div className="mt-1 min-w-0">
                      <span
                        className={cn(
                          "text-xs truncate block",
                          locked ? "text-muted-foreground/70" : "text-muted-foreground"
                        )}
                      >
                        {sys.sys_detail}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    "w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-transform duration-300",
                    !locked && "group-hover:scale-110"
                  )}
                  style={{
                    backgroundColor: locked ? "rgba(148,163,184,0.12)" : `${color}15`,
                    border: locked ? "2px solid rgba(148,163,184,0.28)" : `2px solid ${color}30`,
                    color,
                  }}
                >
                  {(() => {
                    const imgRaw = sys.sys_img?.trim() ?? "";
                    const isInlineSvg = imgRaw.startsWith("<");
                    const iconSrc =
                      !isInlineSvg &&
                      withBasePath(imgRaw || `/image/systemlistIcon/${sys.sys_key}.svg`);
                    if (isInlineSvg) {
                      return (
                        <div
                          className="w-7 h-7 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-none [&>svg]:stroke-current"
                          style={{ color }}
                          dangerouslySetInnerHTML={{ __html: imgRaw }}
                        />
                      );
                    }
                    if (iconSrc) {
                      return (
                        <div
                          className="w-7 h-7 shrink-0"
                          style={{
                            backgroundColor: color,
                            WebkitMaskImage: `url(${iconSrc})`,
                            maskImage: `url(${iconSrc})`,
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                          }}
                          role="img"
                          aria-label=""
                        />
                      );
                    }
                    return DEFAULT_ICONS[sys.sys_key] ?? <ChevronRight className="w-6 h-6" />;
                  })()}
                </div>
              </Card>
          )

          if (gated) {
            return (
              <div key={sys.sys_key} className="block w-full">
                {inner}
              </div>
            )
          }

          if (allowed) {
            const appHref = href.startsWith("/") ? href : `/map?system=${sys.sys_key}`
            return (
              <button
                key={sys.sys_key}
                type="button"
                title={sys.sys_kor}
                className="block w-full cursor-pointer text-left group"
                onClick={() => {
                  if (status === "loading") return
                  if (!session?.user) {
                    openLogin(appHref)
                    return
                  }
                  window.location.assign(withBasePathNav(appHref))
                }}
              >
                {inner}
              </button>
            )
          }

          const appHrefDenied = href.startsWith("/") ? href : `/map?system=${sys.sys_key}`
          return (
            <button
              key={sys.sys_key}
              type="button"
              title={`${sys.sys_kor} (권한 필요)`}
              className="block w-full text-left group"
              onClick={() => {
                void (async () => {
                  if (status === "loading") return
                  if (!session?.user) {
                    openLogin(appHrefDenied)
                    return
                  }
                  const snap = await reload({ silent: true })
                  if (canAccessPrivateSystem(snap, sys.sys_key, sys.sys_is_private)) {
                    window.location.assign(withBasePathNav(appHrefDenied))
                    return
                  }
                  setDeniedSysKey(sys.sys_key)
                  setDeniedOpen(true)
                })()
              }}
            >
              {inner}
            </button>
          )
        })}
      </div>
      <ResourceAccessDeniedDialog
        open={deniedOpen}
        onOpenChange={setDeniedOpen}
        resource="system"
        sysKey={deniedSysKey}
      />
    </section>
  )
}
