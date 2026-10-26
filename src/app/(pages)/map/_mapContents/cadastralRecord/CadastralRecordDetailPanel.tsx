'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../_mapComponents/standard/ServiceFileImagePreview'
import { getCadastralDocType } from './cadastralRecordConfig'
import {
  formatRecordLocation,
  getCadastralParcelById,
  type CadastralRecordDoc,
} from './cadastralRecordMock'

type Props = {
  recordId: string
  onClose: () => void
}

const NOOP = () => undefined

function TypeBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="standard-status-badge max-w-full truncate"
      style={{
        backgroundColor: `${color}33`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}80`,
      }}
      title={label}
    >
      {label}
    </span>
  )
}

export function CadastralRecordDetailPanel({ recordId, onClose }: Props) {
  const parcel = useMemo(() => getCadastralParcelById(recordId), [recordId])
  const [docId, setDocId] = useState<string | null>(parcel?.docs[0]?.id ?? null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    setDocId(parcel?.docs[0]?.id ?? null)
    setPreviewOpen(false)
  }, [parcel])

  if (!parcel) {
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
        <div className="standard-detail-empty-dashed m-2">필지를 찾을 수 없습니다.</div>
      </div>
    )
  }

  const loc = formatRecordLocation(parcel)
  const selected: CadastralRecordDoc | undefined =
    parcel.docs.find((d) => d.id === docId) ?? parcel.docs[0]
  const gallery: ServiceFilePreviewItem[] = parcel.docs.map((d) => ({
    url: d.previewUrl,
    fileName: d.fileName,
    kind: 'image',
  }))
  const previewIndex = selected
    ? Math.max(
        0,
        gallery.findIndex((i) => i.fileName === selected.fileName)
      )
    : 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={`${loc} ${parcel.jibun}`}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
        className="px-2 py-1"
      />

      <div className="min-h-0 max-h-[38%] shrink-0 overflow-auto border-b border-border">
        <table className="standard-list-table">
          <thead className="standard-table-thead">
            <tr>
              <th className="standard-table-th standard-table-th-left w-[28%]">문서 종류</th>
              <th className="standard-table-th standard-table-th-center w-[14%]">권</th>
              <th className="standard-table-th standard-table-th-center w-[16%]">페이지</th>
              <th className="standard-table-th standard-table-th-left w-[42%]">파일명</th>
            </tr>
          </thead>
          <tbody>
            {parcel.docs.map((d) => {
              const doc = getCadastralDocType(d.docType)
              const isSelected = selected?.id === d.id
              return (
                <tr
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDocId(d.id)}
                  onDoubleClick={() => {
                    setDocId(d.id)
                    setPreviewOpen(true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setDocId(d.id)
                    }
                  }}
                  className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                >
                  <td className="standard-table-td-compact">
                    <TypeBadge label={doc.label} color={doc.color} />
                  </td>
                  <td className="standard-table-td-date text-center">{d.volumeNo}</td>
                  <td className="standard-table-td-date text-center">{d.pageNo}</td>
                  <td className="standard-table-td-text-muted" title={d.fileName}>
                    {d.fileName}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected ? (
        <button
          type="button"
          className="m-2 flex min-h-0 flex-1 cursor-pointer overflow-hidden rounded border border-border bg-muted/30 p-0 text-left transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => setPreviewOpen(true)}
          aria-label={`${selected.fileName} 크게 보기`}
          title="클릭하면 크게 보기"
        >
          <img
            src={selected.previewUrl}
            alt={selected.fileName}
            className="h-full w-full object-contain"
          />
        </button>
      ) : (
        <div className="standard-detail-empty-dashed m-2">문서가 없습니다.</div>
      )}

      {previewOpen && selected ? (
        <ServiceFileImagePreview
          items={gallery}
          initialIndex={previewIndex}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}
