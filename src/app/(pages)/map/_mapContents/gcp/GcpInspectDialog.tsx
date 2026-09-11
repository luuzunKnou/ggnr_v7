'use client'

import { useMemo, useRef, useState } from 'react'
import { Camera, Check, X } from 'lucide-react'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  DetailAttrRow,
  DetailAttrSectionTitle,
  DetailAttrTable,
  LayerRowEditHeader,
  LayerRowPanelButton,
} from '../../_mapComponents/layerRowEdit'
import { GCP_STATUS_OPTIONS, type GcpStatus } from './gcpConfig'
import { displayStatusOf, type GcpInspectItem, type GcpInspection, type GcpPhoto, type GcpPoint } from './gcpDummyData'
import { applyGcpInspection, emptyInspectItem, newInspectId } from './gcpProtoStore'
import { useGcpProtoState } from './useGcpProtoState'

type Props = {
  gcpIds: string[]
  onClose: () => void
}

function defaultInspectStatus(point: GcpPoint | undefined): GcpStatus {
  if (!point) return 'ok'
  const shown = displayStatusOf(point)
  if (shown === '비정상') return 'abnormal'
  if (shown === '점검필요') return 'due'
  return 'ok'
}

function readFilesAsPhotos(files: FileList | null): Promise<GcpPhoto[]> {
  if (!files?.length) return Promise.resolve([])
  return Promise.all(
    Array.from(files).map(
      (file) =>
        new Promise<GcpPhoto>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            resolve({
              id: `ph-${file.name}-${file.size}-${Date.now()}`,
              name: file.name,
              url: String(reader.result ?? ''),
            })
          }
          reader.readAsDataURL(file)
        })
    )
  )
}

export function GcpInspectDialog({ gcpIds, onClose }: Props) {
  const { points } = useGcpProtoState()
  const targets = useMemo(
    () => points.filter((p) => gcpIds.includes(p.id)),
    [points, gcpIds]
  )
  const [inspectDate, setInspectDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<GcpInspectItem[]>(() =>
    gcpIds.map((id) => {
      const point = points.find((p) => p.id === id)
      return emptyInspectItem(id, defaultInspectStatus(point))
    })
  )
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const patchItem = (gcpId: string, next: Partial<GcpInspectItem>) => {
    setItems((prev) => prev.map((row) => (row.gcpId === gcpId ? { ...row, ...next } : row)))
  }

  const applyAllStatus = (status: GcpStatus) => {
    setItems((prev) => prev.map((row) => ({ ...row, status })))
  }

  const handlePhotos = async (gcpId: string, files: FileList | null) => {
    const photos = await readFilesAsPhotos(files)
    if (!photos.length) return
    setItems((prev) => prev.map((row) => (row.gcpId === gcpId ? { ...row, photos } : row)))
  }

  const handleSave = () => {
    if (!inspectDate || !items.length) return
    const row: GcpInspection = {
      id: newInspectId(),
      inspectDate,
      inspector: '담당자',
      items,
    }
    applyGcpInspection(row)
    onClose()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title="점검 추가"
        isEditing={false}
        saving={false}
        onEdit={() => undefined}
        onSave={() => undefined}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        <DetailAttrSectionTitle>점검 정보</DetailAttrSectionTitle>
        <DetailAttrTable>
          <DetailAttrRow label="점검일자" isLast labelClassName="flex items-center">
            <input
              type="date"
              value={inspectDate}
              onChange={(e) => setInspectDate(e.target.value)}
              className="h-7 w-full rounded border border-border bg-background px-1.5 text-xs"
            />
          </DetailAttrRow>
        </DetailAttrTable>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">공통 상태</span>
          {GCP_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => applyAllStatus(opt.value)}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"
            >
              {opt.label}
            </button>
          ))}
        </div>

        {targets.map((point) => {
          const item = items.find((row) => row.gcpId === point.id)
          if (!item) return null
          return (
            <div key={point.id} className="mt-4">
              <DetailAttrSectionTitle>
                {point.gcpnum} · {point.placeNote}
              </DetailAttrSectionTitle>
              <DetailAttrTable>
                <DetailAttrRow label="상태" labelClassName="flex items-center">
                  <select
                    value={item.status}
                    onChange={(e) => patchItem(point.id, { status: e.target.value as GcpStatus })}
                    className="h-7 w-full rounded border border-border bg-background px-1.5 text-xs"
                  >
                    {GCP_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </DetailAttrRow>
                <DetailAttrRow label="점검 내용" labelClassName="flex items-center">
                  <textarea
                    value={item.note}
                    onChange={(e) => patchItem(point.id, { note: e.target.value })}
                    rows={3}
                    placeholder="점검 내용을 입력하세요"
                    className="w-full resize-y rounded border border-border bg-background px-1.5 py-1 text-xs"
                  />
                </DetailAttrRow>
                <DetailAttrRow
                  label="위치 사진"
                  isLast
                  labelClassName="flex items-center"
                  valueClassName="break-all"
                >
                  <div className="space-y-1.5">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => fileRefs.current[point.id]?.click()}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          사진 교체
                        </button>
                        {item.photos.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => patchItem(point.id, { photos: [] })}
                            className="text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            교체 취소
                          </button>
                        ) : null}
                        <input
                          ref={(el) => {
                            fileRefs.current[point.id] = el
                          }}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            void handlePhotos(point.id, e.target.files)
                            e.target.value = ''
                          }}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        위치 사진을 새로 찍었다면 넣어 주세요.
                      </p>
                    </div>
                    {(item.photos.length ? item.photos : point.photos).length === 0 ? (
                      <p className="text-muted-foreground">등록된 위치 사진이 없습니다.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(item.photos.length ? item.photos : point.photos).map((photo) => (
                          <figure key={photo.id} className="overflow-hidden rounded border border-border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.url} alt={photo.name} className="h-20 w-full object-cover" />
                            <figcaption className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">
                              {photo.name}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </DetailAttrRow>
              </DetailAttrTable>
            </div>
          )
        })}
      </MapSideDetailScroll>

      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border bg-background px-3 py-2">
        <LayerRowPanelButton type="button" onClick={handleSave}>
          <Check className="h-3 w-3 shrink-0" aria-hidden />
          확인
        </LayerRowPanelButton>
        <LayerRowPanelButton type="button" onClick={onClose}>
          <X className="h-3 w-3 shrink-0" aria-hidden />
          취소
        </LayerRowPanelButton>
      </div>
    </div>
  )
}
