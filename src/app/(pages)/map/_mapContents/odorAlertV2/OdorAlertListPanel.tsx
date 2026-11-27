'use client'

import { useMemo, useState } from 'react'
import { History, X } from 'lucide-react'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  ODOR_ALERT_SER_ENG,
  odorAlertBtnGhost,
  odorAlertBtnPrimary,
  type OdorAlertAgencyFilter,
  type OdorAlertGradeFilter,
  type OdorAlertKindFilter,
  type OdorAlertViewTab,
} from './odorAlertConfig'
import { formatOdorAlertTime, type OdorAlertRow } from './odorAlertMock'
import { acknowledgeOdorAlerts, useOdorAlertStore } from './odorAlertStore'
import { OdorAlertAckDialog } from './OdorAlertAckDialog'

type Props = {
  onClose: () => void
  onOpenHistory: () => void
  historyOpen: boolean
  /** true면 업체(agency) 필터 UI 표시 — odor-index 전용 */
  showAgencyFilter?: boolean
}

function gradeBadgeClass(grade: number | null): string {
  if (grade == null) return 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
  if (grade === 3) return 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
  return 'bg-red-500/15 text-red-700 dark:text-red-300'
}

function filterAlerts(
  alerts: OdorAlertRow[],
  tab: OdorAlertViewTab,
  gradeFilter: OdorAlertGradeFilter,
  kindFilter: OdorAlertKindFilter,
  agencyFilter: OdorAlertAgencyFilter
): OdorAlertRow[] {
  return alerts
    .filter((a) => {
      if (tab === 'unacked' && a.acked) return false
      if (tab === 'unrecovered' && a.recovered) return false
      if (kindFilter === 'odor' && a.kind !== 'odor') return false
      if (kindFilter === 'fault' && a.kind !== 'fault') return false
      if (gradeFilter === 'caution') {
        if (a.kind !== 'odor' || a.grade !== 3) return false
      }
      if (gradeFilter === 'serious') {
        if (a.kind !== 'odor' || a.grade == null || a.grade < 4) return false
      }
      if (agencyFilter !== 'all' && a.agency !== agencyFilter) return false
      return true
    })
    .sort((a, b) => {
      if (a.acked !== b.acked) return a.acked ? 1 : -1
      return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    })
}

export function OdorAlertListPanel({
  onClose,
  onOpenHistory,
  historyOpen,
  showAgencyFilter = false,
}: Props) {
  const { alerts } = useOdorAlertStore()
  const canWrite = useSerWriteAccess(ODOR_ALERT_SER_ENG)
  const [tab, setTab] = useState<OdorAlertViewTab>('all')
  const [gradeFilter, setGradeFilter] = useState<OdorAlertGradeFilter>('all')
  const [kindFilter, setKindFilter] = useState<OdorAlertKindFilter>('all')
  const [agencyFilter, setAgencyFilter] = useState<OdorAlertAgencyFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ackTarget, setAckTarget] = useState<{ mode: 'single' | 'bulk'; ids: string[] } | null>(
    null
  )

  const agencyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of alerts) {
      if (a.agency) set.add(a.agency)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [alerts])

  const rows = useMemo(
    () => filterAlerts(alerts, tab, gradeFilter, kindFilter, agencyFilter),
    [alerts, tab, gradeFilter, kindFilter, agencyFilter]
  )

  const unackedVisible = rows.filter((r) => !r.acked)

  const toggleSelect = (id: string, acked: boolean) => {
    if (acked) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllUnacked = () => {
    setSelected(new Set(unackedVisible.map((r) => r.id)))
  }

  const clearSelect = () => setSelected(new Set())

  const openBulkAck = () => {
    const ids = [...selected].filter((id) => unackedVisible.some((r) => r.id === id))
    if (ids.length === 0) return
    setAckTarget({ mode: 'bulk', ids })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">경보 보기</h2>
          <p className="text-[10px] text-muted-foreground">언제·어디서 경보가 났는지 목록</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={odorAlertBtnGhost}
            title="확인(해제) 이력"
            onClick={onOpenHistory}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            {historyOpen ? '이력 닫기' : '이력'}
          </button>
          <button type="button" className={odorAlertBtnGhost} title="닫기" onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden />
            닫기
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border px-2 py-1.5">
        {(
          [
            ['all', '전체'],
            ['unacked', '미확인'],
            ['unrecovered', '미정상'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            title={label}
            className={`cursor-pointer rounded px-2 py-1 text-[11px] font-medium ${
              tab === key
                ? 'bg-primary text-white'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">등급</span>
        {(
          [
            ['all', '전체'],
            ['caution', '주의(3)'],
            ['serious', '심각(4·5)'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            title={label}
            className={`cursor-pointer rounded px-1.5 py-0.5 ${
              gradeFilter === key
                ? 'bg-amber-500/20 font-semibold text-amber-800 dark:text-amber-300'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
            onClick={() => setGradeFilter(key)}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 text-border">|</span>
        <span className="text-muted-foreground">유형</span>
        {(
          [
            ['all', '전체'],
            ['odor', '악취'],
            ['fault', '장애'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            title={label}
            className={`cursor-pointer rounded px-1.5 py-0.5 ${
              kindFilter === key
                ? 'bg-sky-500/20 font-semibold text-sky-800 dark:text-sky-300'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
            onClick={() => setKindFilter(key)}
          >
            {label}
          </button>
        ))}
        {showAgencyFilter ? (
          <>
            <span className="mx-1 text-border">|</span>
            <span className="text-muted-foreground">업체</span>
            <button
              type="button"
              title="전체"
              className={`cursor-pointer rounded px-1.5 py-0.5 ${
                agencyFilter === 'all'
                  ? 'bg-violet-500/20 font-semibold text-violet-800 dark:text-violet-300'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
              onClick={() => setAgencyFilter('all')}
            >
              전체
            </button>
            {agencyOptions.map((agency) => (
              <button
                key={agency}
                type="button"
                title={agency}
                className={`cursor-pointer rounded px-1.5 py-0.5 ${
                  agencyFilter === agency
                    ? 'bg-violet-500/20 font-semibold text-violet-800 dark:text-violet-300'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
                onClick={() => setAgencyFilter(agency)}
              >
                {agency}
              </button>
            ))}
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          type="button"
          className={odorAlertBtnGhost}
          title="표시 중 미확인 전체 선택"
          onClick={selectAllUnacked}
          disabled={unackedVisible.length === 0}
        >
          미확인 전체선택
        </button>
        <button
          type="button"
          className={odorAlertBtnGhost}
          title="선택 해제"
          onClick={clearSelect}
          disabled={selected.size === 0}
        >
          선택해제
        </button>
        {canWrite ? (
          <button
            type="button"
            className={odorAlertBtnPrimary}
            title="일괄 확인(해제)"
            onClick={openBulkAck}
            disabled={[...selected].every((id) => !unackedVisible.some((r) => r.id === id))}
          >
            일괄 확인(해제)
          </button>
        ) : (
          <span className="text-[10px] text-muted-foreground">조회 전용 — 해제 불가</span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {rows.length}건 · 선택 {selected.size}
        </span>
      </div>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <li className="py-10 text-center text-xs text-muted-foreground">조건에 맞는 경보가 없습니다.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.id}
              className={`rounded-md border px-2.5 py-2 ${
                row.acked ? 'border-border/50 bg-muted/10 opacity-80' : 'border-border/70 bg-muted/25'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 cursor-pointer"
                  title="선택"
                  disabled={row.acked || !canWrite}
                  checked={selected.has(row.id)}
                  onChange={() => toggleSelect(row.id, row.acked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-foreground">{row.sensorLabel}</span>
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">
                      {ODOR_ALERT_KIND_LABEL[row.kind]}
                    </span>
                    {row.grade != null && (
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] font-semibold ${gradeBadgeClass(row.grade)}`}
                      >
                        {ODOR_ALERT_GRADE_LABEL[row.grade]}
                      </span>
                    )}
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                        row.acked
                          ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {row.acked ? '확인' : '미확인'}
                    </span>
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] ${
                        row.recovered
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                      }`}
                    >
                      {row.recovered ? '정상' : '미정상'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {row.emdNm} · {row.agency} · {formatOdorAlertTime(row.occurredAt)}
                  </div>
                  {row.kind === 'odor' && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      저감:{' '}
                      {row.scrubberAutoOn == null
                        ? '정보 없음'
                        : row.scrubberAutoOn
                          ? '가동중'
                          : '가동 필요'}
                    </div>
                  )}
                  {row.kind === 'fault' && row.lastRecvAt && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      통신 두절(30분 미수신) · 최종수신 {formatOdorAlertTime(row.lastRecvAt)}
                    </div>
                  )}
                </div>
                {canWrite && !row.acked && (
                  <button
                    type="button"
                    className={odorAlertBtnPrimary}
                    title="확인(해제)"
                    onClick={() => setAckTarget({ mode: 'single', ids: [row.id] })}
                  >
                    확인
                  </button>
                )}
              </div>
            </li>
          ))
        )}
      </ul>

      <OdorAlertAckDialog
        open={ackTarget != null}
        title={ackTarget?.mode === 'bulk' ? '일괄 확인(해제)' : '단건 확인(해제)'}
        description={
          ackTarget?.mode === 'bulk'
            ? `선택한 미확인 경보 ${ackTarget.ids.length}건을 사유와 함께 해제합니다.`
            : '이 경보를 사유와 함께 확인(해제)합니다.'
        }
        onClose={() => setAckTarget(null)}
        onConfirm={(reason) => {
          if (!ackTarget) return
          acknowledgeOdorAlerts({
            alertIds: ackTarget.ids,
            reason,
            mode: ackTarget.mode,
          })
          setSelected((prev) => {
            const next = new Set(prev)
            for (const id of ackTarget.ids) next.delete(id)
            return next
          })
          setAckTarget(null)
        }}
      />
    </div>
  )
}
