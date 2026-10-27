'use client'

import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { call } from '@/lib/api'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import { waterComplaintProfile } from '@/service/waterAdminComplaintProfile'
import type { WaterComplaintRow, WaterDreDetail } from '@/service/waterAdminComplaintService'
import { MapFloatingPanel } from '../../_mapComponents/MapFloatingPanel'
import { useMapContext } from '../../_mapComponents/MapContext'
import { ComplaintDetailPanel } from '../../_mapComponents/complaint/complaint-detail-panel'
import type { ComplaintFormValues } from '../../_mapComponents/complaint/complaint-info'
import {
  COMPLAINT_DETAIL_PANEL_DEFAULT_TOP,
  COMPLAINT_DETAIL_PANEL_MAX_HEIGHT,
  COMPLAINT_DETAIL_PANEL_WIDTH,
  COMPLAINT_DETAIL_PANEL_Z_INDEX,
} from '../../_mapComponents/complaint/complaintPanelLayout'
import { COMPLAINT_STATE_OPTIONS, getStateStyle } from '../../_mapComponents/complaint/state-options'
import {
  animateComplaintToCenter3857,
  center3857FromExtent,
} from '../../_mapComponents/complaint/useComplaintMapClick'
import { useComplaintMapHighlight } from '../../_mapComponents/complaint/useComplaintMapHighlight'
import { cn } from '@/lib/utils'
import { WaterDreTargetList } from './WaterDreTargetList'
import { flyToExtent3857, type WaterPlaceFocus } from './waterComplaintMapFly'

const EMPTY: WaterComplaintRow = {
  compKey: 0,
  compDate: null,
  compCu: null,
  compCt: null,
  compCg: null,
  compAdr: null,
  compName: null,
  compTel: null,
  compContent: null,
  compExtra: null,
  latestState: '접수',
  resultText: null,
}

type Props = {
  mode: 'add' | 'edit'
  tableName: string
  menuLabel: string
  serEng: string
  compKey?: number | null
  fly?: boolean
  detailFocus?: WaterPlaceFocus | null
  onClose: () => void
  onCreated?: (compKey: number) => void
  onListRefresh?: () => void
}

export function WaterComplaintFloat({
  mode,
  tableName,
  menuLabel,
  serEng,
  compKey = null,
  fly = false,
  detailFocus = null,
  onClose,
  onCreated,
  onListRefresh,
}: Props) {
  const mapContext = useMapContext()
  const canWrite = useSerWriteAccess()
  const profile = waterComplaintProfile(tableName)
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20
  const [row, setRow] = useState<WaterComplaintRow>(EMPTY)
  const [placeFocus, setPlaceFocus] = useState<WaterPlaceFocus | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (mode !== 'edit' || compKey == null) {
      setRow(EMPTY)
      return
    }
    let cancelled = false
    void call('', 'POST', {
      service: 'waterAdminComplaintService',
      action: 'get',
      params: { tableName, compKey },
    }).then((res) => {
      if (cancelled) return
      const data = (res?.data ?? null) as WaterComplaintRow | null
      if (data?.compKey) setRow(data)
    })
    return () => {
      cancelled = true
    }
  }, [compKey, mode, tableName])

  useComplaintMapHighlight(
    Boolean(mapContext?.mapReady) && mode === 'edit',
    placeFocus?.geomGeoJson4326 ?? row.geomGeoJson4326 ?? null,
    placeFocus ? `dre-${placeFocus.detailKey}` : row.compKey || null
  )

  useEffect(() => {
    setPlaceFocus(detailFocus ?? null)
  }, [compKey, detailFocus])

  useEffect(() => {
    if (!placeFocus?.extent3857) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return
    flyToExtent3857(map, placeFocus.extent3857, () => mapContext?.applyMapViewPaddingRef?.current?.())
  }, [mapContext, placeFocus])

  useEffect(() => {
    if (placeFocus) return
    if (!fly || mode !== 'edit' || !row.compKey) return
    const map = mapContext?.mapInstanceRef?.current
    const center = center3857FromExtent(row.extent3857)
    if (!map || !center) return
    animateComplaintToCenter3857(map, center, () => mapContext?.applyMapViewPaddingRef?.current?.())
  }, [fly, mapContext, mode, placeFocus, row.compKey, row.extent3857])

  const persist = useCallback(
    async (values: ComplaintFormValues, extra?: { latestState?: string | null; resultText?: string | null }) => {
      setSaving(true)
      try {
        const params = {
          tableName,
          compName: values.compName || null,
          compTel: values.compTel || null,
          compDate: values.compDate || null,
          compCg: values.compCg || null,
          compCt: values.compCt || null,
          compCu: values.compCu || null,
          compAdr: values.compAdr || null,
          compContent: values.compContent || null,
          lon: values.lon ?? null,
          lat: values.lat ?? null,
          latestState: extra?.latestState,
          resultText: extra?.resultText,
        }
        const action = mode === 'add' ? 'create' : 'update'
        const res = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action,
          params: mode === 'add' ? params : { ...params, compKey: row.compKey },
        })
        const saved = (res?.data ?? null) as WaterComplaintRow | null
        if (!saved?.compKey) {
          window.alert(mode === 'add' ? '민원 등록에 실패했습니다.' : '민원 저장에 실패했습니다.')
          return
        }
        setRow(saved)
        onListRefresh?.()
        if (mode === 'add') onCreated?.(saved.compKey)
      } catch {
        window.alert(mode === 'add' ? '민원 등록에 실패했습니다.' : '민원 저장에 실패했습니다.')
      } finally {
        setSaving(false)
      }
    },
    [mode, onCreated, onListRefresh, row.compKey, tableName]
  )

  const saveState = async (latestState: string) => {
    if (mode !== 'edit' || !row.compKey) return
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'update',
        params: { tableName, compKey: row.compKey, latestState, resultText: row.resultText },
      })
      const saved = (res?.data ?? null) as WaterComplaintRow | null
      if (saved?.compKey) {
        setRow(saved)
        onListRefresh?.()
      }
    } catch {
      window.alert('조치결과 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const saveResult = async (resultText: string) => {
    if (!row.compKey) return
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'update',
        params: { tableName, compKey: row.compKey, resultText, latestState: row.latestState },
      })
      const saved = (res?.data ?? null) as WaterComplaintRow | null
      if (saved?.compKey) setRow(saved)
    } catch {
      window.alert('처리내용 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!row.compKey) return
    if (!window.confirm('이 민원을 삭제할까요?')) return
    setDeleting(true)
    try {
      await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'remove',
        params: { tableName, compKey: row.compKey },
      })
      onListRefresh?.()
      onClose()
    } catch {
      window.alert('민원 삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  if (!profile) return null
  if (mode === 'edit' && !row.compKey) {
    return null
  }

  const historySlot = profile.hasChild ? (
    <WaterDreTargetList
      compKey={row.compKey}
      details={row.details ?? []}
      selectedKey={placeFocus?.detailKey ?? null}
      onFocus={(detail) => setPlaceFocus(detail)}
      onChange={(details: WaterDreDetail[]) => setRow((prev) => ({ ...prev, details }))}
    />
  ) : (
    <StatusSlot
      state={row.latestState}
      resultText={row.resultText ?? ''}
      canWrite={canWrite}
      showState={profile.state != null}
      showResult={profile.result != null}
      onState={saveState}
      onResult={saveResult}
    />
  )

  return (
    <MapFloatingPanel
      viewport
      width={COMPLAINT_DETAIL_PANEL_WIDTH}
      maxHeight={COMPLAINT_DETAIL_PANEL_MAX_HEIGHT}
      style={{ zIndex: COMPLAINT_DETAIL_PANEL_Z_INDEX }}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">
            {mode === 'add' ? `${menuLabel} 추가` : `${menuLabel} #${row.compKey}`}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ComplaintDetailPanel
          mode={mode}
          complaint={row}
          histories={[]}
          onSave={(values) => persist(values, { latestState: row.latestState, resultText: row.resultText })}
          onDelete={mode === 'edit' ? handleDelete : undefined}
          onClose={onClose}
          saving={saving}
          deleting={deleting}
          historyTabLabel={profile.hasChild ? '준설대상지' : '이력관리'}
          historySlot={mode === 'edit' ? historySlot : undefined}
          fileSerEng={serEng}
          fileLayer={tableName}
        />
      </div>
    </MapFloatingPanel>
  )
}

function StatusSlot({
  state,
  resultText,
  canWrite,
  showState,
  showResult,
  onState,
  onResult,
}: {
  state: string | null
  resultText: string
  canWrite: boolean
  showState: boolean
  showResult: boolean
  onState: (state: string) => void
  onResult: (text: string) => void
}) {
  const [draft, setDraft] = useState(resultText)
  useEffect(() => {
    setDraft(resultText)
  }, [resultText])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {showState ? (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">조치결과</p>
          <div className="flex flex-wrap gap-1.5">
            {COMPLAINT_STATE_OPTIONS.map((option) => {
              const style = getStateStyle(option)
              const active = state === option
              return (
                <button
                  key={option}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => onState(option)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium',
                    active ? `${style.bg} ${style.text} ${style.border}` : 'border-transparent bg-muted text-muted-foreground'
                  )}
                >
                  {option}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">이 민원에는 조치결과 항목이 없습니다.</p>
      )}
      {showResult ? (
        <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          처리내용
          <textarea
            value={draft}
            readOnly={!canWrite}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== resultText) onResult(draft)
            }}
            className="min-h-24 flex-1 resize-none rounded-md border border-border bg-background p-2 text-xs text-foreground"
          />
        </label>
      ) : null}
    </div>
  )
}
