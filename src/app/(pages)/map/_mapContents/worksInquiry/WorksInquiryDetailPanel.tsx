'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  getWorksInquiryBinding,
  worksInquiryStatusClass,
  type WorksInquirySerEng,
} from './worksInquiryBinding'
import { getWorksInquiryRowById } from './worksInquiryMock'

type Props = {
  serEng: WorksInquirySerEng
  detailId: string
  onClose: () => void
}

type FieldRow = { label: string; value: string }

export function WorksInquiryDetailPanel({ serEng, detailId, onClose }: Props) {
  const binding = getWorksInquiryBinding(serEng)
  const row = getWorksInquiryRowById(serEng, detailId)
  const isPermit = binding?.kind === 'permit'

  const fields: FieldRow[] = row
    ? isPermit
      ? [
          { label: '허가번호', value: row.permitNo ?? '' },
          { label: '허가명', value: row.name },
          { label: '위치', value: row.location },
          { label: '공종', value: row.workType ?? '' },
          { label: '신청인', value: row.applicant ?? '' },
          { label: '허가일', value: row.startDate },
          { label: '만료일', value: row.endDate },
          { label: '비고', value: row.remark ?? '' },
        ]
      : [
          { label: '사업명', value: row.name },
          { label: '위치', value: row.location },
          { label: '사업연도', value: row.year ?? '' },
          { label: '착공', value: row.startDate },
          { label: '준공', value: row.endDate },
          { label: '사업비', value: row.budget ?? '' },
          { label: '시공사', value: row.contractor ?? '' },
          { label: '감독', value: row.supervisor ?? '' },
          { label: '비고', value: row.remark ?? '' },
        ]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <div className="min-w-0 flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">
            {binding?.detailTitle ?? '상세'}
          </span>
          {row && (
            <span
              className={cn(
                'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                worksInquiryStatusClass(row.status)
              )}
            >
              {row.statusLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {!row ? (
          <div className="px-1 py-8 text-center text-slate-500">항목을 찾을 수 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
            {fields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 px-2.5 py-1.5"
              >
                <dt className="shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">
                  {field.label}
                </dt>
                <dd className="min-w-0 break-words text-slate-800">{field.value.trim() || '—'}</dd>
              </div>
            ))}
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  )
}
