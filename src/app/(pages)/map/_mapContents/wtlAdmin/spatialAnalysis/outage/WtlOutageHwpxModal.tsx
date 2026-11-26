'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { call } from '@/lib/api'
import { captureOutageZoneImage } from './wtlOutageHwpxCapture'
import { outagePolygonsOf, type WtlOutageResult } from './wtlOutageSample'

export type WtlOutageHwpxFields = {
  title: string
  reason: string
  /** datetime-local 값(YYYY-MM-DDTHH:mm) */
  startAt: string
  endAt: string
}

type Props = {
  result: WtlOutageResult
  defaultTitle?: string
  defaultReason?: string
  defaultStart?: string
  defaultEnd?: string
  onClose: () => void
  /** 다운로드 성공 — 입력값을 이력에 반영 */
  onDone: (fields: WtlOutageHwpxFields, info: { fileName: string; areas: string }) => void
}

type ExportBody = { fileName?: string; base64?: string; areas?: string; error?: string }

function downloadBase64(base64: string, fileName: string) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * 단수 알림문 한글 다운로드 — v6 stopWater 입력 항목(알림 제목·단수 사유·시작일·종료일)과 같은 순서·검증
 */
export function WtlOutageHwpxModal({
  result,
  defaultTitle = '',
  defaultReason = '',
  defaultStart = '',
  defaultEnd = '',
  onClose,
  onDone,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [reason, setReason] = useState(defaultReason)
  const [startAt, setStartAt] = useState(defaultStart)
  const [endAt, setEndAt] = useState(defaultEnd)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const timeInvalid = Boolean(startAt && endAt && endAt < startAt)

  const submit = async () => {
    // v6 checkRequired 와 같은 순서·문구
    const missing = !title.trim()
      ? '알림 제목을 입력해주세요.'
      : !reason.trim()
        ? '단수 사유를 입력해주세요.'
        : !startAt
          ? '시작일을 입력해주세요.'
          : !endAt
            ? '종료일을 입력해주세요.'
            : timeInvalid
              ? '종료일은 시작일 이후로 입력해주세요.'
              : ''
    if (missing) {
      setMessage(missing)
      return
    }
    setBusy(true)
    setMessage('알림문용 구역을 맞추는 중입니다…')
    try {
      const rings = result.rings && result.rings.length > 0 ? result.rings : [result.ring]
      const sourcePolygons = outagePolygonsOf(result)
      // 알림문만 — 화면 지도와 달리 틈 ~45m로 면을 합쳐 구역도·대상지역 개수를 맞춤
      const clusteredRes = await call('', 'POST', {
        service: 'wtlOutageService',
        action: 'clusterWtlOutageHwpxPolygons',
        params: { polygons: sourcePolygons, rings },
      })
      const clusteredBody = (clusteredRes?.data ?? clusteredRes) as {
        polygons?: [number, number][][][]
        error?: string
      }
      if (clusteredBody.error) {
        setMessage(clusteredBody.error)
        return
      }
      const polygons =
        clusteredBody.polygons && clusteredBody.polygons.length > 0
          ? clusteredBody.polygons
          : sourcePolygons
      setMessage('단수구역도 생성 중입니다…')
      const image = await captureOutageZoneImage(polygons)
      if (!image) setMessage('단수구역도 캡처에 실패해 그림 없이 만듭니다…')
      else setMessage('한글 파일을 만드는 중입니다…')
      const res = await call('', 'POST', {
        service: 'wtlOutageService',
        action: 'exportWtlOutageHwpx',
        params: { title, reason, startAt, endAt, rings, polygons, imageBase64: image ?? '' },
      })
      const body = (res?.data ?? res) as ExportBody
      if (body.error || !body.base64 || !body.fileName) {
        setMessage(body.error || '한글 파일 생성에 실패했습니다.')
        return
      }
      downloadBase64(body.base64, body.fileName)
      onDone(
        { title: title.trim(), reason: reason.trim(), startAt, endAt },
        { fileName: body.fileName, areas: body.areas ?? '' }
      )
    } catch {
      setMessage('한글 파일 생성에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wtl-outage-hwpx-title"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-md border border-border bg-background shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span id="wtl-outage-hwpx-title" className="text-sm font-semibold text-foreground">
            단수 알림문 한글 다운로드
          </span>
          <button
            type="button"
            className="standard-panel-close"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5 px-3 py-3 text-xs">
          <label className="block space-y-1">
            <span className="text-muted-foreground">알림 제목</span>
            <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">단수 사유</span>
            <input value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-muted-foreground">시작일</span>
              <input
                type="datetime-local"
                value={startAt}
                disabled={busy}
                onChange={(e) => setStartAt(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">종료일</span>
              <input
                type="datetime-local"
                value={endAt}
                disabled={busy}
                onChange={(e) => setEndAt(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          {timeInvalid && <p className="text-[11px] text-rose-600">종료일은 시작일 이후로 입력해주세요.</p>}
          <p className="text-[10px] text-muted-foreground">
            알림문을 만들 때만 가까운 단수 면(틈 약 45m)을 합칩니다. 구역도와 대상지역 문구는 그 합친 면을 같이 쓰고, 화면 지도의 붉은 면은 그대로입니다.
          </p>
          {message && (
            <p role="status" className="text-[11px] text-foreground">
              {message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? '만드는 중…' : '한글 다운로드'}
          </button>
        </div>
      </div>
    </div>
  )
}
