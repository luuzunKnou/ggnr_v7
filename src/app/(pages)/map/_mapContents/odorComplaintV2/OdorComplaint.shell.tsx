'use client'

import { useCallback, useEffect, useState } from 'react'
import { MapSideListPanel } from '@/app/(pages)/map/_mapComponents/MapSideListPanel'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'
import {
  MOCK_ODOR_COMPLAINT_LINKS,
  type OdorComplaintLinkMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { withBasePath } from '@/lib/basePath'
import { fromLonLat } from 'ol/proj'
import {
  ODOR_COMPLAINT_PANEL_DEFAULT_WIDTH,
  ODOR_COMPLAINT_PANEL_MAX_WIDTH,
  ODOR_COMPLAINT_PANEL_MIN_WIDTH,
  ODOR_COMPLAINT_SER_ENG,
} from './odorComplaintConfig'
import { OdorComplaintFormModal, type OdorComplaintEditor } from './OdorComplaintFormModal'
import { OdorComplaintListPanel } from './OdorComplaintListPanel'
import { OdorComplaintPointsLayer } from './OdorComplaintPointsLayer'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  onOpenActionHistory?: () => void
}

/**
 * 하수악취 민원 관리 — 좌측 목록 + 등록/수정 플로팅 모달 + 본지도 위치.
 * (기존 v7 민원관리와 동일 패턴)
 */
export function OdorComplaintShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenActionHistory,
}: Props) {
  const mapContext = useMapContext()
  const [panelWidth, setPanelWidth] = useState(ODOR_COMPLAINT_PANEL_DEFAULT_WIDTH)
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [items, setItems] = useState<OdorComplaintLinkMock[]>(() => [...MOCK_ODOR_COMPLAINT_LINKS])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [editor, setEditor] = useState<OdorComplaintEditor | null>(null)

  useEffect(() => {
    onTotalWidthChange(panelWidth)
  }, [panelWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const loadSensors = useCallback(async () => {
    try {
      const res = await fetch(withBasePath('/api/odor/sensors'), {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const json = (await res.json()) as {
        success?: boolean
        data?: OdorSensorListItem[]
      }
      if (!res.ok || !json.success) {
        setSensors([])
        return
      }
      setSensors(Array.isArray(json.data) ? json.data : [])
    } catch {
      setSensors([])
    }
  }, [])

  useEffect(() => {
    void loadSensors()
  }, [loadSensors])

  const flyTo = useCallback(
    (lon: number, lat: number) => {
      const map = mapContext?.mapInstanceRef?.current
      if (!map || !Number.isFinite(lon) || !Number.isFinite(lat)) return
      const view = map.getView()
      view.animate({
        center: fromLonLat([lon, lat]),
        zoom: Math.max(view.getZoom() ?? 14, 16),
        duration: 350,
      })
    },
    [mapContext?.mapInstanceRef]
  )

  const openEdit = useCallback(
    (id: string) => {
      setFocusId(id)
      setEditor({ mode: 'edit', id })
      const row = items.find((c) => c.id === id)
      if (row?.lon != null && row?.lat != null) flyTo(row.lon, row.lat)
    },
    [items, flyTo]
  )

  const handleListSelect = useCallback(
    (id: string) => {
      openEdit(id)
    },
    [openEdit]
  )

  const handleMapSelect = useCallback(
    (id: string | null) => {
      if (!id) {
        setFocusId(null)
        return
      }
      openEdit(id)
    },
    [openEdit]
  )

  const handleSave = useCallback((row: OdorComplaintLinkMock) => {
    setItems((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = row
        return next
      }
      return [row, ...prev]
    })
    setFocusId(row.id)
    setEditor({ mode: 'edit', id: row.id })
    if (row.lon != null && row.lat != null) flyTo(row.lon, row.lat)
  }, [flyTo])

  const handleDelete = useCallback((id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id))
    setFocusId(null)
    setEditor(null)
  }, [])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={panelWidth}
          minWidth={ODOR_COMPLAINT_PANEL_MIN_WIDTH}
          maxWidth={ODOR_COMPLAINT_PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setPanelWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_COMPLAINT_SER_ENG}
        >
          <OdorComplaintListPanel
            items={items}
            selectedId={focusId}
            onSelect={handleListSelect}
            onAdd={() => {
              setFocusId(null)
              setEditor({ mode: 'create' })
            }}
            onClose={onClose}
          />
        </MapSideListPanel>
      </div>

      <OdorComplaintFormModal
        editor={editor}
        items={items}
        sensors={sensors}
        onClose={() => setEditor(null)}
        onSave={handleSave}
        onDelete={handleDelete}
        onGoActionHistory={onOpenActionHistory}
      />

      <OdorComplaintPointsLayer
        items={items}
        focusId={focusId}
        onSelect={handleMapSelect}
      />
    </>
  )
}
