'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import tablesJson from '@/config/defineLayer/tables.json'
import {
  buildIdentifyDefineSortMetaMap,
  sortIdentifyLayersByDefineOrder,
} from '@/lib/mapLayerGeometryOrder'
import type {
  IdentifyFeatureItem,
  IdentifyLayerResult,
  IdentifyPopupState,
} from '../../_mapComponents/hooks/useFeatureIdentify'
import { extractDefineRowKeyValue } from '../../_mapComponents/standard/defineLayerRowUtils'
import {
  LAYER_CLICK_DETAIL_MATCH_CLOSE_EVENT,
  type LayerClickDetailMatchClosePayload,
} from './layerClickDetailMatchClose'

const IDENTIFY_DEFINE_SORT_META = buildIdentifyDefineSortMetaMap(
  Array.isArray(tablesJson) ? tablesJson : []
)

export type LayerClickHit = {
  key: string
  tableName: string
  /** fields/CODE 로드 키 — 분할이면 부모 물리 테이블 */
  fieldsTable: string
  korName: string
  titleValue: string
  data: Record<string, unknown>
}

export type LayerClickScreenAnchor = { top: number; left: number }

export type LayerClickKeptEntry = {
  key: string
  hits: LayerClickHit[]
  /** null = 다중 hit 목록 단계 */
  selectedKey: string | null
  anchor: LayerClickScreenAnchor | null
  stackIndex: number
  focusToken: number
  minimized: boolean
}

/** 남은 hit 기준으로 선택 키 결정 — 다중·선택 소실 시 목록(null) */
function resolveSelectedKeyAfterFilter(
  nextHits: LayerClickHit[],
  cur: string | null
): string | null {
  if (nextHits.length === 0) return null
  if (cur && nextHits.some((h) => h.key === cur)) return cur
  if (nextHits.length === 1) return nextHits[0]!.key
  return null
}

function flattenIdentifyHits(popup: IdentifyPopupState): LayerClickHit[] {
  // 1) define_table_shp_type POINT→LINE→POLYGON  2) define_table_idx
  const ordered = sortIdentifyLayersByDefineOrder(
    [...popup.results],
    IDENTIFY_DEFINE_SORT_META
  )
  const out: LayerClickHit[] = []
  ordered.forEach((layer: IdentifyLayerResult, li) => {
    const tableName = String(layer.tableName ?? '').trim()
    const korName = String(layer.korName ?? '').trim() || tableName
    const physical = String(layer.physicalTable ?? '').trim()
    const fieldsTable = physical || tableName
    layer.features.forEach((feat: IdentifyFeatureItem, fi) => {
      const data =
        feat?.data && typeof feat.data === 'object'
          ? (feat.data as Record<string, unknown>)
          : {}
      const titleValue = String(feat?.titleValue ?? '').trim()
      out.push({
        key: `${tableName}\0${li}\0${fi}`,
        tableName,
        fieldsTable,
        korName,
        titleValue,
        data,
      })
    })
  })
  return out
}

let keepModalKeySeq = 0
function nextKeepModalKey(): string {
  keepModalKeySeq += 1
  return `layer-click-keep-${keepModalKeySeq}`
}

export function useLayerClickDetail(opts?: {
  /** true면 상세를 강제로 닫음 (측정·메뉴 전환 등) */
  forceClosed?: boolean
}) {
  const forceClosed = Boolean(opts?.forceClosed)
  const forceClosedRef = useRef(forceClosed)
  forceClosedRef.current = forceClosed

  const [hits, setHits] = useState<LayerClickHit[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [focusToken, setFocusToken] = useState(0)
  /** 클릭마다 증가 — 플로팅 재마운트로 클릭 위치 반영 */
  const [placementToken, setPlacementToken] = useState(0)
  /** 클릭 화면 좌표 — 플로팅 초기 위치 */
  const [anchor, setAnchor] = useState<LayerClickScreenAnchor | null>(null)
  /** 새 창으로 분리된 킵 모달 */
  const [keptModals, setKeptModals] = useState<LayerClickKeptEntry[]>([])
  const hitsRef = useRef(hits)
  hitsRef.current = hits
  const selectedKeyRef = useRef(selectedKey)
  selectedKeyRef.current = selectedKey
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  const close = useCallback(() => {
    setHits([])
    setSelectedKey(null)
    setMinimized(false)
    setAnchor(null)
  }, [])

  const closeAll = useCallback(() => {
    close()
    setKeptModals([])
  }, [close])

  useEffect(() => {
    if (forceClosed) closeAll()
  }, [forceClosed, closeAll])

  const openFromIdentify = useCallback(
    (popup: IdentifyPopupState, screenAnchor?: LayerClickScreenAnchor | null) => {
      /** 측정·업무 전환 중 늦게 도착한 identify는 무시 */
      if (forceClosedRef.current) return
      const nextHits = flattenIdentifyHits(popup)
      if (nextHits.length === 0) {
        setHits([])
        setSelectedKey(null)
        setMinimized(false)
        setAnchor(null)
        return
      }
      setHits(nextHits)
      // 1건 → 바로 상세, 2건 이상 → 목록(선택 null)
      setSelectedKey(nextHits.length === 1 ? nextHits[0]!.key : null)
      // 최소화 유지 — 식별·데이터만 바뀌어도 자동 펼침 금지
      if (
        screenAnchor &&
        Number.isFinite(screenAnchor.top) &&
        Number.isFinite(screenAnchor.left)
      ) {
        setAnchor({ top: screenAnchor.top, left: screenAnchor.left })
      } else {
        setAnchor(null)
      }
      setFocusToken((t) => t + 1)
      setPlacementToken((t) => t + 1)
    },
    []
  )

  const selected = useMemo(
    () => (selectedKey ? hits.find((h) => h.key === selectedKey) ?? null : null),
    [hits, selectedKey]
  )

  const selectHit = useCallback((key: string) => {
    if (forceClosedRef.current) return
    setSelectedKey(key)
    setFocusToken((t) => t + 1)
  }, [])

  /** 다중 상세 → 레이어 선택 목록 */
  const backToList = useCallback(() => {
    if (forceClosedRef.current) return
    setSelectedKey(null)
    setFocusToken((t) => t + 1)
  }, [])

  /** 속성 저장 후 선택 hit data 갱신 */
  const patchSelectedHit = useCallback((hit: LayerClickHit) => {
    setHits((prev) =>
      prev.map((h) => (h.key === hit.key ? { ...h, ...hit, data: hit.data } : h))
    )
  }, [])

  /** origin = 기존(기본) 모달 좌상단 — 새 창은 그보다 약간 오른쪽 */
  const detachKeep = useCallback(
    (origin?: { top: number; left: number } | null) => {
      const curHits = hitsRef.current
      const curKey = selectedKeyRef.current
      const cur =
        curHits.find((h) => h.key === curKey) ?? curHits[0] ?? null
      if (!cur) return
      const facilityKey = cur.key
      setKeptModals((prev) => {
        const existing = prev.find((m) =>
          m.hits.some((h) => h.key === facilityKey)
        )
        if (existing) {
          return prev.map((m) =>
            m.key === existing.key
              ? {
                  ...m,
                  selectedKey: facilityKey,
                  focusToken: m.focusToken + 1,
                }
              : m
          )
        }
        const stackIndex =
          prev.reduce((max, m) => Math.max(max, m.stackIndex), -1) + 1
        const base = origin ?? anchorRef.current
        const offsetX = 28 + stackIndex * 28
        const offsetY = 14 + stackIndex * 14
        return [
          ...prev,
          {
            key: nextKeepModalKey(),
            hits:
              curHits.length > 0
                ? curHits.map((h) => ({ ...h, data: { ...h.data } }))
                : [cur],
            selectedKey: cur.key,
            anchor: base
              ? { left: base.left + offsetX, top: base.top + offsetY }
              : { left: 80 + offsetX, top: 72 + offsetY },
            stackIndex,
            focusToken: 0,
            minimized: false,
          },
        ]
      })
    },
    []
  )

  const closeKeep = useCallback((modalKey: string) => {
    setKeptModals((prev) => prev.filter((m) => m.key !== modalKey))
  }, [])

  const setKeepMinimized = useCallback((modalKey: string, next: boolean) => {
    setKeptModals((prev) =>
      prev.map((m) => (m.key === modalKey ? { ...m, minimized: next } : m))
    )
  }, [])

  const selectKeepHit = useCallback((modalKey: string, hitKey: string) => {
    setKeptModals((prev) =>
      prev.map((m) =>
        m.key === modalKey
          ? {
              ...m,
              selectedKey: hitKey,
              focusToken: m.focusToken + 1,
            }
          : m
      )
    )
  }, [])

  const backKeepToList = useCallback((modalKey: string) => {
    setKeptModals((prev) =>
      prev.map((m) =>
        m.key === modalKey
          ? {
              ...m,
              selectedKey: null,
              focusToken: m.focusToken + 1,
            }
          : m
      )
    )
  }, [])

  const closeMatchingHits = useCallback(
    (payload: LayerClickDetailMatchClosePayload) => {
      const tables = new Set(
        (payload.tableNames ?? [])
          .map((t) => String(t ?? '').trim().toLowerCase())
          .filter(Boolean)
      )
      const wantKey = String(payload.rowKey ?? '').trim()
      if (tables.size === 0 || !wantKey) return
      const keyField = payload.keyFieldName
        ? String(payload.keyFieldName).trim() || null
        : null

      const filterHits = (prev: LayerClickHit[]) =>
        prev.filter((hit) => {
          const names = [hit.tableName, hit.fieldsTable]
            .map((t) => String(t ?? '').trim().toLowerCase())
            .filter(Boolean)
          if (!names.some((n) => tables.has(n))) return true
          const hitKey = extractDefineRowKeyValue(hit.data, keyField)
          if (hitKey == null) return true
          return hitKey !== wantKey
        })

      setHits((prev) => {
        const next = filterHits(prev)
        if (next.length === prev.length) return prev
        setSelectedKey((cur) => resolveSelectedKeyAfterFilter(next, cur))
        if (next.length === 0) setMinimized(false)
        return next
      })
      setKeptModals((prev) =>
        prev
          .map((m) => {
            const nextHits = filterHits(m.hits)
            if (nextHits.length === 0) return null
            return {
              ...m,
              hits: nextHits,
              selectedKey: resolveSelectedKeyAfterFilter(nextHits, m.selectedKey),
            }
          })
          .filter((m): m is LayerClickKeptEntry => m != null)
      )
    },
    []
  )

  useEffect(() => {
    const onMatchClose = (ev: Event) => {
      const detail = (ev as CustomEvent<LayerClickDetailMatchClosePayload>).detail
      if (!detail) return
      closeMatchingHits(detail)
    }
    window.addEventListener(LAYER_CLICK_DETAIL_MATCH_CLOSE_EVENT, onMatchClose)
    return () =>
      window.removeEventListener(LAYER_CLICK_DETAIL_MATCH_CLOSE_EVENT, onMatchClose)
  }, [closeMatchingHits])

  const open = hits.length > 0 && !forceClosed

  return {
    open,
    hits,
    selected,
    minimized,
    setMinimized,
    focusToken,
    placementToken,
    anchor,
    keptModals,
    openFromIdentify,
    selectHit,
    backToList,
    patchSelectedHit,
    detachKeep,
    closeKeep,
    setKeepMinimized,
    selectKeepHit,
    backKeepToList,
    close,
    closeAll,
  }
}
