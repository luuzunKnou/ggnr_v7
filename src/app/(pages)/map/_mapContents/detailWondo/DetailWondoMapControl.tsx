'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DETAIL_WONDO_DEFAULT_OPACITY,
  filterDetailWondoByArea,
  type DetailWondoArea,
  type DetailWondoItem,
  type DetailWondoShown,
} from './detailWondoConfig'
import { DetailWondoListPanel } from './DetailWondoListPanel'
import { DetailWondoPickPopup } from './DetailWondoPickPopup'
import { useDetailWondoData } from './useDetailWondoData'
import { useDetailWondoFootprintLayer } from './useDetailWondoFootprintLayer'
import { useDetailWondoImageLayers } from './useDetailWondoImageLayers'

/** 전체 켜기로 새로 불러올 원도가 이보다 많으면 한 번 묻는다 */
const BULK_CONFIRM_COUNT = 30

type Props = {
  /** 우측 버튼 패널 열림 — 닫혀도 체크한 원도는 지도에 남는다 */
  panelOpen: boolean
  onClose: () => void
  /** 체크 장수 — 패널이 닫혀도 버튼 켜짐 표시용 */
  onCheckedCountChange: (count: number) => void
  panelClassName?: string
}

/**
 * 세부원도 지도 제어 — 체크 상태·도곽·원도 이미지·위치 팝업.
 * 패널이 열려 있을 때만 도곽 전체를 그리고 지도 클릭으로 원도를 고른다.
 */
export function DetailWondoMapControl({ panelOpen, onClose, onCheckedCountChange, panelClassName }: Props) {
  const [everOpened, setEverOpened] = useState(panelOpen)
  const [prevPanelOpen, setPrevPanelOpen] = useState(panelOpen)
  const [area, setArea] = useState<DetailWondoArea>({ eupmyeon: '', dong: '' })
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [opacity, setOpacity] = useState(DETAIL_WONDO_DEFAULT_OPACITY)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [pickCoord, setPickCoord] = useState<[number, number] | null>(null)
  const fittedRef = useRef(false)
  const checkedRef = useRef<string[]>([])

  if (prevPanelOpen !== panelOpen) {
    setPrevPanelOpen(panelOpen)
    if (panelOpen) setEverOpened(true)
    else {
      setPickedIds([])
      setPickCoord(null)
    }
  }

  const { items, loading, error } = useDetailWondoData(everOpened)

  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])
  const shown = useMemo<DetailWondoShown[]>(() => checkedIds.map((id) => ({ id, opacity })), [checkedIds, opacity])

  const footprintItems = useMemo(() => {
    const pick = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((it): it is DetailWondoItem => it != null)
    if (!panelOpen) return pick(checkedIds)
    const base = filterDetailWondoByArea(items, area)
    const inBase = new Set(base.map((it) => it.id))
    const extra = pick([...checkedIds, ...pickedIds].filter((id) => !inBase.has(id)))
    return extra.length ? [...base, ...extra] : base
  }, [panelOpen, area, items, checkedIds, pickedIds, byId])

  const check = useCallback((id: string, on: boolean) => {
    setCheckedIds((prev) => {
      if (on) return prev.includes(id) ? prev : [...prev, id]
      return prev.filter((x) => x !== id)
    })
  }, [])

  const handlePick = useCallback((ids: string[], coord: [number, number]) => {
    if (ids.length === 1) {
      const id = ids[0]
      const wasOn = checkedRef.current.includes(id)
      setPickCoord(null)
      setPickedIds(wasOn ? [] : ids)
      setCheckedIds((prev) => (wasOn ? prev.filter((x) => x !== id) : [...prev, id]))
      return
    }
    setPickedIds(ids)
    setPickCoord(ids.length > 1 ? coord : null)
  }, [])

  const { fitIfOutOfView } = useDetailWondoFootprintLayer({
    items: footprintItems,
    pickedIds,
    shownIds: checkedIds,
    pickCoord: panelOpen ? pickCoord : null,
    onPick: handlePick,
    pickEnabled: panelOpen,
  })
  const { loadingIds, errorIds } = useDetailWondoImageLayers({ items, shown })

  useEffect(() => {
    checkedRef.current = checkedIds
    onCheckedCountChange(checkedIds.length)
  }, [checkedIds, onCheckedCountChange])

  useEffect(() => {
    if (!panelOpen || fittedRef.current || items.length === 0) return
    fittedRef.current = true
    fitIfOutOfView(items)
  }, [panelOpen, items, fitIfOutOfView])

  const clearPick = () => {
    setPickedIds([])
    setPickCoord(null)
  }

  const handleSetAll = (ids: string[], on: boolean) => {
    if (!on) {
      const off = new Set(ids)
      setCheckedIds((prev) => prev.filter((id) => !off.has(id)))
      return
    }
    const added = ids.filter((id) => !checkedSet.has(id))
    if (
      added.length > BULK_CONFIRM_COUNT &&
      !window.confirm(`원도 ${added.length}장을 한꺼번에 불러옵니다. 화면이 느려질 수 있습니다. 계속할까요?`)
    ) {
      return
    }
    setCheckedIds((prev) => [...prev, ...added])
  }

  const handleAreaChange = (next: DetailWondoArea) => {
    setArea(next)
    fitIfOutOfView(filterDetailWondoByArea(items, next))
  }

  const handleCheckedChange = (id: string, on: boolean) => {
    check(id, on)
    const item = byId.get(id)
    if (on && item) fitIfOutOfView([item])
  }

  const pickedItems = pickedIds.map((id) => byId.get(id)).filter((it): it is DetailWondoItem => it != null)

  if (!panelOpen) return null

  return (
    <>
      {pickCoord && pickedItems.length > 1 ? (
        <DetailWondoPickPopup
          coord3857={pickCoord}
          items={pickedItems}
          checkedIds={checkedSet}
          loadingIds={loadingIds}
          onCheckedChange={check}
          onClose={clearPick}
        />
      ) : null}
      <div data-map-control-expand-panel className={panelClassName}>
        <DetailWondoListPanel
          items={items}
          loading={loading}
          error={error}
          area={area}
          onAreaChange={handleAreaChange}
          checkedIds={checkedSet}
          loadingIds={loadingIds}
          errorIds={errorIds}
          onCheckedChange={handleCheckedChange}
          onSetAll={handleSetAll}
          opacity={opacity}
          onOpacityChange={setOpacity}
          onClose={onClose}
        />
      </div>
    </>
  )
}
