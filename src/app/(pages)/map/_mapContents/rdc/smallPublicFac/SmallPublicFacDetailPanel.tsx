'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import {
  formatSignedWon,
  formatWon,
  getSmallPublicFacRowById,
} from './smallPublicFacMock'

type Props = {
  detailId: string
  onClose: () => void
}

const DEFAULT_OPEN = new Set(['contract', 'payment', 'change', 'joint', 'sub'])

function Field({
  label,
  value,
  span,
}: {
  label: string
  value: string
  span?: boolean
}) {
  return (
    <div className={cn('grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 px-2.5 py-1.5', span && 'col-span-2')}>
      <dt className="shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{value.trim() || '—'}</dd>
    </div>
  )
}

function Section({
  id,
  title,
  openIds,
  onToggle,
  children,
}: {
  id: string
  title: string
  openIds: Set<string>
  onToggle: (id: string) => void
  children: ReactNode
}) {
  const isOpen = openIds.has(id)
  return (
    <section className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-slate-50"
      >
        <span className="text-[11px] font-semibold tracking-wide text-slate-700">{title}</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
          {isOpen ? '접기' : '펼치기'}
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </span>
      </button>
      {isOpen && <div className="border-t border-slate-100">{children}</div>}
    </section>
  )
}

function EmptyTableNote() {
  return <div className="px-3 py-6 text-center text-slate-500">자료가 없습니다.</div>
}

export function SmallPublicFacDetailPanel({ detailId, onClose }: Props) {
  const row = getSmallPublicFacRowById(detailId)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(DEFAULT_OPEN))

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="truncate text-sm font-semibold text-slate-800">
          {row?.contractName ?? '계약 상세'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-xs">
        {!row ? (
          <div className="px-1 py-8 text-center text-slate-500">항목을 찾을 수 없습니다.</div>
        ) : (
          <>
            <Section id="contract" title="계약정보" openIds={openIds} onToggle={toggle}>
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
                <Field label="계약구분" value={row.contract.type} />
                <div />
                <Field label="예정금액" value={formatWon(row.contract.plannedAmount)} />
                <Field label="최초계약금액" value={formatWon(row.contract.firstContractAmount)} />
                <Field label="낙찰율" value={row.contract.bidRate} />
                <Field label="계약금액" value={formatWon(row.contract.contractAmount)} />
                <Field label="계약일자" value={row.contract.contractDate} />
                <Field label="착공일" value={row.contract.startDate} />
                <Field label="경쟁방법" value={row.contract.competition} />
                <Field label="준공일" value={row.contract.endDate} />
                <Field label="도급업체" value={row.contract.contractor} />
                <Field label="대표자" value={row.contract.representative} />
                <Field label="도급업체주소" value={row.contract.contractorAddress} span />
                <Field label="계약사유" value={row.contract.reason} span />
                <Field label="사업개요" value={row.contract.summary} span />
                <Field label="계약관서" value={row.contract.contractOffice} />
                <Field label="계약부서" value={row.contract.contractDept} />
                <Field label="감독부서" value={row.contract.superviseDept} />
                <Field label="감독관" value={row.contract.supervisor} />
              </div>
            </Section>

            <Section id="payment" title="대금지급" openIds={openIds} onToggle={toggle}>
              {row.payments.length === 0 ? (
                <EmptyTableNote />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">구분</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">지급일자</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">지급금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.payments.map((p) => (
                        <tr key={p.seq} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{p.seq}</td>
                          <td className="px-2 py-1.5 text-slate-700">{p.kind}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{p.date}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                            {formatWon(p.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{p.remark || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 font-medium text-slate-800">
                    <span>합계 {formatWon(row.paymentTotal)}</span>
                    <span>잔금 {formatWon(row.balance)}</span>
                  </div>
                </div>
              )}
            </Section>

            <Section id="change" title="설계변경" openIds={openIds} onToggle={toggle}>
              {row.designChanges.length === 0 ? (
                <EmptyTableNote />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">회차</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">변경일시</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">증감액</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">변경금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">변경사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.designChanges.map((c) => (
                        <tr key={c.round} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-700">{c.round}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{c.date}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                            {formatSignedWon(c.delta)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                            {formatWon(c.changedAmount)}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{c.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section id="joint" title="공동도급" openIds={openIds} onToggle={toggle}>
              {row.jointContracts.length === 0 ? (
                <EmptyTableNote />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업체명</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">대표자</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비율</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">분담유형</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">공동계약금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.jointContracts.map((j) => (
                        <tr key={j.seq} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{j.seq}</td>
                          <td className="px-2 py-1.5 text-slate-700">{j.company}</td>
                          <td className="px-2 py-1.5 text-slate-700">{j.representative}</td>
                          <td className="px-2 py-1.5 text-slate-700">{j.ratio}</td>
                          <td className="px-2 py-1.5 text-slate-700">{j.shareType}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                            {formatWon(j.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{j.remark || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section id="sub" title="하도급" openIds={openIds} onToggle={toggle}>
              {row.subcontracts.length === 0 ? (
                <EmptyTableNote />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업종</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업체명</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">대표자</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">계약일</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">하도급액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">하도급율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.subcontracts.map((s) => (
                        <tr key={s.seq} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{s.seq}</td>
                          <td className="px-2 py-1.5 text-slate-700">{s.industry}</td>
                          <td className="px-2 py-1.5 text-slate-700">{s.company}</td>
                          <td className="px-2 py-1.5 text-slate-700">{s.representative}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-700">{s.date}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                            {formatWon(s.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{s.rate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}
      </MapSideDetailScroll>
    </div>
  )
}
