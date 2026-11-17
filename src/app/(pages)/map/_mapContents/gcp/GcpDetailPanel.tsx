'use client'

import { useEffect, useRef, useState } from 'react'
import { transform } from 'ol/proj'
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
import { call } from '@/lib/api'
import type { GcpPoint } from './gcpTypes'
import {
  clearGcpCreate,
  getGcpCreateDraft,
  setGcpCreateGeom,
  startGcpCreate,
} from './gcpCreateDraft'
import { useGcpData } from './useGcpData'
import { GcpPhotoSection } from './GcpPhotoSection'

type Props = {
  detailId: string
  onClose: () => void
  onCreated: (id: string) => void
  onSaved?: () => void
}

type Draft = {
  placeNote: string
}

type CreateForm = {
  gcpnum: string
  x: string
  y: string
  z: string
  placeNote: string
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
    address: '',
  }
}

function draftFrom(point: GcpPoint): Draft {
  return { placeNote: point.placeNote }
}

const FIELD_INPUT =
  'h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-border'

const CREATE_LABEL = 'flex items-center'

export function GcpDetailPanel({ detailId, onClose, onCreated, onSaved }: Props) {
  const isCreateMode = detailId === LAYER_ROW_NEW_ID
  const mapContext = useMapContext()
  const vworldApiKey = mapContext?.vworldApiKey ?? ''
  const { points, createDraft, refresh } = useGcpData()
  const point = isCreateMode
    ? undefined
    : points.find((p) => p.id === detailId)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm)
  const [createError, setCreateError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addressHint, setAddressHint] = useState('')
  const geomFromFormRef = useRef(false)

  useEffect(() => {
    setIsEditing(false)
    setDraft(point ? draftFrom(point) : null)
    setAddressHint('')
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

  useEffect(() => {
    if (isCreateMode || !point) return
    let cancelled = false
    const fill = async () => {
      const [lon, lat] = transform(point.geom5181, 'EPSG:5181', 'EPSG:4326')
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
      const addr = await getAddressFromCoord(lon, lat, {
        apiKey: vworldApiKey || undefined,
        type: 'BOTH',
      })
      const text = (addr?.road || addr?.jibun || '').trim()
      if (cancelled) return
      setAddressHint(text)
    }
    void fill()
    return () => {
      cancelled = true
    }
  }, [isCreateMode, point?.id, point?.geom5181, vworldApiKey])

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

  const handleCreateSave = async () => {
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
    setSaving(true)
    setCreateError(null)
    try {
      const res = await call('', 'POST', {
        service: 'gcpService',
        action: 'create',
        params: {
          gcpnum,
          x,
          y,
          z: z ?? 0,
          placeNote: createForm.placeNote.trim(),
        },
      })
      if (!res?.success) {
        setCreateError(String(res?.error ?? '등록에 실패했습니다.'))
        return
      }
      const data = (res.data ?? res) as { id?: string }
      const id = String(data.id ?? '').trim()
      clearGcpCreate()
      await refresh()
      onSaved?.()
      if (id) onCreated(id)
      else onClose()
    } catch {
      setCreateError('등록에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateCancel = () => {
    clearGcpCreate()
    onClose()
  }

  if (isCreateMode) {
    const canCreate = Boolean(createForm.gcpnum.trim()) && !saving
    const createToolbar = {
      isEditing: true,
      isCreateMode: true,
      saving,
      onEdit: () => undefined,
      onSave: () => void handleCreateSave(),
      onCancel: handleCreateCancel,
      editable: true,
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="GCP 상세"
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
                placeholder="예: 맨홀 / 중앙"
              />
            </DetailAttrRow>
            <DetailAttrRow label="주소(참고)" isLast labelClassName={CREATE_LABEL}>
              <span className="text-[11px] text-muted-foreground">
                {createForm.address || '지도 위치 기준으로 표시'}
              </span>
            </DetailAttrRow>
          </DetailAttrTable>
        </MapSideDetailScroll>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
          <LayerRowPanelButton type="button" disabled={!canCreate} onClick={() => void handleCreateSave()}>
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
          title="GCP 상세"
          isEditing={false}
          saving={false}
          onEdit={() => undefined}
          onSave={() => undefined}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
          actionsPlacement="footer"
        />
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">GCP를 찾을 수 없습니다.</p>
      </div>
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await call('', 'POST', {
        service: 'gcpService',
        action: 'update',
        params: {
          id: point.id,
          placeNote: draft.placeNote.trim(),
        },
      })
      if (!res?.success) {
        window.alert(String(res?.error ?? '저장에 실패했습니다.'))
        return
      }
      setIsEditing(false)
      await refresh()
      onSaved?.()
    } catch {
      window.alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setDraft(draftFrom(point))
    setIsEditing(false)
  }

  const editToolbarProps = {
    isEditing,
    saving,
    onEdit: () => {
      setDraft(draftFrom(point))
      setIsEditing(true)
    },
    onSave: () => void handleSave(),
    onCancel: handleCancelEdit,
    editable: true,
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title="GCP 상세"
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
                placeholder="예: 맨홀 / 중앙"
              />
            ) : (
              point.placeNote || '—'
            )}
          </DetailAttrRow>
          <DetailAttrRow label="주소(참고)" isLast>
            {addressHint || '—'}
          </DetailAttrRow>
        </DetailAttrTable>

        <GcpPhotoSection gcpId={point.id} canEdit />
      </MapSideDetailScroll>

      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
        <LayerRowEditToolbar {...editToolbarProps} />
      </div>
    </div>
  )
}
