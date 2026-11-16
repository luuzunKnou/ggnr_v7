'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function flattenIdentifyHits(popup: IdentifyPopupState): LayerClickHit[] {
  const ordered = [...popup.results].sort((a, b) => {
    const as = a.isSplitLayer ? 0 : 1
    const bs = b.isSplitLayer ? 0 : 1
    return as - bs
  })
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

  const close = useCallback(() => {
    setHits([])
    setSelectedKey(null)
    setMinimized(false)
    setAnchor(null)
  }, [])

  useEffect(() => {
    if (forceClosed) close()
  }, [forceClosed, close])

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
      setSelectedKey(nextHits[0]!.key)
      setMinimized(false)
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
    () => hits.find((h) => h.key === selectedKey) ?? hits[0] ?? null,
    [hits, selectedKey]
  )

  const selectHit = useCallback((key: string) => {
    if (forceClosedRef.current) return
    setSelectedKey(key)
    setMinimized(false)
    setFocusToken((t) => t + 1)
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

      setHits((prev) => {
        const next = prev.filter((hit) => {
          const names = [hit.tableName, hit.fieldsTable]
            .map((t) => String(t ?? '').trim().toLowerCase())
            .filter(Boolean)
          if (!names.some((n) => tables.has(n))) return true
          const hitKey = extractDefineRowKeyValue(hit.data, keyField)
          if (hitKey == null) return true
          return hitKey !== wantKey
        })
        if (next.length === prev.length) return prev
        setSelectedKey((cur) => {
          if (cur && next.some((h) => h.key === cur)) return cur
          return next[0]?.key ?? null
        })
        if (next.length === 0) setMinimized(false)
        return next
      })
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

  const open = hits.length > 0 && selected != null && !forceClosed

  return {
    open,
    hits,
    selected,
    minimized,
    setMinimized,
    focusToken,
    placementToken,
    anchor,
    openFromIdentify,
    selectHit,
    close,
  }
}
