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

  useEffect(() => {
    onTotalWidthChange(listWidth)
  }, [listWidth, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  return (
    <div className="pointer-events-auto shrink-0">
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
            {/* 탭 전환 시에도 이력 유지 · 지도 레이어는 active로만 켬 */}
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                tab !== '단수구역' && 'hidden'
              )}
            >
              <WtlOutagePanel
                active={tab === '단수구역'}
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
              <WtlSupplyPathPanel
                active={tab === '송수경로'}
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
                tab !== '위상검증' && 'hidden'
              )}
            >
              <WtlTopologyPanel active={tab === '위상검증'} />
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
    </div>
  )
}
