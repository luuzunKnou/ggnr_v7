"use client"

import React from "react"
import {
  Globe,
  Grid3X3,
  Building2,
  Layers2,
  Route,
  SquareStack,
  Users,
  PersonStanding,
  Ruler,
  Scaling,
  Mountain,
  TrendingUp,
  Printer,
  RotateCcw,
  Banknote,
  ClipboardPen,
  Images,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// 패널 아이템 타입 정의
export interface MapControlItem {
  id: string
  icon: LucideIcon
  label: string
  allowMultiple?: boolean // 다중 선택 가능 여부
  onClick?: () => void
}

// 구분선을 포함한 그룹 타입
export interface MapControlGroup {
  id: string
  items: MapControlItem[]
}

interface MapControlPanelProps {
  groups: MapControlGroup[]
  activeIds?: string[]
  onItemClick?: (id: string, isActive: boolean) => void
  /** 지목/소유구분 등 우클릭 시 레이어 목록 패널용 */
  onItemRightClick?: (id: string) => void
  className?: string
  /** 첫 번째 그룹(배경지도) 바로 아래에 삽입할 추가 컨트롤 */
  extraAfterFirstGroup?: React.ReactNode
}

// 개별 컨트롤 버튼 컴포넌트
function MapControlButton({
  item,
  isActive,
  onClick,
  onRightClick,
}: {
  item: MapControlItem
  isActive: boolean
  onClick: () => void
  onRightClick?: () => void
}) {
  const Icon = item.icon

  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        if (onRightClick) {
          e.preventDefault()
          onRightClick()
        }
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-1 shrink-0 box-border p-0 transition-colors cursor-pointer",
        "hover:bg-slate-100 hover:text-blue-600",
        "dark:text-white/90 dark:hover:bg-white/10 dark:hover:text-white",
        isActive && "bg-slate-100 text-blue-600 dark:bg-white/20 dark:text-white"
      )}
      style={{ width: 45, height: 45 }}
      title={item.label}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
      <span className="leading-tight text-center whitespace-nowrap overflow-hidden truncate" style={{ maxWidth: 45, fontSize: '9px' }}>
        {item.label}
      </span>
    </button>
  )
}

// 메인 패널 컴포넌트
export function MapControlPanel({
  groups,
  activeIds = [],
  onItemClick,
  onItemRightClick,
  className,
  extraAfterFirstGroup,
}: MapControlPanelProps) {
  return (
    <div className={cn("flex flex-col gap-2.5 opacity-90 shrink-0", className)} style={{ width: 45 }}>
      {groups.map((group, groupIndex) => (
        <React.Fragment key={group.id}>
          <div
            className="flex flex-col bg-white/95 text-foreground backdrop-blur-sm rounded-[5px] shadow-lg border border-slate-200 overflow-hidden shrink-0 dark:bg-black/55 dark:text-white/90 dark:border-white/10"
            style={{ width: 45, minWidth: 45, maxWidth: 45 }}
          >
            {group.items.map((item) => {
              const isActive = activeIds.includes(item.id)
              return (
                <MapControlButton
                  key={item.id}
                  item={item}
                  isActive={isActive}
                  onClick={() => {
                    item.onClick?.()
                    onItemClick?.(item.id, isActive)
                  }}
                  onRightClick={
                    onItemRightClick ? () => onItemRightClick(item.id) : undefined
                  }
                />
              )
            })}
            {groupIndex === 0 && extraAfterFirstGroup != null && extraAfterFirstGroup}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

// 기본 맵 컨트롤 설정 (예시에 맞게 구성)
export const defaultMapControlGroups: MapControlGroup[] = [
  {
    id: "base-maps",
    items: [
      { id: "background-map", icon: Globe, label: "배경지도" },
      { id: "aerial-view", icon: Images, label: "드론영상" },
    ],
  },
  {
    id: "layers",
    items: [
      { id: "cadastral", icon: Grid3X3, label: "지적도", allowMultiple: true },
      { id: "building-road", icon: Building2, label: "건물·도로", allowMultiple: true },
      { id: "thematic-map", icon: Layers2, label: "주제도", allowMultiple: true },
      { id: "basic-section", icon: Route, label: "기초구간", allowMultiple: true },
      { id: "land-category", icon: SquareStack, label: "지목", allowMultiple: true },
      { id: "ownership", icon: Users, label: "소유구분", allowMultiple: true },
    ],
  },
  {
    id: "views",
    items: [
      { id: "street-view", icon: PersonStanding, label: "거리뷰", allowMultiple: true },
      { id: "official-land-price", icon: Banknote, label: "공시지가", allowMultiple: true },
    ],
  },
  {
    id: "measurements",
    items: [
      { id: "distance", icon: Ruler, label: "거리" },
      { id: "area", icon: Scaling, label: "면적" },
      { id: "altitude", icon: Mountain, label: "고도" },
      { id: "slope", icon: TrendingUp, label: "경사도" },
      { id: "reset-measurements", icon: RotateCcw, label: "초기화" },
    ],
  },
  {
    id: "actions",
    items: [
      { id: "print", icon: Printer, label: "인쇄" },
      { id: "shooting-request", icon: ClipboardPen, label: "촬영요청" },
    ],
  },
]
