'use client'

import { useEffect, useState } from 'react'
import { withBasePath } from '@/lib/basePath'
import {
  SecurityPledgeModal,
  type SecurityPledgeSubmitResult,
} from '@/app/(pages)/_components/securityPledge/SecurityPledgeModal'
import {
  registerExcelPledgeOpener,
  type ExcelPledgeRequest,
} from '@/app/(pages)/_components/securityPledge/excelPledgeGate'

async function postExcelPledge(
  req: ExcelPledgeRequest,
  pledgeName: string
): Promise<SecurityPledgeSubmitResult> {
  const form = new FormData()
  form.set('pledgeName', pledgeName)
  form.set('tableKorName', req.tableKorName)
  form.set('fileName', req.fileName)
  const copy = new Uint8Array(req.bytes.byteLength)
  copy.set(req.bytes)
  form.set(
    'file',
    new Blob([copy], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    req.fileName
  )

  const res = await fetch(withBasePath('/api/data-request/submit-excel'), {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  const data = (await res.json().catch(() => ({}))) as SecurityPledgeSubmitResult & {
    error?: string
  }
  if (!res.ok || !data.success) {
    return {
      success: false,
      error: typeof data.error === 'string' ? data.error : '엑셀 접수 실패',
    }
  }
  return { success: true, fileGroupKey: data.fileGroupKey }
}

/** 루트 레이아웃 — 엑셀 다운로드 보안서약 호스트 */
export function SecurityPledgeExcelHost() {
  const [pending, setPending] = useState<ExcelPledgeRequest | null>(null)

  useEffect(() => {
    registerExcelPledgeOpener((req) => setPending(req))
    return () => registerExcelPledgeOpener(null)
  }, [])

  return (
    <SecurityPledgeModal
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      tableKorName={pending?.tableKorName ?? ''}
      mediaLabel={
        pending
          ? `${(pending.tableKorName || '엑셀').trim()} EXCEL 파일 다운로드`
          : 'EXCEL 파일 다운로드'
      }
      onSubmit={async (pledgeName) => {
        if (!pending) return { success: false, error: '대상 없음' }
        return postExcelPledge(pending, pledgeName)
      }}
    />
  )
}
