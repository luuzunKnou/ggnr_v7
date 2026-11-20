'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WtlLeakPanel } from './leak/WtlLeakPanel'
import { WtlOutagePanel } from './outage/WtlOutagePanel'
import { WtlSupplyPathPanel } from './supplyPath/WtlSupplyPathPanel'
import { WtlTopologyPanel } from './topology/WtlTopologyPanel'
import type { WtlOutageHandoffSeed } from './wtlSpatialHandoff'
import { WTL_SPATIAL_TABS, type WtlSpatialTab } from './wtlSpatialSample'

const LIST_DEFAULT = 480
const LIST_MIN = 400
const LIST_MAX = 720
/** 위상검증 요청 목록 상세 패널 (다른 메뉴 상세와 같이 목록 오른쪽에 붙음) */
const DETAIL_DEFAULT = 420
const DETAIL_MIN = 360
const DETAIL_MAX = 640

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WtlSpatialAnalysisShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [tab, setTab] = useState<WtlSpatialTab>('단수구역')
  const [outageSeed, setOutageSeed] = useState<WtlOutageHandoffSeed | null>(null)
  const [handoffSeq, setHandoffSeq] = useState(0)
  /** 위상검증 요청 목록 상세 — 열림 여부와 내용을 그릴 자리(위상검증 패널이 포털로 채움) */
  const [topoDetailOpen, setTopoDetailOpen] = useState(false)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null)
  const detailShown = tab === '위상검증' && topoDetailOpen
  const totalWidth = listWidth + (detailShown ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(totalWidth)
  }, [totalWidth, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  return (
    <div className="pointer-events-auto flex shrink-0">
      <MapSideListPanel
        width={listWidth}
        minWidth={LIST_MIN}
        maxWidth={LIST_MAX}
        leftOffsetPx={leftOffsetPx}
        onWidthChange={setListWidth}
      >
        <div className="standard-panel-root">
          <div className="standard-panel-header">
            <span className="standard-panel-title">공간분석</span>
            <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="standard-filter-section shrink-0 border-b-0">
              <div className="flex border-b border-border">
                {WTL_SPATIAL_TABS.map((name) => {
                  const on = tab === name
                  return (
                    <button
                      key={name}
                      type="button"
                      className={cn(
                        'h-7 min-w-0 flex-1 truncate border-b-2 -mb-px px-0.5 text-center text-[11px]',
                        on
                          ? 'border-primary font-semibold text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setTab(name)}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* 탭을 벗어나면 단수 잠금은 패널에서 비움 · 지도 레이어는 active로만 켬 */}
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                tab !== '단수구역' && 'hidden'
              )}
            >
              <WtlOutagePanel
                active={tab === '단수구역'}
                mapLeftPx={leftOffsetPx + listWidth}
                handoffSeed={outageSeed}
                onHandoffConsumed={(seq) => {
                  setOutageSeed((prev) => (prev?.seq === seq ? null : prev))
                }}
              />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                tab !== '누수분석' && 'hidden'
              )}
            >
              <WtlLeakPanel
                active={tab === '누수분석'}
                mapLeftPx={leftOffsetPx + listWidth}
                onHandoffToOutage={(gates, label) => {
                  const seq = handoffSeq + 1
                  setHandoffSeq(seq)
                  setOutageSeed({ seq, gates, label })
                  setTab('단수구역')
                }}
              />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                tab !== '송수경로' && 'hidden'
              )}
            >
              <WtlSupplyPathPanel active={tab === '송수경로'} />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                tab !== '위상검증' && 'hidden'
              )}
            >
              <WtlTopologyPanel
                active={tab === '위상검증'}
                mapLeftPx={leftOffsetPx + totalWidth}
                detailHost={detailShown ? detailHost : null}
                onDetailOpenChange={setTopoDetailOpen}
              />
            </div>
            {tab !== '단수구역' &&
              tab !== '누수분석' &&
              tab !== '송수경로' &&
              tab !== '위상검증' && (
                <div className="min-h-0 flex-1 bg-muted/20" aria-hidden />
              )}
          </div>
        </div>
      </MapSideListPanel>
      {detailShown && (
        <MapSideListPanel
          width={detailWidth}
          minWidth={DETAIL_MIN}
          maxWidth={DETAIL_MAX}
          leftOffsetPx={leftOffsetPx + listWidth}
          onWidthChange={setDetailWidth}
          contentClassName="overflow-hidden"
        >
          {/* 내용은 위상검증 패널이 포털로 그린다(요청 데이터를 그쪽이 가지고 있음) */}
          <div ref={setDetailHost} className="flex min-h-0 flex-1 flex-col" />
        </MapSideListPanel>
      )}
    </div>
  )
}
