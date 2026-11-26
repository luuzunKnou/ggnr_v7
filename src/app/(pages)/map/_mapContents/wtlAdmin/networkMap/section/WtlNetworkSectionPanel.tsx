'use client'

import { useEffect, useState } from 'react'
import { MapDetailFloatingPanel } from '../../../../_mapComponents/MapDetailFloatingPanel'
import { MAP_DETAIL_FLOAT_MINIMIZED_WIDTH } from '../../../../_mapComponents/mapDetailFloatingDock'
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
import {
  SectionFeatureLegendSkeleton,
  type LongPipeLegendItem,
} from './wtlNetworkSectionLegend'
import { SECTION_PANEL_BODY_CLASS } from './wtlNetworkSectionLayout'

const SECTION_PANEL_WIDTH = 'min(1100px, calc(100vw - 2rem))'

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
  minimized?: boolean
  pinPosition?: { top: number; left: number } | null
  onMinimizedChange?: (minimized: boolean) => void
  onClose: () => void
  onRedraw: () => void
  /** 데이터 범례 항목 — 시설목록 행 선택과 동일 */
  onLegendItemSelect?: (item: LongPipeLegendItem) => void
  /** 범례 체크 해제로 선택 해제 시 지도 하이라이트도 끔 */
  onLegendHighlightClear?: () => void
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
  minimized = false,
  pinPosition = null,
  onMinimizedChange,
  onClose,
  onRedraw,
  onLegendItemSelect,
  onLegendHighlightClear,
}: Props) {
  /** 3D는 첫 진입 후 유지 — 탭 전환마다 씬·조회 재생성 방지 (횡·종단 캐시와 동일 의도) */
  const [keepThreeJs, setKeepThreeJs] = useState(tab === 'threejs')
  useEffect(() => {
    if (tab === 'threejs') setKeepThreeJs(true)
  }, [tab])
  useEffect(() => {
    if (!lineReady) setKeepThreeJs(false)
  }, [lineReady])

  if (!open) return null

  const footer =
    tab === 'crossChart'
      ? '절단선 방향의 지반고·관로·시설과 급수구역 구성을 봅니다.'
      : tab === 'longChart'
        ? '절단 깊이축의 지반고·관로·시설과 표고별 구역·분구·블록 구성을 봅니다.'
        : '절단 구간 지형과 관로·시설을 3D로 확인합니다.'

  const sectionTitle = lineReady
    ? `절단선 ${totalLengthM.toFixed(0)} m`
    : '절단선 기준 단면'

  return (
    <MapDetailFloatingPanel
      layer="단면도"
      title={sectionTitle}
      hideTitleWhenMinimized
      minimized={minimized}
      onMinimizedChange={onMinimizedChange}
      onClose={onClose}
      pinPosition={pinPosition}
      width={SECTION_PANEL_WIDTH}
      minimizedWidth={MAP_DETAIL_FLOAT_MINIMIZED_WIDTH}
      maxHeight="94vh"
      defaultPosition={{ top: 72, right: 24 }}
      headerActions={
        <button
          type="button"
          className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded border border-border px-2 text-[11px] text-foreground hover:bg-muted"
          title="다시 그리기"
          onClick={onRedraw}
        >
          다시 그리기
        </button>
      }
    >
      <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
        {(
          [
            { id: 'crossChart' as const, label: '횡단면도' },
            { id: 'longChart' as const, label: '종단면도' },
            { id: 'threejs' as const, label: '3D' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            className={cn(
              'cursor-pointer border-b-2 px-3 py-1.5 text-xs font-medium',
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
        {tab !== 'threejs' ? (
          loading ? (
            <div className="flex h-full min-h-0 gap-2 overflow-hidden rounded border-2 border-border bg-background p-2">
              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <p className="text-center text-xs text-muted-foreground">
                  등고·시설 조회 중…
                </p>
              </div>
              <SectionFeatureLegendSkeleton />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-xs text-destructive">
              {error}
            </p>
          ) : !lineReady ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
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
              onLegendItemSelect={onLegendItemSelect}
              onLegendHighlightClear={onLegendHighlightClear}
            />
          )
        ) : !lineReady || !line3857 || line3857.length < 2 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            절단선 데이터가 없습니다.
          </p>
        ) : null}

        {(keepThreeJs || tab === 'threejs') &&
        lineReady &&
        line3857 &&
        line3857.length >= 2 ? (
          <div
            className={cn(
              'h-full min-h-0',
              tab !== 'threejs' && 'hidden'
            )}
            aria-hidden={tab !== 'threejs'}
          >
            <WtlNetworkSectionThreeJsTab
              line3857={line3857}
              enabledKeys={enabledKeys}
              onLegendItemSelect={onLegendItemSelect}
            />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        {footer}
      </div>
    </MapDetailFloatingPanel>
  )
}
