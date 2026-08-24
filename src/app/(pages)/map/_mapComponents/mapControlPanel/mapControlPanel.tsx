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
  Printer,
  RotateCcw,
  Banknote,
  ClipboardPen,
  Images,
  Columns2 as MapSplitIcon,
  Waypoints,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SHOOTING_REQUEST_UI_ENABLED } from "@/app/(pages)/map/_mapContents/shootingRequest/shootingRequestUiFlag"

// 패널 아이템 타입 정의
export interface MapControlItem {
  id: string
  icon: LucideIcon
  label: string
  allowMultiple?: boolean // 다중 선택 가능 여부
  /** 라벨 글자 크기(px). 미지정 시 9 */
  labelFontSize?: number
  /** false면 말줄임(...) 없이 표시. 미지정 시 true */
  labelEllipsis?: boolean
  /** 자간(px). 음수면 글자를 좁혀 한 줄에 맞춤 */
  labelLetterSpacing?: number
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
  /** 버튼 id별 좌측 확장 패널 (해당 버튼 행에 정렬) */
  renderItemPanel?: (id: string) => React.ReactNode
}

// 개별 컨트롤 버튼 컴포넌트
function MapControlButton({
  item,
  isActive,
  onClick,
  onRightClick,
  roundTop,
  roundBottom,
}: {
  item: MapControlItem
  isActive: boolean
  onClick: () => void
  onRightClick?: () => void
  roundTop?: boolean
  roundBottom?: boolean
}) {
  const Icon = item.icon

  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        // 지도 컨트롤은 브라우저 기본 메뉴 대신 앱 동작(또는 무시)
        e.preventDefault()
        onRightClick?.()
      }}
      className={cn(
        "flex h-[45px] w-full min-w-0 flex-col items-center justify-center gap-1 overflow-hidden box-border p-0 transition-colors cursor-pointer",
        "hover:bg-slate-100 hover:text-blue-600",
        "dark:text-white/90 dark:hover:bg-white/10 dark:hover:text-white",
        isActive && "bg-slate-100 text-blue-600 dark:bg-white/20 dark:text-white",
        roundTop && "rounded-t-[4px]",
        roundBottom && "rounded-b-[4px]"
      )}
      title={item.label}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
      <span
        className={cn(
          "leading-tight text-center",
          item.labelEllipsis === false
            ? "flex w-full justify-center whitespace-nowrap px-0"
            : "max-w-full whitespace-nowrap overflow-hidden truncate px-0.5"
        )}
        style={{
          fontSize: `${item.labelFontSize ?? 9}px`,
          ...(item.labelLetterSpacing != null
            ? {
                letterSpacing: `${item.labelLetterSpacing}px`,
                marginLeft: -1,
              }
            : {}),
        }}
      >
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
  renderItemPanel,
}: MapControlPanelProps) {
  return (
    <div className={cn("flex flex-col gap-2.5 opacity-90 shrink-0", className)} style={{ width: 45 }}>
      {groups.map((group, groupIndex) => {
        const items = group.items.filter(
          (item) => SHOOTING_REQUEST_UI_ENABLED || item.id !== "shooting-request"
        )
        return (
          <div
            key={group.id}
            className="relative shrink-0"
            style={{ width: 45, minWidth: 45, maxWidth: 45 }}
          >
            {items.map((item, itemIndex) => {
              const itemPanel = renderItemPanel?.(item.id)
              if (itemPanel == null) return null
              return (
                <div
                  key={`panel-${item.id}`}
                  className="pointer-events-auto absolute right-[calc(100%+12px)] z-10"
                  data-map-control-expand-panel
                  style={{
                    top: (itemIndex + 1) * 45,
                    transform: "translateY(-100%)",
                  }}
                >
                  {itemPanel}
                </div>
              )
            })}
            <div className="flex w-full flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white/95 text-foreground shadow-lg backdrop-blur-sm dark:border-white/10 dark:bg-black/55 dark:text-white/90">
              {items.map((item, itemIndex) => {
                const isActive = activeIds.includes(item.id)
                const isFirst = itemIndex === 0
                const isLast =
                  itemIndex === items.length - 1 &&
                  !(groupIndex === 0 && extraAfterFirstGroup != null)
                return (
                  <MapControlButton
                    key={item.id}
                    item={item}
                    isActive={isActive}
                    roundTop={isFirst}
                    roundBottom={isLast}
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
              {groupIndex === 0 && extraAfterFirstGroup != null ? extraAfterFirstGroup : null}
            </div>
          </div>
        )
      })}
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
      { id: "underground-facility", icon: Waypoints, label: "지하시설물", allowMultiple: true, labelEllipsis: false, labelLetterSpacing: -0.3 },
      { id: "official-land-price", icon: Banknote, label: "공시지가", allowMultiple: true },
    ],
  },
  {
    id: "views",
    items: [
      { id: "map-split", icon: MapSplitIcon, label: "지도분할", allowMultiple: true },
      { id: "street-view", icon: PersonStanding, label: "거리뷰", allowMultiple: true },
    ],
  },
  {
    id: "measurements",
    items: [
      { id: "distance", icon: Ruler, label: "거리" },
      { id: "area", icon: Scaling, label: "면적" },
      { id: "altitude", icon: Mountain, label: "고도" },
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
