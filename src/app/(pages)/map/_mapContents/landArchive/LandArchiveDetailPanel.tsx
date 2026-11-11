'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { withBasePath } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../_mapComponents/MapContext'
import { LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../_mapComponents/standard/ServiceFileImagePreview'
import {
  formatRecordLocation,
  landArchiveParcelKey,
  type LandArchiveFile,
  type LandArchiveParcelGeom,
  type LandArchiveParcelRef,
} from './landArchiveConfig'
import { useLandArchiveParcelLayer } from './useLandArchiveParcelLayer'

function previewSrc(url: string): string {
  return url.startsWith('/') ? withBasePath(url) : url
}

type Props = {
  recordId: string
  onClose: () => void
}

const NOOP = () => undefined

export function LandArchiveDetailPanel({ recordId, onClose }: Props) {
  const mapContext = useMapContext()
  const [file, setFile] = useState<LandArchiveFile | null | undefined>(undefined)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [locateHint, setLocateHint] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<LandArchiveParcelGeom[]>([])
  const drawnRef = useRef(drawn)
  drawnRef.current = drawn

  useEffect(() => {
    let cancelled = false
    setFile(undefined)
    setPreviewOpen(false)
    setSelectedKey(null)
    setLocateHint(null)
    setDrawn([])
    void call('', 'POST', {
      service: 'landArchiveService',
      action: 'getById',
      params: { id: recordId },
    })
      .then(async (res) => {
        if (cancelled) return
        const item = (res?.success ? res.data : null) as LandArchiveFile | null
        setFile(item ?? null)
        const parcels = item?.parcels ?? []
        if (parcels.length === 0) return
        const loc = await call('', 'POST', {
          service: 'landArchiveService',
          action: 'locateParcels',
          params: { parcels },
        })
        if (cancelled) return
        const items = (loc?.success ? loc.data?.items : null) as LandArchiveParcelGeom[] | null
        setDrawn(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setFile(null)
      })
    return () => {
      cancelled = true
    }
  }, [recordId])

  const { fitToParcel } = useLandArchiveParcelLayer({
    parcels: drawn,
    focusedKey: selectedKey,
    onSelect: (key) => {
      setSelectedKey(key)
      setLocateHint(null)
    },
  })

  const flyToParcel = useCallback(
    (p: LandArchiveParcelRef) => {
      const key = landArchiveParcelKey(p)
      setSelectedKey(key)
      const hit = drawnRef.current.find((row) => landArchiveParcelKey(row) === key)
      if (!hit) {
        setLocateHint('해당 필지를 찾을 수 없습니다.')
        return
      }
      if (!mapContext?.mapInstanceRef?.current) {
        setLocateHint('지도를 찾을 수 없습니다.')
        return
      }
      setLocateHint(null)
      fitToParcel(hit)
    },
    [fitToParcel, mapContext]
  )

  if (file === undefined) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지적기록물 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
          className="px-2 py-1"
        />
        <div className="standard-detail-empty-dashed m-2">기록물을 불러오는 중…</div>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지적기록물 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
          className="px-2 py-1"
        />
        <div className="standard-detail-empty-dashed m-2">기록물을 찾을 수 없습니다.</div>
      </div>
    )
  }

  const parcels: LandArchiveParcelRef[] = file.parcels ?? []
  const gallery: ServiceFilePreviewItem[] = [
    { url: previewSrc(file.previewUrl), fileName: file.fileName, kind: 'image' },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={`${file.docTypeLabel} ${file.fileName}`}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
        className="px-2 py-1"
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {file.previewUrl ? (
          <button
            type="button"
            className="block w-full shrink-0 cursor-pointer overflow-hidden border-0 bg-background p-0 text-left leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => setPreviewOpen(true)}
            aria-label={`${file.fileName} 크게 보기`}
            title="클릭하면 크게 보기"
          >
            <img
              src={previewSrc(file.previewUrl)}
              alt={file.fileName}
              className="mx-auto block h-auto w-auto max-h-[min(46vh,420px)] max-w-full"
            />
          </button>
        ) : (
          <div className="standard-detail-empty-dashed m-2 shrink-0">문서가 없습니다.</div>
        )}

        {file.parcelCount > 0 ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {locateHint ? (
              <div className="shrink-0 border-t border-border px-2 py-1 text-xs text-muted-foreground">
                {locateHint}
              </div>
            ) : null}
            <div className="standard-list-scroll min-h-0 min-w-0 flex-1 border-t border-border">
              <table className="standard-list-table">
                <thead className="standard-table-thead">
                  <tr>
                    <th className="standard-table-th standard-table-th-left w-[58%]">소재지</th>
                    <th className="standard-table-th standard-table-th-left w-[42%]">지번</th>
                  </tr>
                </thead>
                <tbody>
                  {parcels.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="standard-table-empty">
                        지번을 불러오는 중…
                      </td>
                    </tr>
                  ) : (
                    parcels.map((p, i) => {
                      const loc = formatRecordLocation(p)
                      const key = landArchiveParcelKey(p)
                      const isSelected = selectedKey === key
                      return (
                        <tr
                          key={`${key}-${i}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => flyToParcel(p)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              flyToParcel(p)
                            }
                          }}
                          className={cn(
                            'standard-list-row',
                            isSelected && 'standard-list-row-selected'
                          )}
                        >
                          <td className="standard-table-td-text" title={loc}>
                            {loc || '—'}
                          </td>
                          <td className="standard-table-td-text" title={p.jibun}>
                            {p.jibun || '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="standard-detail-empty-dashed m-2 shrink-0">이 장에 묶인 지번이 없습니다.</div>
        )}
      </div>

      {previewOpen ? (
        <ServiceFileImagePreview
          items={gallery}
          initialIndex={0}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}
