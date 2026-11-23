'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { call } from '@/lib/api'
import { withBasePath, withBasePathNav } from '@/lib/basePath'
import { MAP_UI_Z } from '@/lib/mapUiZIndex'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'

export type SecurityPledgeSubmitResult = {
  success: boolean
  error?: string
  code?: string
  warning?: string | null
  fileGroupKey?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 자료 제목(한글) */
  tableKorName: string
  /** 제공 매체 문구에 쓸 한글명 — 기본 tableKorName */
  mediaKorName?: string
  /** 제공 매체 전체 문구 — 있으면 mediaKorName 조합 대신 사용 (예: 첨부파일) */
  mediaLabel?: string
  /** 동의 시 호출. pledgeName 전달. 성공 시 success true */
  onSubmit: (pledgeName: string) => Promise<SecurityPledgeSubmitResult>
}

function buildDataRequestHref(fromPath: string): string {
  const q = new URLSearchParams()
  if (fromPath) q.set('from', fromPath)
  const qs = q.toString()
  return withBasePathNav(`/data-request${qs ? `?${qs}` : ''}`)
}

export function SecurityPledgeModal({
  open,
  onOpenChange,
  tableKorName,
  mediaKorName,
  mediaLabel: mediaLabelProp,
  onSubmit,
}: Props) {
  const { data: session } = useSession()
  const [usrName, setUsrName] = useState('')
  const [sggNm, setSggNm] = useState('')
  const [today, setToday] = useState('')
  const [pledgeName, setPledgeName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setPledgeName('')
      setSubmitting(false)
      return
    }
    let cancelled = false
    void call('', 'POST', {
      service: 'dataRequestService',
      action: 'getPledgeContext',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const d = res?.data ?? res
        if (d?.success && d.data) {
          setUsrName(String(d.data.usrName ?? '').trim())
          setSggNm(String(d.data.sggNm ?? '').trim())
          setToday(String(d.data.today ?? '').trim())
        } else {
          const fallback = String(session?.user?.name ?? '').trim()
          setUsrName(fallback)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsrName(String(session?.user?.name ?? '').trim())
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, session?.user?.name])

  const mediaLabel = useMemo(() => {
    const override = String(mediaLabelProp ?? '').trim()
    if (override) return override
    const kor = (mediaKorName ?? tableKorName).trim() || '자료'
    return `${kor} SHP 파일 다운로드`
  }, [mediaLabelProp, mediaKorName, tableKorName])

  const canAgree = pledgeName.trim().length > 0 && !submitting

  const handleAgree = async () => {
    if (!canAgree) return
    const expected = usrName.trim()
    const input = pledgeName.trim()
    if (!expected) {
      window.alert('사용자 성명을 확인할 수 없습니다.')
      return
    }
    if (input !== expected) {
      window.alert('서약자 성명이 계정 이름과 다릅니다.')
      return
    }
    setSubmitting(true)
    try {
      const result = await onSubmit(input)
      if (!result.success) {
        window.alert(result.error ?? '접수에 실패했습니다.')
        return
      }
      if (result.warning) {
        window.alert(String(result.warning))
      }
      onOpenChange(false)
      const go = window.confirm(
        '보안서약서가 접수되었습니다.\n데이터 요청 페이지로 바로 이동하시겠습니까?'
      )
      if (go) {
        const fromPath =
          typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}`
            : ''
        window.location.assign(buildDataRequestHref(fromPath))
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '접수에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        layerZIndex={MAP_UI_Z.securityPledge}
        className="flex max-h-[min(92vh,720px)] w-[min(36rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:rounded-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3">
          <DialogTitle className="text-center text-base font-semibold">
            보안서약서
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-foreground">
          <p>
            본 기관 ( 또는 인 ) 자료의 제공을 신청함에 있어 다음의 사항을 준수할 것을
            엄숙히 서약합니다.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>제공받은 자료를 명시된 목적 이외의 용도로 사용하지 아니한다.</li>
            <li>
              제공받은 자료를 사용함에 있어 기밀사항 및 자료등을 외부에 누설 또는
              유출하지 아니한다.
            </li>
          </ol>
          <p>이를 위반하였을 경우,</p>
          <p>
            동기여하를 막론하고 보안 관련 제반 법규에 의거 처벌 받음은 물론 , 어떠한
            제재나 조치도 이의 없이 감수하겠음을 서약합니다.
          </p>

          <table className="w-full border-collapse border border-border text-[12px]">
            <tbody>
              <tr>
                <th className="w-24 border border-border bg-muted/40 px-2 py-1.5 text-left font-medium">
                  성명
                </th>
                <td className="border border-border px-2 py-1.5">{usrName || '-'}</td>
              </tr>
              <tr>
                <th className="border border-border bg-muted/40 px-2 py-1.5 text-left font-medium">
                  자료 제목
                </th>
                <td className="border border-border px-2 py-1.5">
                  {tableKorName.trim() || '-'}
                </td>
              </tr>
              <tr>
                <th className="border border-border bg-muted/40 px-2 py-1.5 text-left font-medium">
                  제공 매체
                </th>
                <td className="border border-border px-2 py-1.5">{mediaLabel}</td>
              </tr>
              <tr>
                <th className="border border-border bg-muted/40 px-2 py-1.5 text-left font-medium">
                  제공 지역
                </th>
                <td className="border border-border px-2 py-1.5">
                  {sggNm ? `${sggNm} 지역 일대` : '지역 일대'}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="space-y-1">
            <p>상기 내용에 동의함을 확인합니다.</p>
            <p className="text-destructive">하단 ‘서약자’란 성명 기입 필요.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <span className="text-[12px] text-muted-foreground">{today || '-'}</span>
            <label className="flex items-center gap-1.5 text-[12px]">
              <span>서약자:</span>
              <input
                type="text"
                value={pledgeName}
                onChange={(e) => setPledgeName(e.target.value)}
                className="h-8 w-36 rounded border border-amber-500/70 bg-amber-50 px-2 text-[12px] text-foreground outline-none ring-amber-400/40 focus:ring-2 dark:bg-amber-950/40"
                title="서약자"
                autoComplete="off"
                disabled={submitting}
              />
            </label>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-3 sm:justify-end">
          <button
            type="button"
            title="동의"
            disabled={!canAgree}
            onClick={() => void handleAgree()}
            className="inline-flex h-8 cursor-pointer items-center rounded border border-primary bg-primary px-3 text-[12px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '처리 중…' : '동의'}
          </button>
          <button
            type="button"
            title="취소"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 cursor-pointer items-center rounded border border-border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            취소
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 데이터요청 페이지 URL (from 포함) */
export function dataRequestPageHref(fromPath?: string): string {
  return buildDataRequestHref(
    fromPath ??
      (typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '')
  )
}

/** fetch helper — basePath 반영 */
export async function postDataRequestJson(
  apiPath: string,
  body: Record<string, unknown>
): Promise<SecurityPledgeSubmitResult & Record<string, unknown>> {
  const res = await fetch(withBasePath(apiPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  const data = (await res.json().catch(() => ({}))) as SecurityPledgeSubmitResult & {
    error?: string
  }
  if (!res.ok || !data.success) {
    return {
      success: false,
      error: typeof data.error === 'string' ? data.error : '요청 실패',
      code: (data as { code?: string }).code,
    }
  }
  return data
}
