"use client"

import React from "react"
import Link from "next/link"
import { Card } from "@/app/shadcnComponents/ui/card"
import { ChevronRight, Droplets, CloudRain, Waves, Plane, Settings2 } from "lucide-react"

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
  layerList: string[]
}

interface SystemManagementSectionProps {
  systems: SystemItem[]
}

const DEFAULT_COLORS: Record<string, string> = {
  wtl: "#0EA5E9",
  swl: "#8B5CF6",
  water: "#06B6D4",
  uav: "#6366F1",
}

/** 시스템별 기본 로고(아이콘). sys_img가 비어 있을 때 사용 */
const DEFAULT_ICONS: Record<string, React.ReactNode> = {
  wtl: <Droplets className="w-8 h-8" strokeWidth={1.5} />,
  swl: <CloudRain className="w-8 h-8" strokeWidth={1.5} />,
  water: <Waves className="w-8 h-8" strokeWidth={1.5} />,
  uav: <Plane className="w-8 h-8" strokeWidth={1.5} />,
}

export function SystemManagementSection({ systems }: SystemManagementSectionProps) {
  if (systems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        등록된 시스템이 없습니다.
      </div>
    )
  }

  const sorted = [...systems].sort((a, b) => a.sys_idx - b.sys_idx)

  return (
    <section className="w-full">
      {/* <div className="mb-6 flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-muted-foreground" />
        <h2 className="text-xl font-bold text-foreground">시스템 목록</h2>
      </div> */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {sorted.map((sys) => {
          const color = sys.sys_col || DEFAULT_COLORS[sys.sys_key] || "#64748b"
          const href = sys.sys_link || `/map?system=${sys.sys_key}`
          return (
            <Link key={sys.sys_key} href={href} className="block group">
              <Card
                className="px-5 py-3.5 h-full transition-all duration-300 rounded-[5px] hover:shadow-lg hover:-translate-y-0.5 border border-border flex flex-row items-center gap-4"
                style={{
                  borderLeftWidth: "4px",
                  borderLeftColor: color,
                }}
              >
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <span
                    className="text-[10px] font-medium text-muted-foreground/55 uppercase tracking-wide"
                    style={{ marginTop: "3px", marginBottom: "-3px" }}
                  >
                    {sys.sys_eng ?? sys.sys_key}
                  </span>
                  <h3 className="text-sm font-semibold text-foreground leading-tight">
                    {sys.sys_kor}
                  </h3>
                  {sys.sys_detail && (
                    <div className="mt-1 min-w-0">
                      <span className="text-xs text-muted-foreground truncate block">
                        {sys.sys_detail}
                      </span>
                    </div>
                  )}
                </div>
                {/* 오른쪽 로고: 아래쪽 시스템 목록(부서 카드)과 동일한 원형 + 아이콘 스타일 */}
                <div
                  className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                  style={{
                    backgroundColor: `${color}15`,
                    border: `2px solid ${color}30`,
                    color,
                  }}
                >
                  {(() => {
                    const imgRaw = sys.sys_img?.trim() ?? "";
                    const isInlineSvg = imgRaw.startsWith("<");
                    const iconSrc = !isInlineSvg && (imgRaw || `/image/systemlistIcon/${sys.sys_key}.svg`);
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
            </Link>
          )
        })}
      </div>
    </section>
  )
}
