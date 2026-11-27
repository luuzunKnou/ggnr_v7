'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { OdorScadaPaletteSwitch } from '@/app/(pages)/(index)/odorPhV2/OdorScadaPaletteSwitch'
import { formatAlertTime } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import {
  odorLiveSeverityFromGrade,
  odorLiveSeverityLabel,
  odorLiveSeverityTagStyle,
  ODOR_LIVE_GRADE_HEX,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { cn } from '@/lib/utils'
import {
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGradeFilter,
  type OdorAlertKind,
  type OdorAlertKindFilter,
  type OdorAlertViewTab,
} from './odorAlertConfig'

/** 경보 보기 작업 행 (P21 · 대시보드 목업 확장) */
export type OdorAlertWorkRow = {
  id: string
  sensorNm: string
  sensorKorNm: string
  agency: string
  grade: 3 | 4 | 5
  occurredAt: string
  ppm: number
  abatementRunning: boolean
  emdNm: string
  kind: OdorAlertKind
  /** 확인(해제) 여부 */
  acked: boolean
  /** 정상 복귀 여부 — false면 미정상 */
  recovered: boolean
  ackReason?: string
  ackedAt?: string
}

type Props = {
  rows: OdorAlertWorkRow[]
  selectedId: string | null
  onSelectId: (id: string | null) => void
  onAck: (ids: string[], reason: string) => void
  onClose: () => void
  onOpenControlMap?: () => void
}

function GradeBadge({ grade }: { grade: number }) {
  return (
    <span
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
      style={{ backgroundColor: ODOR_LIVE_GRADE_HEX[grade as 1 | 2 | 3 | 4 | 5] ?? '#64748b' }}
    >
      {grade}
    </span>
  )
}

const tagBase =
  'inline-flex h-[18px] min-w-[36px] shrink-0 items-center justify-center rounded-full px-2 text-center text-[12px] font-semibold leading-none'

function AckDialog({
  title,
  count,
  onConfirm,
  onCancel,
}: {
  title: string
  count: number
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-label={title}
        className="standard-map-float-surface !opacity-100 w-full max-w-sm p-3"
      >
        <div className="mb-2 text-[13px] font-semibold text-foreground">{title}</div>
        <p className="mb-2 text-[12px] text-muted-foreground">
          {count}건 · 확인(해제) 사유를 입력하세요 (P21-04·08)
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="사유"
          className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
        />
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            title="취소"
            onClick={onCancel}
            className="h-7 cursor-pointer rounded border border-border px-2.5 text-[12px] text-muted-foreground hover:bg-muted"
          >
            취소
          </button>
          <button
            type="button"
            title="확인 처리"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="h-7 cursor-pointer rounded border border-primary bg-primary px-2.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            확인 처리
          </button>
        </div>
      </div>
    </div>
  )
}

/** P21 경보목록 — 관제 지도형 사이드 패널 */
export function OdorAlertWorkPanel({
  rows,
  selectedId,
  onSelectId,
  onAck,
  onClose,
  onOpenControlMap,
}: Props) {
  const [tab, setTab] = useState<OdorAlertViewTab>('unacked')
  const [gradeFilter, setGradeFilter] = useState<OdorAlertGradeFilter>('all')
  const [kindFilter, setKindFilter] = useState<OdorAlertKindFilter>('all')
  const [query, setQuery] = useState('')
  const [ackMode, setAckMode] = useState<'single' | 'bulk' | null>(null)

  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])

  const stats = useMemo(() => {
    const unacked = rows.filter((r) => !r.acked).length
    const today = rows.filter((r) => new Date(r.occurredAt).getTime() >= todayStart).length
    const abatement = rows.filter((r) => r.abatementRunning && !r.acked).length
    const recovered = rows.filter((r) => r.recovered).length
    return { unacked, today, abatement, recovered }
  }, [rows, todayStart])

  const filtered = useMemo(() => {
    const q = query.trim()
    let list = [...rows]
    if (tab === 'unacked') list = list.filter((r) => !r.acked)
    if (tab === 'unrecovered') list = list.filter((r) => !r.recovered)
    if (gradeFilter === 'caution') list = list.filter((r) => r.grade === 3)
    if (gradeFilter === 'serious') list = list.filter((r) => r.grade >= 4)
    if (kindFilter === 'odor') list = list.filter((r) => r.kind === 'odor')
    if (kindFilter === 'fault') list = list.filter((r) => r.kind === 'fault')
    if (q) {
      list = list.filter(
        (r) =>
          r.sensorNm.includes(q) ||
          r.sensorKorNm.includes(q) ||
          r.emdNm.includes(q) ||
          r.agency.includes(q)
      )
    }
    return list.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    )
  }, [rows, tab, gradeFilter, kindFilter, query])

  const selected = rows.find((r) => r.id === selectedId) ?? null
  const bulkTargets = filtered.filter((r) => !r.acked)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="text-sm font-semibold text-foreground">경보 보기</span>
        <div className="flex items-center gap-1.5">
          <OdorScadaPaletteSwitch />
          <button
            type="button"
            title="닫기"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* P21 상단 요약 카드 */}
      <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-border px-3 py-2">
        {(
          [
            { l: '미확인', v: stats.unacked },
            { l: '금일 발생', v: stats.today },
            { l: '저감 가동', v: stats.abatement },
            { l: '정상 복귀', v: stats.recovered },
          ] as const
        ).map((c) => (
          <div
            key={c.l}
            className="rounded-md border border-border bg-card px-2 py-1.5"
          >
            <div className="text-[12px] text-muted-foreground">{c.l}</div>
            <div className="text-base font-extrabold tabular-nums text-foreground">{c.v}</div>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        {/* P21-02 */}
        <div className="inline-flex overflow-hidden rounded border border-border text-[12px]">
          {(
            [
              { id: 'unacked' as const, label: '미확인' },
              { id: 'unrecovered' as const, label: '미정상' },
              { id: 'all' as const, label: '전체' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => setTab(t.id)}
              className={cn(
                'cursor-pointer px-2.5 py-1',
                tab === t.id
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-background text-muted-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* P21-03 · P21-09 */}
        <div className="flex flex-wrap gap-1">
          {(
            [
              { id: 'all' as const, label: '등급전체' },
              { id: 'caution' as const, label: '주의(3)' },
              { id: 'serious' as const, label: '심각(4·5)' },
            ] as const
          ).map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.label}
              onClick={() => setGradeFilter(g.id)}
              className={cn(
                'h-6 cursor-pointer rounded border px-1.5 text-[12px]',
                gradeFilter === g.id
                  ? 'border-sky-500/50 bg-sky-500/20 text-sky-200'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              )}
            >
              {g.label}
            </button>
          ))}
          {(
            [
              { id: 'all' as const, label: '유형전체' },
              { id: 'odor' as const, label: '악취' },
              { id: 'fault' as const, label: '장애' },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              title={k.label}
              onClick={() => setKindFilter(k.id)}
              className={cn(
                'h-6 cursor-pointer rounded border px-1.5 text-[12px]',
                kindFilter === k.id
                  ? 'border-sky-500/50 bg-sky-500/20 text-sky-200'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="지점명·번호 검색"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[12px] text-foreground"
          />
          <button
            type="button"
            title="표시 경보 확인처리"
            disabled={bulkTargets.length === 0}
            onClick={() => setAckMode('bulk')}
            className="h-7 shrink-0 cursor-pointer rounded border border-border bg-muted/40 px-2 text-[12px] font-semibold disabled:opacity-40"
          >
            일괄 확인
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="px-1 py-3 text-xs text-muted-foreground">해당 경보 없음</div>
        ) : (
          filtered.map((a) => {
            const severity = odorLiveSeverityFromGrade(a.grade)
            const sev = odorLiveSeverityLabel(a.grade)
            return (
              <button
                key={a.id}
                type="button"
                title={a.sensorKorNm}
                onClick={() => onSelectId(a.id === selectedId ? null : a.id)}
                className={cn(
                  'mb-0.5 flex w-full cursor-pointer items-start gap-2 rounded-md border-b border-border/50 px-1 py-2 text-left hover:bg-muted/40',
                  selectedId === a.id && 'bg-sky-500/15 outline outline-1 outline-sky-500/50'
                )}
              >
                <GradeBadge grade={a.grade} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-foreground">
                    {a.sensorNm} · {a.sensorKorNm}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {formatAlertTime(a.occurredAt).slice(5)} · {a.ppm.toFixed(1)}ppm · {a.emdNm}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <span className="text-[12px] text-muted-foreground">
                      {ODOR_ALERT_KIND_LABEL[a.kind]}
                    </span>
                    {a.abatementRunning ? (
                      <span className="text-[12px] font-medium text-emerald-400">제거설비 가동</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={tagBase} style={odorLiveSeverityTagStyle(severity)}>
                    {sev}
                  </span>
                  <span
                    className={tagBase}
                    style={odorLiveSeverityTagStyle(a.acked ? 'ok' : 'bad')}
                  >
                    {a.acked ? '확인' : '미확인'}
                  </span>
                  <span
                    className={tagBase}
                    style={odorLiveSeverityTagStyle(a.recovered ? 'ok' : 'warn')}
                  >
                    {a.recovered ? '정상' : '미정상'}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>

      {selected ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-2">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {selected.sensorNm} · {selected.sensorKorNm}
          </div>
          <div className="flex gap-1.5">
            {!selected.acked ? (
              <button
                type="button"
                title="확인(해제)"
                onClick={() => setAckMode('single')}
                className="h-7 flex-1 cursor-pointer rounded-md border border-border bg-muted/40 text-[12px] font-semibold hover:bg-muted"
              >
                확인(해제)
              </button>
            ) : (
              <div className="flex h-7 flex-1 items-center justify-center rounded-md border border-border text-[12px] text-muted-foreground">
                확인 완료
                {selected.ackReason ? ` · ${selected.ackReason}` : ''}
              </div>
            )}
            {onOpenControlMap ? (
              <button
                type="button"
                title="관제 지도"
                onClick={onOpenControlMap}
                className="h-7 flex-1 cursor-pointer rounded-md border border-border bg-muted/40 text-[12px] font-semibold hover:bg-muted"
              >
                관제 지도
              </button>
            ) : null}
          </div>
        </div>
      ) : onOpenControlMap ? (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            title="관제 지도"
            onClick={onOpenControlMap}
            className="flex h-8 w-full cursor-pointer items-center justify-center rounded-md border border-border bg-muted/40 text-[12px] font-semibold hover:bg-muted"
          >
            관제 지도
          </button>
        </div>
      ) : null}

      {ackMode === 'single' && selected && !selected.acked ? (
        <AckDialog
          title="단건 확인 처리"
          count={1}
          onCancel={() => setAckMode(null)}
          onConfirm={(reason) => {
            onAck([selected.id], reason)
            setAckMode(null)
          }}
        />
      ) : null}
      {ackMode === 'bulk' ? (
        <AckDialog
          title="표시 경보 일괄 확인"
          count={bulkTargets.length}
          onCancel={() => setAckMode(null)}
          onConfirm={(reason) => {
            onAck(
              bulkTargets.map((r) => r.id),
              reason
            )
            setAckMode(null)
          }}
        />
      ) : null}
    </div>
  )
}
