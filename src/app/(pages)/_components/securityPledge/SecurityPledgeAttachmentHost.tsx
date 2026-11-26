'use client'

import { useEffect, useState } from 'react'
import {
  SecurityPledgeModal,
  postDataRequestJson,
} from '@/app/(pages)/_components/securityPledge/SecurityPledgeModal'
import {
  registerAttachmentPledgeOpener,
  type AttachmentPledgeRequest,
} from '@/app/(pages)/_components/securityPledge/attachmentPledgeGate'

function toSubmitBody(req: AttachmentPledgeRequest, pledgeName: string) {
  if (req.mode === 'folderZip') {
    return {
      pledgeName,
      mode: 'folderZip',
      serEng: req.serEng,
      layer: req.layer,
      key: req.key,
      label: req.label,
      tableKorName: req.tableKorName,
      tableName: req.tableName || req.layer,
      schema: req.schema,
    }
  }
  if (req.mode === 'multi') {
    return {
      pledgeName,
      mode: 'multi',
      serEng: req.serEng,
      files: req.files,
      zipName: req.zipName,
      tableKorName: req.tableKorName,
      tableName: req.tableName,
      schema: req.schema,
    }
  }
  if (req.mode === 'managed') {
    if (req.source === 'cadJob') {
      return {
        pledgeName,
        jobId: req.paths[0] ?? '',
        tableKorName: req.tableKorName,
      }
    }
    return {
      pledgeName,
      source: req.source,
      paths: req.paths,
      zipName: req.zipName,
      tableKorName: req.tableKorName,
    }
  }
  return {
    pledgeName,
    mode: 'single',
    serEng: req.serEng,
    pathB64: req.pathB64,
    path: req.path,
    tableKorName: req.tableKorName,
    tableName: req.tableName,
    schema: req.schema,
  }
}

function submitUrlFor(req: AttachmentPledgeRequest): string {
  if (req.mode === 'managed') {
    return req.source === 'cadJob'
      ? '/api/data-request/submit-cad-job'
      : '/api/data-request/submit-managed-path'
  }
  return '/api/data-request/submit-attachment'
}

/** 루트 레이아웃 — 첨부 다운로드 보안서약 모달 호스트 */
export function SecurityPledgeAttachmentHost() {
  const [pending, setPending] = useState<AttachmentPledgeRequest | null>(null)

  useEffect(() => {
    registerAttachmentPledgeOpener((req) => setPending(req))
    return () => registerAttachmentPledgeOpener(null)
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
          ? pending.mode === 'managed' && pending.source === 'cadJob'
            ? `${(pending.tableKorName || 'CAD').trim()} CAD 다운로드`
            : pending.mode === 'managed' && pending.source === 'aerial'
              ? `${(pending.tableKorName || '정사영상').trim()} 다운로드`
              : `${(pending.tableKorName || '첨부').trim()} 첨부파일 다운로드`
          : '첨부파일 다운로드'
      }
      onSubmit={async (pledgeName) => {
        if (!pending) return { success: false, error: '대상 없음' }
        return postDataRequestJson(
          submitUrlFor(pending),
          toSubmitBody(pending, pledgeName)
        )
      }}
    />
  )
}
