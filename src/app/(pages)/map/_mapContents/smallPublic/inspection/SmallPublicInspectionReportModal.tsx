'use client'

import { useMemo, useRef } from 'react'
import { FileDown, Printer } from 'lucide-react'
import { smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'
import {
  buildSmallPublicReportHtml,
  downloadSmallPublicReportHwpx,
  type SmallPublicInspectionReport,
} from './smallPublicInspectionReport'

/** 보고서 미리보기 — 화면에서 크게 보고 인쇄·한글 다운로드 */
export function SmallPublicInspectionReportModal({
  report,
  prev,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  report: SmallPublicInspectionReport
  prev: SmallPublicInspectionReport | null
  onClose: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => buildSmallPublicReportHtml(report, prev), [report, prev])

  const print = () => {
    const win = iframeRef.current?.contentWindow
    if (!win) {
      window.alert('미리보기를 불러오는 중입니다. 잠시 후 다시 시도하세요.')
      return
    }
    win.focus()
    win.print()
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="half"
      title={report.title}
      subtitle={`대상 ${report.rows.length}곳 — 미리보기에서 인쇄하거나 한글 보고서로 내려받을 수 있습니다.`}
      showHeaderClose
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2.5"
      footer={
        <div className="flex w-full items-center justify-end gap-2.5">
          <button type="button" className={smallPublicBtnPrimary} onClick={() => downloadSmallPublicReportHwpx(report, prev)}>
            <FileDown className="h-3 w-3" />
            한글 다운로드
          </button>
          <button type="button" className={smallPublicBtnPrimary} onClick={print}>
            <Printer className="h-3 w-3" />
            인쇄
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onClose}>
            닫기
          </button>
        </div>
      }
    >
      <iframe
        ref={iframeRef}
        title="보고서 미리보기"
        srcDoc={html}
        className="min-h-0 w-full flex-1 rounded border border-border bg-white"
      />
    </SmallPublicModalShell>
  )
}
