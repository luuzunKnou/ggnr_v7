'use client'

import { useEffect, useMemo, useState } from 'react'
import type Map from 'ol/Map'
import GeoJSON from 'ol/format/GeoJSON'
import type { ConsLedgerKind } from '@/lib/consLedgerVariant'
import { MapDetailFloatingPanel } from '../../../_mapComponents/MapDetailFloatingPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { loadWtlConsDetail } from './wtlConsLedgerApi'
import {
  focusTipCoordinate,
  type WtlConsMapFocus,
} from './useWtlConsMapLayer'
import { WTL_CONS_FIELD_LABEL, type WtlConsWork } from './wtlConsSample'

const COMPACT_WIDTH_PX = 360
const EXPANDED_WIDTH_PX = 480
const COMPACT_HEIGHT_EST = 240
const EXPANDED_HEIGHT_EST = 520
/** 패널·툴바 등 덮는 요소 밖으로 더 띄울 여백 */
const PLACE_GAP_PX = 14

const COMPACT_WIDTH = `min(${COMPACT_WIDTH_PX}px, calc(100vw - 2rem))`
const EXPANDED_WIDTH = `min(${EXPANDED_WIDTH_PX}px, calc(100vw - 2rem))`
const COMPACT_MAX_H = '50vh'
const EXPANDED_MAX_H = '78vh'

type AttrRow = { key: string; label: string; value: string }
type PanelPos = { top: number; left: number }

function displayOrDash(value: string | undefined | null): string {
  const s = String(value ?? '').trim()
  return s || '—'
}

function workToFullRows(work: WtlConsWork): AttrRow[] {
  const pairs: Array<[keyof typeof WTL_CONS_FIELD_LABEL, string]> = [
    ['consCode', work.consCode],
    ['name', work.name],
    ['location', work.location],
    ['volume', work.volume],
    ['amountPre', work.amountPre],
    ['amountVar', work.amountVar],
    ['amountCha', work.amountCha],
    ['amountAft', work.amountAft],
    ['contDate', work.contDate],
    ['startDate', work.startDate],
    ['doneDate', work.doneDate],
    ['sdoneDate', work.sdoneDate],
    ['company', work.company],
    ['ceo', work.ceo],
    ['companyAddr', work.companyAddr],
    ['companyPhone', work.companyPhone],
    ['directorPos', work.directorPos],
    ['directorName', work.directorName],
    ['reason', work.reason],
    ['descript', work.descript],
  ]
  return pairs.map(([key, value]) => ({
    key,
    label: WTL_CONS_FIELD_LABEL[key],
    value: displayOrDash(value),
  }))
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(n, min), max)
}

/**
 * 앵커(도형·화면 겹침점)를 모달의 왼쪽 하단 또는 오른쪽 하단에 붙일지 고른다.
 * view.padding(좌측 목록·하단 첨부 등) + PLACE_GAP 안쪽 가용 영역에 맞춤.
 */
function placeHistoryPanel(opts: {
  map: Map
  anchorMapPx: [number, number]
  panelW: number
  panelH: number
}): PanelPos {
  const { map, anchorMapPx, panelW, panelH } = opts
  const target = map.getTargetElement()
  const mapRect = target?.getBoundingClientRect()
  const size = map.getSize() ?? [0, 0]
  const padding = map.getView().padding ?? [0, 0, 0, 0]
  const padT = Math.max(0, padding[0] ?? 0)
  const padR = Math.max(0, padding[1] ?? 0)
  const padB = Math.max(0, padding[2] ?? 0)
  const padL = Math.max(0, padding[3] ?? 0)

  const mapLeft = mapRect?.left ?? 0
  const mapTop = mapRect?.top ?? 0
  const mapW = mapRect?.width || size[0]! || window.innerWidth
  const mapH = mapRect?.height || size[1]! || window.innerHeight

  // 화면(viewport) 좌표의 가용 지도 영역
  const usable = {
    left: mapLeft + padL + PLACE_GAP_PX,
    top: mapTop + padT + PLACE_GAP_PX,
    right: mapLeft + mapW - padR - PLACE_GAP_PX,
    bottom: mapTop + mapH - padB - PLACE_GAP_PX,
  }

  const rawAx = mapLeft + anchorMapPx[0]!
  const rawAy = mapTop + anchorMapPx[1]!
  const ax = clamp(rawAx, usable.left, usable.right)
  const ay = clamp(rawAy, usable.top, usable.bottom)

  const w = Math.min(panelW, Math.max(120, usable.right - usable.left))
  const h = Math.min(panelH, Math.max(120, usable.bottom - usable.top))

  // A: 왼쪽 하단 영점 → 모달이 앵커 위·오른쪽으로 펼침
  const leftA = ax
  const topA = ay - h
  // B: 오른쪽 하단 영점 → 모달이 앵커 위·왼쪽으로 펼침
  const leftB = ax - w
  const topB = ay - h

  const overflow = (left: number, top: number) => {
    const oL = Math.max(0, usable.left - left)
    const oT = Math.max(0, usable.top - top)
    const oR = Math.max(0, left + w - usable.right)
    const oB = Math.max(0, top + h - usable.bottom)
    return oL + oT + oR + oB
  }

  const scoreA = overflow(leftA, topA)
  const scoreB = overflow(leftB, topB)

  // 동점이면 앵커 기준 오른쪽에 공간이 더 남으면 A(좌하단 영점)
  let left = leftA
  let top = topA
  if (scoreB < scoreA) {
    left = leftB
    top = topB
  } else if (scoreB === scoreA) {
    const spaceRight = usable.right - ax
    const spaceLeft = ax - usable.left
    if (spaceLeft > spaceRight) {
      left = leftB
      top = topB
    }
  }

  return {
    left: clamp(left, usable.left, Math.max(usable.left, usable.right - w)),
    top: clamp(top, usable.top, Math.max(usable.top, usable.bottom - h)),
  }
}

type Props = {
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'>
  focus: WtlConsMapFocus | null
  onClose: () => void
  /** «조회» — 해당 공사코드로 좌측 공사 상세 패널 열기 */
  onOpenWork?: (consCode: string) => void
}

/**
 * 공사이력 행 선택 시 지도 위 드래그 가능 상세 창.
 * 요약 표 → «자세히» 시 본표 전체. «조회» 시 해당 공사 패널. 닫기 X.
 * 위치: 화면∩도형 앵커 + 패딩 고려, 좌·우 하단 영점 자동 선택.
 */
export function WtlConsHistoryFocusFloating({ kind, focus, onClose, onOpenWork }: Props) {
  const mapContext = useMapContext()
  const tip = focus?.tooltip
  const open = Boolean(focus?.geom && tip?.consCode)
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<WtlConsWork | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [panelPos, setPanelPos] = useState<PanelPos>({ top: 96, left: 96 })
  const [focusToken, setFocusToken] = useState(0)

  useEffect(() => {
    setExpanded(false)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
  }, [tip?.consCode])

  useEffect(() => {
    if (!open || !focus?.geom) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return
    try {
      const geometry = new GeoJSON().readGeometry(focus.geom, {
        dataProjection: focus.projection,
        featureProjection: 'EPSG:3857',
      })
      const coord = focusTipCoordinate(map, geometry)
      if (!coord) return
      const pixel = map.getPixelFromCoordinate(coord)
      if (!pixel || pixel.length < 2) return

      const panelW = expanded ? EXPANDED_WIDTH_PX : COMPACT_WIDTH_PX
      const panelH = Math.min(
        expanded ? EXPANDED_HEIGHT_EST : COMPACT_HEIGHT_EST,
        Math.round(window.innerHeight * (expanded ? 0.78 : 0.5))
      )
      const next = placeHistoryPanel({
        map,
        anchorMapPx: [pixel[0]!, pixel[1]!],
        panelW,
        panelH,
      })
      setPanelPos(next)
      setFocusToken((n) => n + 1)
    } catch {
      /* 기본 위치 유지 */
    }
  }, [
    open,
    expanded,
    tip?.consCode,
    focus?.geom,
    focus?.projection,
    mapContext?.mapInstanceRef,
    mapContext?.mapPaddingLeft,
    mapContext?.mapPaddingRight,
  ])

  useEffect(() => {
    if (!expanded || !tip?.consCode) return
    if (detail?.consCode === tip.consCode) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void loadWtlConsDetail(kind, tip.consCode).then((result) => {
      if (cancelled) return
      setDetailLoading(false)
      if (!result.row) {
        setDetail(null)
        setDetailError(result.error || '상세를 불러오지 못했습니다.')
        return
      }
      setDetail(result.row)
    })
    return () => {
      cancelled = true
    }
  }, [expanded, tip?.consCode, kind, detail?.consCode])

  const compactRows = useMemo((): AttrRow[] => {
    if (tip?.summary?.length) {
      return tip.summary.map((row, i) => ({
        key: `s${i}`,
        label: row.label,
        value: displayOrDash(row.value),
      }))
    }
    return [
      { key: 'name', label: WTL_CONS_FIELD_LABEL.name, value: displayOrDash(tip?.title) },
    ]
  }, [tip])

  const fullRows = useMemo(() => (detail ? workToFullRows(detail) : []), [detail])

  if (!open || !tip) return null

  return (
    <MapDetailFloatingPanel
      key={`${tip.consCode}-${expanded ? 'full' : 'sum'}`}
      layer="공사이력"
      title={tip.title || tip.consCode}
      allowMinimize={false}
      onClose={onClose}
      focusToken={focusToken}
      width={expanded ? EXPANDED_WIDTH : COMPACT_WIDTH}
      maxHeight={expanded ? EXPANDED_MAX_H : COMPACT_MAX_H}
      defaultPosition={panelPos}
    >
      <div className="standard-detail-scroll">
        {expanded ? (
          detailLoading ? (
            <p className="standard-detail-loading">공사정보 불러오는 중…</p>
          ) : detailError ? (
            <p className="standard-detail-attr-empty">{detailError}</p>
          ) : (
            <table className="standard-detail-attr-table">
              <tbody>
                {fullRows.map((row) => (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className="standard-detail-attr-label standard-detail-attr-cell-border"
                      title={row.label}
                    >
                      {row.label}
                    </th>
                    <td
                      className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground"
                      title={row.value}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <table className="standard-detail-attr-table">
            <tbody>
              {compactRows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="standard-detail-attr-label standard-detail-attr-cell-border"
                    title={row.label}
                  >
                    {row.label}
                  </th>
                  <td
                    className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground"
                    title={row.value}
                  >
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="standard-detail-edit-footer flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {expanded ? (
            <button
              type="button"
              className="standard-detail-hdr-btn cursor-pointer"
              onClick={() => setExpanded(false)}
            >
              요약
            </button>
          ) : (
            <button
              type="button"
              className="standard-detail-hdr-btn cursor-pointer text-primary"
              onClick={() => setExpanded(true)}
            >
              자세히
            </button>
          )}
          {onOpenWork ? (
            <button
              type="button"
              className="standard-detail-hdr-btn cursor-pointer text-primary"
              title="해당 공사 상세 패널 열기"
              onClick={() => {
                const code = tip.consCode.trim()
                if (!code) return
                onOpenWork(code)
                onClose()
              }}
            >
              조회
            </button>
          ) : null}
        </div>
      </div>
    </MapDetailFloatingPanel>
  )
}
