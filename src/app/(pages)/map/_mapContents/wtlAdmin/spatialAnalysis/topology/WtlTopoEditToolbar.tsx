'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Crosshair,
  FilePenLine,
  MapPinPlus,
  Pencil,
  Repeat,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { mapToolbarTopPx } from '../../../../_mapComponents/mapTopHintLayout'
import { useMapToolbarDrag } from '../useMapToolbarDrag'
import {
  WTL_TOPO_ADD_FACILITY_KINDS,
  WTL_TOPO_ADD_PIPE_KINDS,
  type WtlTopoAddFacilityKindId,
  type WtlTopoAddPipeKindId,
} from './wtlTopologySample'

/** 지도 도구모음 모드. flip = 지도에서 관로를 골라 유수방향 반전 */
export type WtlTopoMapTool = 'idle' | 'modify' | 'draw_line' | 'draw_point' | 'flip'

export type WtlTopoToolbarAction =
  | 'modify'
  | 'draw_line'
  | 'draw_point'
  | 'flip'
  | 'request'
  | 'reverse_dir'
  /** 수정: 대상 다시 고르기 */
  | 'repick'
  | 'save'
  | 'cancel'

type Props = {
  active: boolean
  /** 지도 왼쪽을 덮는 메뉴·패널 오른쪽 끝(px) — 도구모음 가운데 정렬·이동 제한용 */
  mapLeftPx: number
  tool: WtlTopoMapTool
  busy: boolean
  canSave: boolean
  /** 모드 사용 중 안내 (예: «지도에서 관로를 클릭하세요», «관로 #12 수정 중») */
  status: string
  saveLabel: string
  pipeKind: WtlTopoAddPipeKindId
  pipeColor?: string
  pipeReverse: boolean
  hasDraft: boolean
  facilityKind: WtlTopoAddFacilityKindId
  /** 수정 대상 이름 (예: 관로 #123). 없으면 지도에서 고르는 중 */
  modifyTargetLabel?: string | null
  /** 방향 모드에서 고른 관로 수 */
  flipCount?: number
  onAction: (action: WtlTopoToolbarAction) => void
  onPipeKind: (id: WtlTopoAddPipeKindId) => void
  onFacilityKind: (id: WtlTopoAddFacilityKindId) => void
}

const ACTIONS: readonly WtlTopoToolbarAction[] = [
  'modify',
  'draw_line',
  'draw_point',
  'flip',
  'request',
  'reverse_dir',
  'repick',
  'save',
  'cancel',
]

/**
 * 위상검증 지도 편집 도구모음 — 수정·관로 추가·시설 추가·지도에서 고르는 방향 반전·수정요청.
 * 오류를 고르지 않아도 쓸 수 있다(없는 관로·시설을 추가하는 용도).
 * 누수분석 도구모음과 같은 알약 모양 · 손잡이로 끌어 이동(더블클릭: 원위치).
 * 지도 이벤트를 막기 위해 네이티브 리스너로 클릭을 처리한다(버튼은 data-edit로 구분).
 */
export function WtlTopoEditToolbar({
  active,
  mapLeftPx,
  tool,
  busy,
  canSave,
  status,
  saveLabel,
  pipeKind,
  pipeColor,
  pipeReverse,
  hasDraft,
  facilityKind,
  modifyTargetLabel = null,
  flipCount = 0,
  onAction,
  onPipeKind,
  onFacilityKind,
}: Props) {
  const mapContext = useMapContext()
  const barRef = useRef<HTMLDivElement>(null)
  const onActionRef = useRef(onAction)
  useEffect(() => {
    onActionRef.current = onAction
  })

  const map = mapContext?.mapInstanceRef?.current
  const host = map?.getViewport()
  const visible = Boolean(active && host)

  // 도구모음 위 마우스·휠 이벤트가 지도로 새지 않게 막고, 버튼 클릭을 처리한다
  useEffect(() => {
    const el = barRef.current
    if (!visible || !el) return
    const stop = (event: Event) => event.stopPropagation()
    const onClick = (event: Event) => {
      event.stopPropagation()
      const btn = (event.target as HTMLElement).closest('button')
      if (!btn || btn.disabled) return
      const action = btn.getAttribute('data-edit') as WtlTopoToolbarAction | null
      if (action && ACTIONS.includes(action)) onActionRef.current(action)
    }
    const types = ['pointerdown', 'pointerup', 'pointermove', 'dblclick', 'mousedown', 'mouseup', 'wheel', 'contextmenu']
    for (const type of types) el.addEventListener(type, stop)
    el.addEventListener('click', onClick)
    return () => {
      for (const type of types) el.removeEventListener(type, stop)
      el.removeEventListener('click', onClick)
    }
  }, [visible])

  const dragMinX = host ? Math.max(0, mapLeftPx - host.getBoundingClientRect().left) : 0
  const { handleRef: dragHandleRef, barStyle, moved } = useMapToolbarDrag(host, barRef, visible, dragMinX)
  if (!visible || !host) return null
  const menuRight = Math.max(0, mapLeftPx - host.getBoundingClientRect().left)
  const center = menuRight + Math.max(0, host.clientWidth - menuRight) / 2
  const toolbarTopPx = mapToolbarTopPx(Boolean(mapContext?.cadastralZoomHintVisible))

  // 누수분석·단수구역 도구모음과 같은 알약(pill) 톤 — 한 줄, 같은 버튼·구분선·완료 버튼
  const pillShell =
    'pointer-events-auto absolute z-30 flex -translate-x-1/2 flex-col rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur'

  const modeBtn = (id: Exclude<WtlTopoMapTool, 'idle'>, label: string, Icon: LucideIcon, title: string) => (
    <button
      type="button"
      data-edit={id}
      aria-pressed={tool === id}
      disabled={busy}
      title={title}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors disabled:cursor-default disabled:opacity-40 sm:text-sm',
        tool === id
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )

  const iconBtn = (id: WtlTopoToolbarAction, label: string, Icon: LucideIcon, disabled = false, pressed?: boolean) => (
    <button
      type="button"
      data-edit={id}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40',
        pressed
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )

  // 알약 안의 종류 선택 — 모드 버튼과 같은 높이·톤
  const selectCls =
    'h-7 cursor-pointer rounded-full border-0 bg-muted px-2.5 text-[12px] font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:text-sm'

  const divider = <span className="h-5 w-px bg-border" aria-hidden />

  /** 모드 안내 칩 — 모드 버튼보다 한 단계 옅은 톤(눌리는 버튼이 아님) */
  const chip = (text: string, title?: string) => (
    <span
      title={title ?? text}
      className="max-w-[12rem] truncate rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground sm:text-sm"
    >
      {text}
    </span>
  )

  const MODE_META: Record<Exclude<WtlTopoMapTool, 'idle'>, { label: string; Icon: LucideIcon }> = {
    modify: { label: '수정', Icon: Pencil },
    draw_line: { label: '관로', Icon: Waypoints },
    draw_point: { label: '시설', Icon: MapPinPlus },
    flip: { label: '방향', Icon: ArrowLeftRight },
  }

  /** 모드별로 필요한 기능만 */
  const modeOptions = () => {
    if (tool === 'modify') {
      return modifyTargetLabel ? (
        <>
          {chip(modifyTargetLabel)}
          {iconBtn('repick', '수정할 대상 다시 고르기', Crosshair, busy)}
        </>
      ) : (
        chip('지도에서 대상 클릭')
      )
    }
    if (tool === 'draw_line') {
      return (
        <>
          <span
            aria-hidden="true"
            className="h-1 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: pipeColor ?? '#2563eb' }}
          />
          <label className="sr-only" htmlFor="wtl-topo-tb-pipe-kind">
            추가할 관로 종류
          </label>
          <select
            id="wtl-topo-tb-pipe-kind"
            className={selectCls}
            value={pipeKind}
            onChange={(e) => onPipeKind(e.target.value as WtlTopoAddPipeKindId)}
          >
            {WTL_TOPO_ADD_PIPE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          {iconBtn('reverse_dir', '그린 선의 유수방향 반전 (지도 화살표로 확인)', Repeat, !hasDraft || busy, pipeReverse)}
        </>
      )
    }
    if (tool === 'draw_point') {
      return (
        <>
          <label className="sr-only" htmlFor="wtl-topo-tb-facility-kind">
            추가할 시설 종류
          </label>
          <select
            id="wtl-topo-tb-facility-kind"
            className={selectCls}
            value={facilityKind}
            onChange={(e) => onFacilityKind(e.target.value as WtlTopoAddFacilityKindId)}
          >
            {WTL_TOPO_ADD_FACILITY_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </>
      )
    }
    if (tool === 'flip') {
      return chip(flipCount > 0 ? `${flipCount}개 선택` : '지도에서 관로 클릭')
    }
    return null
  }

  return createPortal(
    <div
      ref={barRef}
      className={pillShell}
      style={{
        ...barStyle(center),
        ...(moved ? {} : { top: toolbarTopPx }),
      }}
      role="toolbar"
      aria-label="위상검증 편집 도구"
    >
      {/* 위쪽 손잡이 띠 — 폭 전체를 잡고 끌어 이동, 더블클릭하면 원위치 */}
      <span
        ref={dragHandleRef}
        role="button"
        tabIndex={-1}
        aria-label="도구모음 이동 (끌기 · 더블클릭: 원위치)"
        title="끌어서 이동 · 더블클릭하면 원위치"
        className="group flex h-3 w-full shrink-0 cursor-grab touch-none items-end justify-center"
      >
        <span className="h-1 w-9 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/70" />
      </span>
      {tool === 'idle' ? (
        // 전체 메뉴
        <div className="flex items-center gap-2 pt-1 pr-2.5 pb-2 pl-4">
          {modeBtn('modify', '수정', Pencil, '관로·시설 도형 수정 (선택한 오류 또는 지도에서 클릭)')}
          {modeBtn('draw_line', '관로', Waypoints, '관로 추가')}
          {modeBtn('draw_point', '시설', MapPinPlus, '시설 추가')}
          {modeBtn('flip', '방향', ArrowLeftRight, '지도에서 관로를 골라 유수방향 반전')}
          {divider}
          {iconBtn('request', '데이터 수정요청', FilePenLine, busy)}
        </div>
      ) : (
        // 모드 화면: ← 기능명 | 그 기능에 필요한 것 | 완료
        <div className="flex items-center gap-2 pt-1 pr-2.5 pb-2 pl-2.5">
          {iconBtn('cancel', '뒤로 (편집 취소, 전체 메뉴로)', ArrowLeft, busy)}
          {/* 현재 기능명 — 모드 버튼과 같은 모양이지만 눌리지 않는다(나가기는 ← 버튼) */}
          {(() => {
            const { label, Icon } = MODE_META[tool]
            return (
              <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground sm:text-sm">
                <Icon className="size-3.5" />
                {label}
              </span>
            )
          })()}
          {divider}
          {modeOptions()}
          {divider}
          {/* 안내 문구는 화면 낭독기로만 — 눈에 보이는 안내는 왼쪽 패널 알림에 나온다 */}
          <span className="sr-only" aria-live="polite">
            {status}
          </span>
          <button
            type="button"
            data-edit="save"
            disabled={!canSave || busy}
            title={status}
            className="flex cursor-pointer items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-40 sm:text-sm"
          >
            <Check className="size-3.5" />
            {saveLabel}
          </button>
        </div>
      )}
    </div>,
    host
  )
}
