'use client'

import { FileDown, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  onExcel?: () => void
  onPdf?: () => void
  /** inline: 검색조건 옆 / floatTools: 관망조회 구역설정~도구와 동일 세로 플로팅 */
  variant?: 'inline' | 'floatTools'
}

const FLOAT_TOOL_BTN =
  'flex h-7 w-full shrink-0 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap rounded border border-border bg-background px-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50'

/** 엑셀·PDF — 목업(버튼만) */
export function OdorReportExportButtons({
  className,
  onExcel,
  onPdf,
  variant = 'inline',
}: Props) {
  if (variant === 'floatTools') {
    return (
      <div className={cn('flex w-[5rem] flex-col gap-1 bg-transparent p-1', className)}>
        <button
          type="button"
          title="엑셀"
          onClick={() => onExcel?.()}
          className={FLOAT_TOOL_BTN}
        >
          <FileDown className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
          엑셀
        </button>
        <button
          type="button"
          title="PDF 인쇄"
          onClick={() => onPdf?.()}
          className={FLOAT_TOOL_BTN}
        >
          <FileText className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
          PDF
        </button>
      </div>
    )
  }

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
