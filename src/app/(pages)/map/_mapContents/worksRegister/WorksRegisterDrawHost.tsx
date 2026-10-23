'use client'

import { useRef } from 'react'
import { Circle as CircleIcon, Pentagon, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/app/shadcnComponents/ui/button'
import {
  DrawToolbarActions,
  useDrawToolbarPosition,
} from '../../_mapComponents/analysisArea'
import { useMapContext } from '../../_mapComponents/MapContext'
import type { WorksRegisterDrawTool } from './useWorksRegisterDrawSession'
import type { DrawToolbarMapAnchor } from '../../_mapComponents/analysisArea'

const DRAW_TOOLS: { id: WorksRegisterDrawTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: CircleIcon, label: '원' },
]

type Props = {
  toolPickerOpen: boolean
  drawTool: WorksRegisterDrawTool | null
  drawPhase: 'drawing' | 'editing'
  drawToolbarAnchor: DrawToolbarMapAnchor | null
  onCloseToolPicker: () => void
  onStartDraw: (tool: WorksRegisterDrawTool) => void
  onConfirmDraw: () => void
  onRedrawShape: () => void
  onCancelDraw: () => void
}

/** 도구 선택 패널(인라인) + 지도 위 그리기 툴바 — 필지분석 도형 절차와 동일 */
export function WorksRegisterDrawHost({
  toolPickerOpen,
  drawTool,
  drawPhase,
  drawToolbarAnchor,
  onCloseToolPicker,
  onStartDraw,
  onConfirmDraw,
  onRedrawShape,
  onCancelDraw,
}: Props) {
  const mapContext = useMapContext()
  const drawToolbarRef = useRef<HTMLDivElement>(null)
  const editingToolbarActive = drawTool != null && drawPhase === 'editing' && drawToolbarAnchor != null
  const toolbarPlacement = useDrawToolbarPosition(
    mapContext?.mapInstanceRef ?? { current: null },
    drawToolbarAnchor,
    drawToolbarRef,
    editingToolbarActive
  )

  return (
    <>
      {toolPickerOpen && drawTool == null && (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 z-[1200] w-[min(100vw-2rem,22rem)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-800">사업구역 그리기</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCloseToolPicker}
            >
              닫기
            </Button>
          </div>
          <p className="mb-2 text-[10px] text-slate-500">도형 도구를 선택한 뒤 지도에 그립니다.</p>
          <div className="grid grid-cols-3 gap-1.5">
            {DRAW_TOOLS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onStartDraw(t.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border border-slate-200 px-2 py-2.5',
                    'text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50'
                  )}
                >
                  <Icon className="h-5 w-5 text-slate-700" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {drawTool != null && (
        <>
          {drawPhase === 'drawing' ? (
            <div className="pointer-events-none fixed inset-x-0 top-4 z-[1200] flex flex-col items-center gap-2">
              <DrawToolbarActions
                drawPhase={drawPhase}
                confirmDraw={onConfirmDraw}
                redrawShape={onRedrawShape}
                cancelDraw={onCancelDraw}
              />
            </div>
          ) : (
            <div
              ref={drawToolbarRef}
              className="pointer-events-none fixed z-[1200] flex flex-col items-start gap-2"
              style={
                toolbarPlacement
                  ? { left: toolbarPlacement.left, top: toolbarPlacement.top }
                  : { left: '50%', top: 16, transform: 'translateX(-50%)' }
              }
            >
              <DrawToolbarActions
                drawPhase={drawPhase}
                confirmDraw={onConfirmDraw}
                redrawShape={onRedrawShape}
                cancelDraw={onCancelDraw}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
