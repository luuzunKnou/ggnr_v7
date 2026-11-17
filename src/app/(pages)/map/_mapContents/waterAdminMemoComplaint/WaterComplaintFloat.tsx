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
import type {
  ComplaintDefineFieldSave,
  ComplaintFormValues,
} from '../../_mapComponents/complaint/complaint-info'
import type { CompdUI } from '../../_mapComponents/complaint/types'
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
import { useSafetyLayerDetailColumns } from '../safty/useSafetyLayerDetailColumns'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
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
  compCat: null,
  compStat: null,
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
  /** 공통UI — 상단 폼을 테이블 Field 표시 항목으로 */
  useDefineFields?: boolean
  onClose: () => void
  onCreated?: (compKey: number) => void
  onListRefresh?: () => void
}

function addressFromFieldRow(row: Record<string, string>): string | null {
  const preferred = [
    'comp_req_adr',
    'comp_req_adr_road',
    'co_addr',
    'dre_addr',
    'comp_adr',
    'address',
    'addr',
  ]
  for (const key of preferred) {
    const hit = String(row[key] ?? '').trim()
    if (hit) return hit
  }
  for (const [key, val] of Object.entries(row)) {
    if (!/adr|addr|address|jibun|loc/i.test(key)) continue
    const hit = String(val ?? '').trim()
    if (hit) return hit
  }
  return null
}

export function WaterComplaintFloat({
  mode,
  tableName,
  menuLabel,
  serEng,
  compKey = null,
  fly = false,
  detailFocus = null,
  useDefineFields = false,
  onClose,
  onCreated,
  onListRefresh,
}: Props) {
  const mapContext = useMapContext()
  const canWrite = useSerWriteAccess()
  const profile = waterComplaintProfile(tableName)
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20
  const { columns: defineFields, columnsLoading: defineFieldsLoading } =
    useSafetyLayerDetailColumns(useDefineFields ? tableName : '')
  const [row, setRow] = useState<WaterComplaintRow>(EMPTY)
  const [defineFieldValues, setDefineFieldValues] = useState<Record<string, string>>({})
  const [histories, setHistories] = useState<CompdUI[]>([])
  const [placeFocus, setPlaceFocus] = useState<WaterPlaceFocus | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const mapCompdList = useCallback((list: unknown): CompdUI[] => {
    if (!Array.isArray(list)) return []
    return list.map((h) => {
      const row = h as CompdUI & { compdContents?: string | null }
      return {
        ...row,
        compdTitle: (row.compdExtra as { title?: string } | null)?.title,
        compdContent:
          row.compdContents ?? (row.compdExtra as { content?: string } | null)?.content,
      }
    })
  }, [])

  const reloadHistories = useCallback(
    async (key: number) => {
      if (!useDefineFields || !Number.isInteger(key) || key < 1) {
        setHistories([])
        return
      }
      try {
        const res = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'listCompdTemp',
          params: { tableName, compKey: key },
        })
        const data = res?.data ?? res
        setHistories(mapCompdList(data?.rows))
      } catch {
        setHistories([])
      }
    },
    [mapCompdList, tableName, useDefineFields]
  )

  useEffect(() => {
    if (mode !== 'edit' || compKey == null) {
      setRow(EMPTY)
      setDefineFieldValues({})
      setHistories([])
      return
    }
    let cancelled = false
    if (useDefineFields) {
      void Promise.all([
        call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'getFieldDetail',
          params: { tableName, compKey },
        }),
        call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'get',
          params: { tableName, compKey },
        }),
      ]).then(([fieldRes, getRes]) => {
        if (cancelled) return
        const fieldData = fieldRes?.data ?? fieldRes
        const mapped = (getRes?.data ?? null) as WaterComplaintRow | null
        const raw = (fieldData?.row ?? {}) as Record<string, string>
        setDefineFieldValues(raw)
        const extent3857 = Array.isArray(fieldData?.extent3857)
          ? (fieldData.extent3857 as [number, number, number, number])
          : null
        const geomGeoJson4326 =
          fieldData?.geomGeoJson4326 && typeof fieldData.geomGeoJson4326 === 'object'
            ? (fieldData.geomGeoJson4326 as Record<string, unknown>)
            : null
        let key = 0
        if (mapped?.compKey) {
          key = mapped.compKey
          setRow({
            ...mapped,
            compAdr: mapped.compAdr ?? addressFromFieldRow(raw),
            extent3857: extent3857 ?? mapped.extent3857,
            geomGeoJson4326: geomGeoJson4326 ?? mapped.geomGeoJson4326,
          })
        } else {
          key = Number(raw.comp_key ?? compKey)
          if (Number.isInteger(key) && key > 0) {
            setRow({
              ...EMPTY,
              compKey: key,
              compAdr: addressFromFieldRow(raw),
              extent3857,
              geomGeoJson4326,
            })
          }
        }
        if (Number.isInteger(key) && key > 0) {
          void reloadHistories(key)
        } else {
          setHistories([])
        }
      })
    } else {
      setHistories([])
      void call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'get',
        params: { tableName, compKey },
      }).then((res) => {
        if (cancelled) return
        const data = (res?.data ?? null) as WaterComplaintRow | null
        if (data?.compKey) setRow(data)
      })
    }
    return () => {
      cancelled = true
    }
  }, [compKey, mode, reloadHistories, tableName, useDefineFields])

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

  const persistDefineFields = useCallback(
    async (payload: ComplaintDefineFieldSave) => {
      setSaving(true)
      try {
        const res = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'saveFieldDetail',
          params: {
            tableName,
            compKey: mode === 'edit' ? row.compKey : null,
            values: payload.values,
            lon: payload.lon,
            lat: payload.lat,
          },
        })
        const data = res?.data ?? res
        if (data?.error) throw new Error(String(data.error))
        const raw = (data?.row ?? {}) as Record<string, string>
        const key = Number(raw.comp_key ?? row.compKey)
        if (!Number.isInteger(key) || key < 1) {
          window.alert(mode === 'add' ? '민원 등록에 실패했습니다.' : '민원 저장에 실패했습니다.')
          return
        }
        setDefineFieldValues(raw)
        onListRefresh?.()
        if (mode === 'add') {
          onCreated?.(key)
          return
        }
        const getRes = await call('', 'POST', {
          service: 'waterAdminComplaintService',
          action: 'get',
          params: { tableName, compKey: key },
        })
        const mapped = (getRes?.data ?? null) as WaterComplaintRow | null
        if (mapped?.compKey) {
          setRow({
            ...mapped,
            compAdr: mapped.compAdr ?? addressFromFieldRow(raw),
            extent3857: Array.isArray(data?.extent3857)
              ? (data.extent3857 as [number, number, number, number])
              : mapped.extent3857,
            geomGeoJson4326:
              data?.geomGeoJson4326 && typeof data.geomGeoJson4326 === 'object'
                ? (data.geomGeoJson4326 as Record<string, unknown>)
                : mapped.geomGeoJson4326,
          })
        }
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

  const handleAddHistory = useCallback(
    async (data: {
      compdDate: string
      compdCu: string
      compdCt: string
      compdCg: string
      compdState: string
      compdContent: string
    }) => {
      if (!row.compKey) return
      await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'createCompdTemp',
        params: {
          tableName,
          compKey: row.compKey,
          compdDate: data.compdDate,
          compdCu: data.compdCu || null,
          compdCt: data.compdCt || null,
          compdCg: data.compdCg || null,
          compdState: data.compdState,
          compdContents: data.compdContent || null,
          compdExtra: {},
        },
      })
      await reloadHistories(row.compKey)
      onListRefresh?.()
    },
    [onListRefresh, reloadHistories, row.compKey, tableName]
  )

  const handleEditHistory = useCallback(
    async (
      compdKey: number,
      data: {
        compdDate: string
        compdCu: string
        compdCt: string
        compdCg: string
        compdState: string
        compdContent: string
      }
    ) => {
      if (!row.compKey) return
      await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'updateCompdTemp',
        params: {
          tableName,
          compdKey,
          compdDate: data.compdDate,
          compdCu: data.compdCu || null,
          compdCt: data.compdCt || null,
          compdCg: data.compdCg || null,
          compdState: data.compdState,
          compdContents: data.compdContent || null,
          compdExtra: {},
        },
      })
      await reloadHistories(row.compKey)
      onListRefresh?.()
    },
    [onListRefresh, reloadHistories, row.compKey, tableName]
  )

  const handleDeleteHistory = useCallback(
    async (compdKey: number) => {
      if (!row.compKey) return
      const res = await call('', 'POST', {
        service: 'waterAdminComplaintService',
        action: 'removeCompdTemp',
        params: { tableName, compdKey },
      })
      const data = res?.data ?? res
      if (res?.success !== false && data?.deleted) {
        await reloadHistories(row.compKey)
        onListRefresh?.()
      }
    },
    [onListRefresh, reloadHistories, row.compKey, tableName]
  )

  if (!profile) return null
  if (mode === 'edit' && !row.compKey) {
    return null
  }

  /** 통합UI(Field)는 하단을 기존 민원상세와 동일하게 — HistoryList. 그 외만 Status/준설대상지 */
  const historySlot =
    useDefineFields || mode !== 'edit' ? undefined : profile.hasChild ? (
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

  const detailPanel = (
    <ComplaintDetailPanel
      mode={mode}
      complaint={row}
      histories={useDefineFields ? histories : []}
      onAddHistory={useDefineFields && canWrite && mode === 'edit' ? handleAddHistory : undefined}
      onEditHistory={useDefineFields && canWrite && mode === 'edit' ? handleEditHistory : undefined}
      onDeleteHistory={useDefineFields && canWrite && mode === 'edit' ? handleDeleteHistory : undefined}
      onSave={
        useDefineFields
          ? undefined
          : (values) => persist(values, { latestState: row.latestState, resultText: row.resultText })
      }
      defineFields={useDefineFields ? defineFields : undefined}
      defineFieldValues={useDefineFields ? defineFieldValues : undefined}
      tableName={useDefineFields ? tableName : undefined}
      onSaveDefineFields={useDefineFields ? persistDefineFields : undefined}
      onDelete={mode === 'edit' ? handleDelete : undefined}
      onClose={onClose}
      saving={saving}
      deleting={deleting}
      historyTabLabel={useDefineFields ? '이력관리' : profile.hasChild ? '준설대상지' : '이력관리'}
      historySlot={historySlot}
      fileSerEng={serEng}
      fileLayer={tableName}
    />
  )

  /** 민원 추가 — 상세와 같은 입력 폼을 가운데 모달로 표시 (지도에서 위치 찍기를 위해 비차단 모달) */
  if (mode === 'add') {
    return (
      <Dialog
        open
        modal={false}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          layerZIndex={COMPLAINT_DETAIL_PANEL_Z_INDEX}
          onInteractOutside={(e) => e.preventDefault()}
          className="flex max-h-[92vh] w-[600px] flex-col gap-0 overflow-hidden rounded-[10px] border-border/80 p-0 sm:max-w-[600px]"
          style={{ height: 'min(92vh, 760px)' }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-gradient-to-b from-muted/30 to-background px-4 py-2.5">
            <DialogTitle className="text-sm font-semibold text-foreground">
              {`${menuLabel} 추가`}
            </DialogTitle>
            <button
              type="button"
              title="닫기"
              onClick={onClose}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <DialogDescription className="sr-only">민원 정보를 입력해 등록합니다.</DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{detailPanel}</div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <MapFloatingPanel
      viewport
      zLayer="detailFloating"
      width={COMPLAINT_DETAIL_PANEL_WIDTH}
      maxHeight={COMPLAINT_DETAIL_PANEL_MAX_HEIGHT}
      defaultPosition={{ top: COMPLAINT_DETAIL_PANEL_DEFAULT_TOP, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">
            {`${menuLabel} #${row.compKey}`}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{detailPanel}</div>
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
