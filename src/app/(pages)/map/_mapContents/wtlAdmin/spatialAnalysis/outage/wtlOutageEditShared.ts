/**
 * 단수구역 지도 편집(선 편집·버퍼) 공통 상수·유틸.
 * WtlOutageResultEdit(도구모음·되돌리기·재계산)와 useOutageLineEdit·useOutageBufferEdit가 함께 쓴다.
 */
import type { MutableRefObject } from 'react'
import DragPan from 'ol/interaction/DragPan'
import { Polygon } from 'ol/geom'
import '../../../../_mapComponents/config/projections'
import { locate, to3857 } from '../leak/WtlLeakResultEdit'
import type { Pt } from './wtlOutageEditNet'
import { OUTAGE_ZONE_BUFFER_DEFAULT_M, type WtlOutageResult } from './wtlOutageSample'

/** draw·erase·building: 단수 면 그리기·지우기·건물 합치기(현재 사용). line·buffer: 백업 보관 중인 선 편집·버퍼 훅용 */
export type OutageEditMode = 'draw' | 'erase' | 'building' | 'line' | 'buffer' | null

/** 서버 ZONE_BUFFER_MIN_M과 같게 — 수용가 없는 단수(1m) 결과도 편집 후 유지 */
export const BUFFER_MIN_M = 1
export const BUFFER_MAX_M = 200
/** 버퍼 끌기: 마우스가 멈추면 이만큼 뒤 서버에서 정확한 면 계산(움직이는 동안은 즉시 미리보기) */
export const PREVIEW_DELAY_MS = 250
/** 버퍼 끌기 중 기존 단수 면 레이어 투명도(줄어드는 범위가 보이게) */
export const DIM_ZONE_OPACITY = 0.3
/** 결과선 끝점끼리 이어진 것으로 볼 거리(이 끝점은 핸들 없음) */
export const END_JOIN_M = 1.5
/** 줄였을 때 이보다 짧게 남으면 선을 통째로 뺀다 */
export const MIN_KEEP_M = 2
/** 늘이기 시작점: 선 끝이 관망에서 이 거리 안이어야 함 */
export const START_ON_NET_M = 4
/** 버퍼 외곽선 스냅 거리(px) */
export const OUTLINE_SNAP_PX = 10
/** 단수선 중간을 잡아 새 분기를 낼 때 스냅 거리(px) */
export const BRANCH_SNAP_PX = 8
/** 분기 시작점에서 접합점까지 기존 단수선을 따라갈 때 비용 배수(옆 관로를 우선) */
export const BRANCH_COVERED_COST = 20

export type Line3857 = Pt[]

export type ZoneBody = {
  ring?: [number, number][]
  rings?: [number, number][][]
  /** 단수 면(구멍 포함) */
  polygons?: [number, number][][][]
  bufferM?: number
  customers?: WtlOutageResult['customers']
  addresses?: WtlOutageResult['addresses']
  parcels?: WtlOutageResult['parcels']
  error?: string
}

export function clampBuffer(v: number) {
  return Math.min(BUFFER_MAX_M, Math.max(BUFFER_MIN_M, Math.round(v)))
}

export function ringsToPolygons(rings: [number, number][][]): Polygon[] {
  const out: Polygon[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const coords = ring.map(to3857)
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first)
    out.push(new Polygon([coords]))
  }
  return out
}

/** 선별 버퍼(없으면 결과 기본 버퍼) */
export function buffersOf(result: WtlOutageResult): number[] {
  const base = result.bufferM ?? OUTAGE_ZONE_BUFFER_DEFAULT_M
  return result.pipes.map((_, i) => result.lineBuffers?.[i] ?? base)
}


/** 외곽선 점 p를 만드는 선 = (선까지 거리 − 그 선 버퍼)가 가장 작은 선 */
export function lineOwningOutline(p: Pt, lines: Line3857[], buffers: number[]): number {
  let best = -1
  let bestGap = Infinity
  lines.forEach((line, i) => {
    const gap = locate(p[0], p[1], line).dist - (buffers[i] ?? OUTAGE_ZONE_BUFFER_DEFAULT_M)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  })
  return best
}

export const setPanActive = (map: { getInteractions: () => { getArray: () => unknown[] } }, enabled: boolean) => {
  for (const item of map.getInteractions().getArray()) {
    if (item instanceof DragPan || (item as { constructor?: { name?: string } }).constructor?.name === 'DragPan') {
      ;(item as DragPan).setActive(enabled)
    }
  }
}

/** 편집 훅들이 도구모음 컴포넌트와 공유하는 ref 묶음 */
export type OutageEditRefs = {
  modeRef: MutableRefObject<OutageEditMode>
  resultRef: MutableRefObject<WtlOutageResult | null>
  onNoticeRef: MutableRefObject<(msg: string) => void>
  /** 관로·선별 버퍼 변경 → 결과 반영 + 서버 재계산(되돌리기 스택 포함) */
  recomputeRef: MutableRefObject<(pipes: [number, number][][], buffers: number[], label: string) => void>
  /** 끌기 중이면 true — 되돌리기·핸들 갱신을 막음 */
  draggingRef: MutableRefObject<boolean>
  /** 진행 중 끌기를 반영 없이 취소하는 함수들(ESC) — 각 훅이 등록·해제 */
  cancelDragsRef: MutableRefObject<Set<() => void>>
}

