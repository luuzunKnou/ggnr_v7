'use client'

import { useEffect, useRef, useState } from 'react'
import { transform } from 'ol/proj'
import { Camera, ChevronRight, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAddressFromCoord } from '../../_mapComponents/addressSearch/vworldAddressSearch'
import '../../_mapComponents/config/projections'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  DetailAttrRow,
  DetailAttrSectionTitle,
  DetailAttrTable,
  LAYER_ROW_NEW_ID,
  LayerRowEditHeader,
  LayerRowEditToolbar,
  LayerRowPanelButton,
} from '../../_mapComponents/layerRowEdit'
import { GCP_STATUS_OPTIONS, type GcpStatus } from './gcpConfig'
import {
  displayStatusOf,
  statusBadgeClass,
  statusLabel,
  type GcpInspectItem,
  type GcpInspection,
  type GcpPoint,
} from './gcpDummyData'
import { GcpInspectHistoryDialog } from './GcpInspectHistoryDialog'
import {
  addGcpPoint,
  clearGcpCreate,
  getGcpCreateDraft,
  getGcpPoint,
  setGcpCreateGeom,
  startGcpCreate,
  updateGcpPointAttrs,
} from './gcpProtoStore'
import { useGcpProtoState } from './useGcpProtoState'

type Props = {
  detailId: string
  onClose: () => void
  onCreated: (id: string) => void
  onInspect: (ids: string[]) => void
  overlayLeftPx: number
  overlayWidthPx: number
}

type Draft = {
  placeNote: string
  status: GcpStatus
  address: string
}

type CreateForm = {
  gcpnum: string
  x: string
  y: string
  z: string
  placeNote: string
  installedAt: string
  status: GcpStatus
  address: string
}

function fmtCoord(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 3 })
}

function fmtCoordInput(n: number) {
  return n.toFixed(3)
}

function parseCoord(raw: string): number | null {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function emptyCreateForm(): CreateForm {
  return {
    gcpnum: '',
    x: '',
    y: '',
    z: '',
    placeNote: '',
    installedAt: new Date().toISOString().slice(0, 10),
    status: 'ok',
    address: '',
  }
}

function draftFrom(point: GcpPoint): Draft {
  return {
    placeNote: point.placeNote,
    status: point.status,
    address: point.address === '—' ? '' : point.address,
  }
}

const FIELD_INPUT =
  'h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-border'

const CREATE_LABEL = 'flex items-center'

export function GcpDetailPanel({
  detailId,
  onClose,
  onCreated,
  onInspect,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const isCreateMode = detailId === LAYER_ROW_NEW_ID
  const mapContext = useMapContext()
  const vworldApiKey = mapContext?.vworldApiKey ?? ''
  const { points, inspections, createDraft } = useGcpProtoState()
  const point = isCreateMode
    ? undefined
    : (points.find((p) => p.id === detailId) ?? getGcpPoint(detailId))
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm)
  const [createError, setCreateError] = useState<string | null>(null)
  const geomFromFormRef = useRef(false)
  const [historyOpen, setHistoryOpen] = useState<{
    inspection: GcpInspection
    item: GcpInspectItem
  } | null>(null)

  useEffect(() => {
    setIsEditing(false)
    setDraft(point ? draftFrom(point) : null)
  }, [point?.id])

  useEffect(() => {
    if (!isCreateMode) return
    if (!getGcpCreateDraft()) startGcpCreate()
    geomFromFormRef.current = false
    setCreateForm(emptyCreateForm())
    setCreateError(null)
  }, [isCreateMode, detailId])

  useEffect(() => {
    if (!isCreateMode) return
    const geom = createDraft?.geom5181
    if (!geom) return
    if (geomFromFormRef.current) {
      geomFromFormRef.current = false
      return
    }
    const [gx, gy] = geom
    setCreateForm((prev) => ({ ...prev, x: fmtCoordInput(gx), y: fmtCoordInput(gy) }))

    let cancelled = false
    const fillAddress = async () => {
      const [lon, lat] = transform(geom, 'EPSG:5181', 'EPSG:4326')
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
      const addr = await getAddressFromCoord(lon, lat, {
        apiKey: vworldApiKey || undefined,
        type: 'BOTH',
      })
      const text = (addr?.road || addr?.jibun || '').trim()
      if (cancelled) return
      setCreateForm((prev) => ({ ...prev, address: text }))
    }
    void fillAddress()
    return () => {
      cancelled = true
    }
  }, [isCreateMode, createDraft?.geom5181, vworldApiKey])

  const handleCreateCoordChange = (key: 'x' | 'y' | 'z', value: string) => {
    setCreateForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'x' || key === 'y') {
        const x = parseCoord(key === 'x' ? value : next.x)
        const y = parseCoord(key === 'y' ? value : next.y)
        if (x != null && y != null) {
          geomFromFormRef.current = true
          setGcpCreateGeom([x, y])
        }
      }
      return next
    })
  }

  const handleCreateSave = () => {
    const gcpnum = createForm.gcpnum.trim()
    const x = parseCoord(createForm.x)
    const y = parseCoord(createForm.y)
    const z = parseCoord(createForm.z)
    if (!gcpnum) {
      setCreateError('GCP번호는 비워 둘 수 없습니다.')
      return
    }
    if (x == null || y == null) {
      setCreateError('지도에서 위치를 지정하거나 좌표를 입력하세요.')
      return
    }
    const id = addGcpPoint({
      gcpnum,
      x,
      y,
      z: z ?? 0,
      geom5181: [x, y],
      placeNote: createForm.placeNote.trim(),
      installedAt: createForm.installedAt || new Date().toISOString().slice(0, 10),
      status: createForm.status,
      address: createForm.address.trim() || '—',
    })
    onCreated(id)
  }

  const handleCreateCancel = () => {
    clearGcpCreate()
    onClose()
  }

  if (isCreateMode) {
    const canCreate = Boolean(createForm.gcpnum.trim())
    const createToolbar = {
      isEditing: true,
      isCreateMode: true,
      saving: false,
      onEdit: () => undefined,
      onSave: handleCreateSave,
      onCancel: handleCreateCancel,
      editable: true,
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지상기준점 상세"
          actionsPlacement="footer"
          onClose={handleCreateCancel}
          {...createToolbar}
        />
        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
          <p className="mb-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            지도에서 위치를 클릭하거나 좌표를 입력하세요.
          </p>
          {createError ? <p className="mb-2 text-[11px] text-destructive">{createError}</p> : null}
          <DetailAttrSectionTitle>상세 속성</DetailAttrSectionTitle>
          <DetailAttrTable>
            <DetailAttrRow label="GCP번호" required labelClassName={CREATE_LABEL}>
              <input
                value={createForm.gcpnum}
                onChange={(e) => {
                  setCreateError(null)
                  setCreateForm((prev) => ({ ...prev, gcpnum: e.target.value }))
                }}
                className={FIELD_INPUT}
                required
              />
            </DetailAttrRow>
            <DetailAttrRow label="X" labelClassName={CREATE_LABEL} valueClassName="tabular-nums">
              <input
                value={createForm.x}
                onChange={(e) => handleCreateCoordChange('x', e.target.value)}
                className={FIELD_INPUT}
                inputMode="decimal"
              />
            </DetailAttrRow>
            <DetailAttrRow label="Y" labelClassName={CREATE_LABEL} valueClassName="tabular-nums">
              <input
                value={createForm.y}
                onChange={(e) => handleCreateCoordChange('y', e.target.value)}
                className={FIELD_INPUT}
                inputMode="decimal"
              />
            </DetailAttrRow>
            <DetailAttrRow label="Z" labelClassName={CREATE_LABEL} valueClassName="tabular-nums">
              <input
                value={createForm.z}
                onChange={(e) => handleCreateCoordChange('z', e.target.value)}
                className={FIELD_INPUT}
                inputMode="decimal"
              />
            </DetailAttrRow>
            <DetailAttrRow label="위치 설명" labelClassName={CREATE_LABEL}>
              <input
                value={createForm.placeNote}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, placeNote: e.target.value }))}
                className={FIELD_INPUT}
              />
            </DetailAttrRow>
            <DetailAttrRow label="최초 설치일" labelClassName={CREATE_LABEL}>
              <input
                type="date"
                value={createForm.installedAt}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, installedAt: e.target.value }))}
                className={FIELD_INPUT}
              />
            </DetailAttrRow>
            <DetailAttrRow label="상태" labelClassName={CREATE_LABEL}>
              <select
                value={createForm.status}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, status: e.target.value as GcpStatus }))
                }
                className={FIELD_INPUT}
              >
                {GCP_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </DetailAttrRow>
            <DetailAttrRow label="주소" isLast labelClassName={CREATE_LABEL}>
              <input
                value={createForm.address}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, address: e.target.value }))}
                className={FIELD_INPUT}
              />
            </DetailAttrRow>
          </DetailAttrTable>
        </MapSideDetailScroll>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
          <LayerRowPanelButton type="button" disabled={!canCreate} onClick={handleCreateSave}>
            등록
          </LayerRowPanelButton>
          <LayerRowPanelButton type="button" onClick={handleCreateCancel}>
            취소
          </LayerRowPanelButton>
        </div>
      </div>
    )
  }

  if (!point || !draft) {
    return (
      <div className="flex h-full flex-col bg-background">
        <LayerRowEditHeader
          title="지상기준점 상세"
          isEditing={false}
          saving={false}
          onEdit={() => undefined}
          onSave={() => undefined}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
          actionsPlacement="footer"
        />
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">기준점을 찾을 수 없습니다.</p>
      </div>
    )
  }

  const shown = displayStatusOf(point)
  const history = inspections.filter((row) => row.items.some((item) => item.gcpId === point.id))

  const handleSave = () => {
    updateGcpPointAttrs(point.id, {
      placeNote: draft.placeNote.trim(),
      status: draft.status,
      address: draft.address.trim() || '—',
    })
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setDraft(draftFrom(point))
    setIsEditing(false)
  }

  const editToolbarProps = {
    isEditing,
    saving: false,
    onEdit: () => {
      setDraft(draftFrom(point))
      setIsEditing(true)
    },
    onSave: handleSave,
    onCancel: handleCancelEdit,
    editable: true,
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title="지상기준점 상세"
        actionsPlacement="footer"
        onClose={onClose}
        {...editToolbarProps}
      />

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        <DetailAttrSectionTitle>상세 속성</DetailAttrSectionTitle>
        <DetailAttrTable>
          <DetailAttrRow label="GCP번호" valueClassName="tabular-nums">
            {point.gcpnum}
          </DetailAttrRow>
          <DetailAttrRow label="X" valueClassName="tabular-nums">
            {fmtCoord(point.x)}
          </DetailAttrRow>
          <DetailAttrRow label="Y" valueClassName="tabular-nums">
            {fmtCoord(point.y)}
          </DetailAttrRow>
          <DetailAttrRow label="Z" valueClassName="tabular-nums">
            {fmtCoord(point.z)}
          </DetailAttrRow>
          <DetailAttrRow label="위치 설명">
            {isEditing ? (
              <input
                value={draft.placeNote}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, placeNote: e.target.value } : prev))}
                className={FIELD_INPUT}
              />
            ) : (
              point.placeNote
            )}
          </DetailAttrRow>
          <DetailAttrRow label="최초 설치일" valueClassName="tabular-nums">
            {point.installedAt}
          </DetailAttrRow>
          <DetailAttrRow label="상태">
            {isEditing ? (
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, status: e.target.value as GcpStatus } : prev))
                }
                className={FIELD_INPUT}
              >
                {GCP_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className={cn(
                  'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                  statusBadgeClass(shown)
                )}
              >
                {shown}
              </span>
            )}
          </DetailAttrRow>
          <DetailAttrRow label="주소">
            {isEditing ? (
              <input
                value={draft.address}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, address: e.target.value } : prev))}
                className={FIELD_INPUT}
              />
            ) : (
              point.address
            )}
          </DetailAttrRow>
          <DetailAttrRow label="최근 점검일" isLast valueClassName="tabular-nums">
            {point.lastInspectDate || '없음'}
          </DetailAttrRow>
        </DetailAttrTable>

        <div className="mt-4">
          <DetailAttrSectionTitle>위치 사진</DetailAttrSectionTitle>
          {point.photos.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded border border-dashed border-border bg-muted/50 text-[11px] text-muted-foreground">
              <Camera className="mr-1 h-3.5 w-3.5" />
              등록된 사진이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {point.photos.map((photo) => (
                <figure key={photo.id} className="overflow-hidden rounded border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.name} className="h-24 w-full object-cover" />
                  <figcaption className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">
                    {photo.name}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <DetailAttrSectionTitle>점검 이력</DetailAttrSectionTitle>
          {history.length === 0 ? (
            <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-4 text-center text-muted-foreground">
              점검 이력이 없습니다.
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto overflow-x-hidden rounded border border-border scrollbar-thin">
              {history.map((row, idx) => {
                const item = row.items.find((it) => it.gcpId === point.id)
                if (!item) return null
                const label = statusLabel(item.status)
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setHistoryOpen({ inspection: row, item })}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50',
                      idx < history.length - 1 && 'border-b border-border'
                    )}
                  >
                    <span className="w-[5.5rem] shrink-0 tabular-nums text-foreground">{row.inspectDate}</span>
                    <span
                      className={cn(
                        'inline-block rounded-full px-1.5 py-0.5 font-semibold',
                        statusBadgeClass(label)
                      )}
                    >
                      {label}
                    </span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </MapSideDetailScroll>

      <GcpInspectHistoryDialog
        open={historyOpen != null}
        onClose={() => setHistoryOpen(null)}
        inspection={historyOpen?.inspection ?? null}
        item={historyOpen?.item ?? null}
        overlayLeftPx={overlayLeftPx}
        overlayWidthPx={overlayWidthPx}
      />

      <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border bg-background px-3 py-2">
        <LayerRowPanelButton type="button" disabled={isEditing} onClick={() => onInspect([point.id])}>
          <ClipboardList className="h-3 w-3 shrink-0" aria-hidden />
          점검 추가
        </LayerRowPanelButton>
        <div className="flex items-center gap-1">
          <LayerRowEditToolbar {...editToolbarProps} />
        </div>
      </div>
    </div>
  )
}
