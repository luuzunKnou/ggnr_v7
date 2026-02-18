"use client"

import {
  Globe,
  Grid3X3,
  Building2,
  Layers,
  SquareStack,
  Users,
  PersonStanding,
  Ruler,
  Scaling,
  Mountain,
  TrendingUp,
  Printer,
  RotateCcw,
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
  className?: string
}

// 개별 컨트롤 버튼 컴포넌트
function MapControlButton({
  item,
  isActive,
  onClick,
}: {
  item: MapControlItem
  isActive: boolean
  onClick: () => void
}) {
  const Icon = item.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 w-14 h-14 transition-colors",
        "hover:bg-slate-100 hover:text-blue-600",
        isActive && "bg-slate-100 text-blue-600"
      )}
    >
      <Icon className="w-5 h-5" strokeWidth={1.5} />
      <span className="text-[11px] leading-tight text-center whitespace-nowrap">
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
  className,
}: MapControlPanelProps) {
  return (
    <div className={cn("flex flex-col gap-2.5 w-14 opacity-90", className)}>
      {groups.map((group) => (
        <div
          key={group.id}
          className="flex flex-col bg-white/95 backdrop-blur-sm rounded-[10px] shadow-lg border border-slate-200 overflow-hidden"
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
              />
            )
          })}
        </div>
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
    ],
  },
  {
    id: "layers",
    items: [
      { id: "cadastral", icon: Grid3X3, label: "지적도", allowMultiple: true },
      { id: "building-road", icon: Building2, label: "건물·도로", allowMultiple: true },
      { id: "thematic", icon: Layers, label: "주제도", allowMultiple: true },
      { id: "land-category", icon: SquareStack, label: "지목", allowMultiple: true },
      { id: "ownership", icon: Users, label: "소유구분", allowMultiple: true },
    ],
  },
  {
    id: "views",
    items: [
      { id: "street-view", icon: PersonStanding, label: "거리뷰", allowMultiple: true },
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
    ],
  },
]
