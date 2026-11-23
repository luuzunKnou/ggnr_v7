'use client'

import { FileDown, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  onExcel?: () => void
  onPdf?: () => void
}

/** 엑셀·PDF — 목업(버튼만) */
export function OdorReportExportButtons({ className, onExcel, onPdf }: Props) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      <button
        type="button"
        title="엑셀"
        onClick={() => onExcel?.()}
        className="standard-detail-hdr-btn cursor-pointer"
      >
        <FileDown className="h-3 w-3" aria-hidden />
        엑셀
      </button>
      <button
        type="button"
        title="PDF 인쇄"
        onClick={() => onPdf?.()}
        className="standard-detail-hdr-btn cursor-pointer"
      >
        <FileText className="h-3 w-3" aria-hidden />
        PDF
      </button>
    </div>
  )
}
