'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Building2, Check, Eraser, Pencil, RotateCcw, Undo2, type LucideIcon } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { useMapToolbarDrag } from '../useMapToolbarDrag'
import { outagePolygonsOf, type WtlOutageResult } from './wtlOutageSample'
import type { OutageEditMode, ZoneBody } from './wtlOutageEditShared'
import {
  useOutageDrawEdit,
  type OutageDrawEditRefs,
  type OutageZoneEditOp,
  type OutageZoneEditOptions,
} from './useOutageDrawEdit'
// 선 편집·버퍼 기능은 백업 보관(useOutageLineEdit·useOutageBufferEdit) — 현재는 그리기·지우기·건물만 사용

export type { OutageEditMode } from './wtlOutageEditShared'
/** 되돌리기 최대 단계 */
const UNDO_MAX = 50


type Props = {
  active: boolean
  mapLeftPx?: number
  result: WtlOutageResult | null
  mode: OutageEditMode
  onMode: (mode: OutageEditMode) => void
  onChange: (next: WtlOutageResult) => void
  onNotice: (msg: string) => void
}

/**
 * 단수구역 지도 편집 도구모음 (누수분석 그리기 도구모음과 같은 UI)
 * - 그리기: 그린 다각형만큼 단수 면에 합침 / 지우기: 그린 만큼 뺌(구멍 가능) / 건물: 클릭한 건물군 합침
 * - 되돌리기(Ctrl+Z): 직전 편집 전으로 / 초기화: 분석 직후(편집 전) 상태로
 * 면이 바뀌면 서버에서 그 면 안의 수용가·도로명주소·필지를 다시 조회한다.
 */
export function WtlOutageResultEdit({
  active,
  mapLeftPx = 0,
  result,
  mode,
  onMode,
  onChange,
  onNotice,
}: Props) {
  const mapContext = useMapContext()
  const [busy, setBusy] = useState(false)
  const modeRef = useRef(mode)
  const resultRef = useRef(result)
  const onChangeRef = useRef(onChange)
  const onNoticeRef = useRef(onNotice)
  const onModeRef = useRef(onMode)
  const barRef = useRef<HTMLDivElement>(null)
  const applyShapeRef = useRef<
    (op: OutageZoneEditOp, shape: [number, number][], label: string, opts?: OutageZoneEditOptions) => void
  >(() => undefined)
  const seqRef = useRef(0)
  const draggingRef = useRef(false)
  /** 진행 중인 끌기 취소(반영 없음) — 각 편집 effect가 등록 */
  const cancelDragsRef = useRef(new Set<() => void>())
  /** 편집 전 상태 스냅샷(되돌리기용) */
  const undoRef = useRef<WtlOutageResult[]>([])
  /** 분석·이력 불러오기 직후 결과(초기화 기준) */
  const baselineRef = useRef<WtlOutageResult | null>(null)
  /** 이 컴포넌트가 onChange로 내보낸 결과 — 이게 아니면 외부(새 분석·이력)에서 바뀐 것 */
  const emittedRef = useRef<WtlOutageResult | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  /** 초기화 기준(baseline)과 다른 결과인지 — 초기화 버튼 활성화용 */
  const [changed, setChanged] = useState(false)
  // 최신 props를 ref에 반영(렌더 중이 아니라 커밋 직후) — 지도·키보드 이벤트 핸들러가 읽음
  useLayoutEffect(() => {
    modeRef.current = mode
    resultRef.current = result
    onChangeRef.current = onChange
    onNoticeRef.current = onNotice
    onModeRef.current = onMode
  })


  const emit = (next: WtlOutageResult) => {
    emittedRef.current = next
    resultRef.current = next
    setChanged(next !== baselineRef.current)
    onChangeRef.current(next)
  }

  const pushUndo = (snapshot: WtlOutageResult) => {
    const stack = undoRef.current
    stack.push(snapshot)
    if (stack.length > UNDO_MAX) stack.shift()
    setUndoCount(stack.length)
  }

  /** 진행 중인 재계산을 버리고 스냅샷으로 복원(서버 호출 없음 — 면·대상 목록도 함께 저장돼 있음) */
  const restore = (snapshot: WtlOutageResult, label: string) => {
    if (draggingRef.current) return
    seqRef.current += 1
    setBusy(false)
    emit(snapshot)
    onNoticeRef.current(
      `${label} · 수용가 ${snapshot.customers.length} · 필지 ${snapshot.parcels.length}`
    )
  }

  const undoRefFn = useRef<() => void>(() => undefined)
  const resetRefFn = useRef<() => void>(() => undefined)
  const undo = () => {
    const prev = undoRef.current.pop()
    setUndoCount(undoRef.current.length)
    if (!prev) {
      onNoticeRef.current('되돌릴 편집이 없습니다.')
      return
    }
    restore(prev, '되돌리기')
  }
  const reset = () => {
    const base = baselineRef.current
    const current = resultRef.current
    if (!base || !current || current === base) return
    // 초기화도 되돌리기로 취소할 수 있게 현재 상태를 쌓아 둔다
    pushUndo(current)
    restore(base, '초기화')
  }

  // 외부에서 결과가 바뀌면(새 분석·이력 불러오기·도형 적용) 그 결과를 새 기준으로
  useEffect(() => {
    if (result && result === emittedRef.current) return
    baselineRef.current = result
    emittedRef.current = null
    undoRef.current = []
    // 외부 결과(새 분석·이력 불러오기)가 들어올 때만 한 번 초기화 — 연쇄 렌더 없음
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUndoCount(0)
    setChanged(false)
  }, [result])

  // Ctrl+Z / Cmd+Z 되돌리기 (입력창 포커스 중이면 무시) · ESC 모드 취소
  const hasResult = Boolean(result)
  useEffect(() => {
    if (!active || !hasResult) return
    const onKey = (event: KeyboardEvent) => {
      // ESC: 그리기·지우기·건물 모드면 진행 중인 끌기를 반영 없이 취소하고 모드 종료
      if (event.key === 'Escape') {
        if (!modeRef.current && !draggingRef.current) return
        event.preventDefault()
        for (const cancel of [...cancelDragsRef.current]) cancel()
        onModeRef.current(null)
        onNoticeRef.current('편집 모드를 취소했습니다.')
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (undoRef.current.length === 0) return
      event.preventDefault()
      undoRefFn.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, hasResult])

  /**
   * 그린 도형을 단수 면에 합치거나(union) 빼기(difference) — 서버가 면을 계산(구멍 포함)하고
   * 그 면 기준으로 수용가·도로명주소·필지를 재조회. 되돌리기 스택에 직전 상태를 쌓는다.
   */
  const applyShape = (
    op: OutageZoneEditOp,
    shape: [number, number][],
    label: string,
    opts?: OutageZoneEditOptions
  ) => {
    const current = resultRef.current
    if (!current || shape.length < 4) return
    const seq = ++seqRef.current
    setBusy(true)
    void call('', 'POST', {
      service: 'wtlOutageService',
      action: 'editWtlOutageZone',
      params: {
        polygons: outagePolygonsOf(current),
        op,
        shape,
        keepPipes: opts?.keepPipes,
        keepExclude: opts?.keepExclude,
      },
    })
      .then((res: unknown) => {
        if (seq !== seqRef.current) return
        const body = ((res as { data?: ZoneBody })?.data ?? res) as ZoneBody
        if (body.error || !body.polygons || body.polygons.length === 0) {
          onNoticeRef.current(body.error || '단수 면을 바꾸지 못했습니다.')
          return
        }
        const base = resultRef.current ?? current
        pushUndo(base)
        const rings = body.polygons.map((p) => p[0]!)
        emit({
          ...base,
          polygons: body.polygons,
          rings,
          ring: rings[0]!,
          customers: body.customers ?? [],
          addresses: body.addresses ?? [],
          parcels: body.parcels ?? [],
        })
        onNoticeRef.current(
          `${label} · 수용가 ${(body.customers ?? []).length} · 필지 ${(body.parcels ?? []).length}`
        )
      })
      .catch(() => {
        if (seq === seqRef.current) onNoticeRef.current('단수 면 편집에 실패했습니다.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }
  useLayoutEffect(() => {
    undoRefFn.current = undo
    resetRefFn.current = reset
    applyShapeRef.current = applyShape
  })

  // 도구모음 버튼 (지도 이벤트로 새지 않게 네이티브 리스너)
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const stop = (event: Event) => event.stopPropagation()
    const onClick = (event: Event) => {
      event.stopPropagation()
      const action = (event.target as HTMLElement).closest('button')?.getAttribute('data-edit')
      if (action === 'done') onModeRef.current(null)
      else if (action === 'undo') undoRefFn.current()
      else if (action === 'reset') resetRefFn.current()
      else if (action === 'draw' || action === 'erase' || action === 'building') {
        const next = modeRef.current === action ? null : action
        onModeRef.current(next)
        if (next === 'draw') {
          onNoticeRef.current('그리기: 클릭으로 점을 찍고 더블클릭으로 끝내면 그 영역을 단수 면에 합칩니다. Shift+끌기는 자유곡선.')
        } else if (next === 'erase') {
          onNoticeRef.current('지우기: 그린 영역만큼 단수 면에서 뺍니다. 가운데를 그리면 구멍이 됩니다.')
        } else if (next === 'building') {
          onNoticeRef.current('건물: 클릭하면 그 건물군을 단수 면에 합치고, Alt+클릭하면 뺍니다(이미 포함된 건물군은 흐리게 표시).')
        }
      }
    }
    const types = ['pointerdown', 'pointerup', 'pointermove', 'dblclick', 'mousedown', 'mouseup', 'wheel', 'contextmenu'] as const
    for (const type of types) el.addEventListener(type, stop)
    el.addEventListener('click', onClick)
    return () => {
      for (const type of types) el.removeEventListener(type, stop)
      el.removeEventListener('click', onClick)
    }
  })

  // 그리기·지우기·건물 합치기 — 별도 훅
  const drawRefs: OutageDrawEditRefs = { resultRef, onNoticeRef, draggingRef, cancelDragsRef, applyShapeRef }
  useOutageDrawEdit({ active, hasResult, mode, refs: drawRefs, zoneKey: result?.polygons ?? result?.rings })

  const map = mapContext?.mapInstanceRef?.current
  const host = map?.getViewport()
  // 패널(메뉴+목록) 오른쪽 끝 — 도구모음이 패널 뒤로 숨지 않게
  const dragMinX = host ? Math.max(0, mapLeftPx - host.getBoundingClientRect().left) : 0
  const { handleRef: dragHandleRef, barStyle } = useMapToolbarDrag(
    host,
    barRef,
    Boolean(active && result && host),
    dragMinX
  )
  if (!active || !result || !host) return null
  const hostLeft = host.getBoundingClientRect().left
  const menuRight = Math.max(0, mapLeftPx - hostLeft)
  const center = menuRight + Math.max(0, host.clientWidth - menuRight) / 2

  const pillShell =
    'pointer-events-auto absolute top-20 z-30 flex -translate-x-1/2 flex-col rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur'

  const toggleBtn = (id: 'draw' | 'erase' | 'building', label: string, Icon: LucideIcon) => (
    <button
      type="button"
      data-edit={id}
      aria-pressed={mode === id}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors sm:text-sm',
        mode === id
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )


  const iconBtn = (id: 'undo' | 'reset', label: string, Icon: LucideIcon, disabled: boolean) => (
    <button
      type="button"
      data-edit={id}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="size-3.5" />
    </button>
  )

  return createPortal(
    <div ref={barRef} className={pillShell} style={barStyle(center)}>
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
      <div className="flex items-center gap-2 pt-1 pr-2.5 pb-2 pl-4">
      {toggleBtn('draw', '그리기', Pencil)}
      {toggleBtn('erase', '지우기', Eraser)}
      {toggleBtn('building', '건물', Building2)}
      <span className="h-5 w-px bg-border" aria-hidden />
      {iconBtn('undo', `되돌리기 (Ctrl+Z)${undoCount > 0 ? ` · ${undoCount}단계` : ''}`, Undo2, undoCount === 0)}
      {iconBtn('reset', '초기화 (분석 직후 상태로)', RotateCcw, !changed)}
      {busy && <span className="text-[11px] text-muted-foreground">계산중…</span>}
      <button
        type="button"
        data-edit="done"
        className="flex cursor-pointer items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:text-sm"
      >
        <Check className="size-3.5" />
        완료
      </button>
      </div>
    </div>,
    host
  )
}
