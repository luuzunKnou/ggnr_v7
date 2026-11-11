'use client'

import { useState } from 'react'
import { ChevronUp, X } from 'lucide-react'
import { MapFloatingPanel } from '../../../../_mapComponents/MapFloatingPanel'
import { cn } from '@/lib/utils'
import type { SectionTab } from './useWtlNetworkSection'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyAreaLine,
  SectionSupplyBandSegment,
} from './wtlNetworkSectionSvg'
import type { SectionSupplyElevRow } from './useWtlNetworkSection'
import { WtlNetworkSectionThreeJsTab } from './WtlNetworkSectionThreeJsTab'
import { WtlNetworkSectionChart } from './wtlNetworkSectionChart'
import { SectionFeatureLegendSkeleton } from './wtlNetworkSectionLegend'
import { SECTION_PANEL_BODY_CLASS } from './wtlNetworkSectionLayout'

type Props = {
  open: boolean
  tab: SectionTab
  onTabChange: (tab: SectionTab) => void
  lineReady: boolean
  loading: boolean
  error: string
  ground: SectionGroundPt[]
  groundMin?: SectionGroundPt[]
  groundMax?: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  lineLonLat: [number, number][] | null
  line3857?: [number, number][] | null
  enabledKeys?: string[]
  supplyAreaLines?: SectionSupplyAreaLine[]
  supplyAreaBands?: SectionSupplyBandSegment[]
  supplyElevComposition?: SectionSupplyElevRow[]
  onClose: () => void
  onRedraw: () => void
}

export function WtlNetworkSectionPanel({
  open,
  tab,
  onTabChange,
  lineReady,
  loading,
  error,
  ground,
  groundMin = [],
  groundMax = [],
  features,
  totalLengthM,
  lineLonLat: _lineLonLat,
  line3857 = null,
  enabledKeys = [],
  supplyAreaLines: _supplyAreaLines = [],
  supplyAreaBands = [],
  supplyElevComposition = [],
  onClose,
  onRedraw,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  if (!open) return null

  const footer =
    tab === 'crossChart'
      ? '절단선 방향의 지반고·관로·시설과 급수구역 구성을 봅니다.'
      : tab === 'longChart'
        ? '절단 깊이축의 지반고·관로·시설과 표고별 구역·분구·블록 구성을 봅니다.'
        : '절단 구간 지형과 관로·시설을 3D로 확인합니다.'

  return (
    <MapFloatingPanel
      viewport
      zLayer="detailFloating"
      width="min(1100px, calc(100vw - 2rem))"
      maxHeight="94vh"
      defaultPosition={{ top: 72, right: 24 }}
      className="bg-background backdrop-blur-none"
      header={
        <>
          <button
            type="button"
            title={collapsed ? '펼치기' : '접기'}
            aria-label={collapsed ? '펼치기' : '접기'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="standard-panel-close mr-2 cursor-pointer"
          >
            <ChevronUp
              className={cn('h-4 w-4', collapsed && 'rotate-180')}
              aria-hidden
            />
          </button>
          <div className="min-w-0 flex-1 pr-2">
            <div className="truncate text-sm font-semibold text-foreground">단면도</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {lineReady
                ? `절단선 ${totalLengthM.toFixed(0)} m · 시설 ${features.length}건`
                : '절단선 기준 단면'}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded border border-border px-2 text-[11px] text-foreground hover:bg-muted"
            title="다시 그리기"
            onClick={onRedraw}
          >
            다시 그리기
          </button>
          <button
            type="button"
            className="standard-panel-close ml-1 cursor-pointer"
            title="닫기"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          collapsed && 'hidden'
        )}
      >
        <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          {(
            [
              { id: 'crossChart' as const, label: '횡단면도' },
              { id: 'longChart' as const, label: '종단면도' },
              { id: 'threejs' as const, label: 'ThreeJs' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              className={cn(
                'cursor-pointer border-b-2 px-3 py-1.5 text-[12px] font-medium',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={cn('overflow-hidden p-3', SECTION_PANEL_BODY_CLASS)}>
          {tab === 'threejs' ? (
            !lineReady || !line3857 || line3857.length < 2 ? (
              <p className="py-10 text-center text-[12px] text-muted-foreground">
                절단선 데이터가 없습니다.
              </p>
            ) : (
              <WtlNetworkSectionThreeJsTab
                line3857={line3857}
                enabledKeys={enabledKeys}
              />
            )
          ) : loading ? (
            <div className="flex h-full min-h-0 gap-2 overflow-hidden rounded border-2 border-border bg-background p-2">
              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <p className="text-center text-[12px] text-muted-foreground">
                  등고·시설 조회 중…
                </p>
              </div>
              <SectionFeatureLegendSkeleton />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-[12px] text-destructive">{error}</p>
          ) : !lineReady ? (
            <p className="py-10 text-center text-[12px] text-muted-foreground">
              절단선 데이터가 없습니다.
            </p>
          ) : (
            <WtlNetworkSectionChart
              mode={tab === 'longChart' ? 'longChart' : 'crossChart'}
              ground={ground}
              groundMin={groundMin}
              groundMax={groundMax}
              features={features}
              totalLengthM={totalLengthM}
              supplyAreaBands={supplyAreaBands}
              supplyElevComposition={supplyElevComposition}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {footer}
        </div>
      </div>
    </MapFloatingPanel>
  )
}
