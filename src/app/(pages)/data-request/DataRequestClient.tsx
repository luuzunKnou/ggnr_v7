'use client'

import { DataRequestApproveClient } from '@/app/(pages)/data-request-approve/DataRequestApproveClient'

/** 데이터 요청 — 승인 화면과 동일 UI (승인·반려 없음, 승인상태 기본=전체) */
export function DataRequestClient() {
  return <DataRequestApproveClient listMode="request" />
}
