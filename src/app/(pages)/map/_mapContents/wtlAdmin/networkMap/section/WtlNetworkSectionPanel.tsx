'use client'

import { X } from 'lucide-react'
import { MapFloatingPanel } from '../../../../_mapComponents/MapFloatingPanel'
import { cn } from '@/lib/utils'
import type { SectionTab } from './useWtlNetworkSection'
import {
  WtlNetworkSectionSvg,
  type SectionFeatureMark,
  type SectionGroundPt,
  type SectionSupplyAreaLine,
  type SectionSupplyBandSegment,
} from './wtlNetworkSectionSvg'
import type { SectionSupplyElevRow } from './useWtlNetworkSection'
import { WtlNetworkSectionThreeJsTab } from './WtlNetworkSectionThreeJsTab'
import { WtlNetworkSectionChart } from './wtlNetworkSectionChart'

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
  lineLonLat,
  line3857 = null,
  enabledKeys = [],
  supplyAreaLines: _supplyAreaLines = [],
  supplyAreaBands = [],
  supplyElevComposition = [],
  onClose,
  onRedraw,
}: Props) {
  if (!open) return null

  const footer =
    tab === 'cross'
      ? '횡단: 레거시 횡단면도와 동일(개략 지표면·심도·관경 원). 켜진 레이어만.'
      : tab === 'long'
        ? '종단: 밑변=절단선, X=옆면(깊이), 사각형 안 표고·관. 켜진 레이어만.'
        : tab === 'crossChart'
          ? '횡단(차트): Chart.js 지형 선·관/시설 점·하단 간트. 켜진 레이어만.'
          : tab === 'longChart'
            ? '종단(차트): 지형·관 + 표고별 구역/분구/블록 구성 비율 차트 비교. 켜진 레이어만.'
            : tab === 'threejs'
              ? 'ThreeJs: 지형(단면도) + 켜진 레이어 도형으로 CAD 종·횡단 생성.'
              : '기존: 작업 전 예시 지형 SVG(원본 모달과 동일).'

  return (
    <MapFloatingPanel
      viewport
      width="min(1100px, calc(100vw - 2rem))"
      maxHeight="94vh"
      defaultPosition={{ top: 72, right: 24 }}
      /** 시설목록 상세보기(z=10050)보다 위 */
      style={{ zIndex: 10100 }}
      header={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
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
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted"
            title="닫기"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          {(
            [
              { id: 'cross' as const, label: '횡단면도' },
              { id: 'long' as const, label: '종단면도' },
              { id: 'crossChart' as const, label: '횡단면도(차트형태)' },
              { id: 'longChart' as const, label: '종단면도(차트형태)' },
              { id: 'threejs' as const, label: 'ThreeJs' },
              { id: 'prev' as const, label: '기존' },
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

        <div className="min-h-0 flex-1 overflow-auto p-3">
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
            <div className="flex min-h-[560px] items-center justify-center">
              <p className="text-center text-[12px] text-muted-foreground">
                등고·시설 조회 중…
              </p>
            </div>
          ) : error ? (
            <p className="py-10 text-center text-[12px] text-destructive">{error}</p>
          ) : !lineReady ? (
            <p className="py-10 text-center text-[12px] text-muted-foreground">절단선 데이터가 없습니다.</p>
          ) : tab === 'crossChart' || tab === 'longChart' ? (
            <WtlNetworkSectionChart
              mode={tab}
              ground={ground}
              groundMin={groundMin}
              groundMax={groundMax}
              features={features}
              totalLengthM={totalLengthM}
              supplyAreaBands={supplyAreaBands}
              supplyElevComposition={supplyElevComposition}
            />
          ) : (
            <WtlNetworkSectionSvg
              mode={tab}
              ground={ground}
              groundMin={groundMin}
              groundMax={groundMax}
              features={features}
              totalLengthM={totalLengthM}
              lineLonLat={lineLonLat}
              supplyAreaBands={supplyAreaBands}
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
