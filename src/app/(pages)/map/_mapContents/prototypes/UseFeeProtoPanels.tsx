'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  LayerRowEditHeader,
  type LayerRowDetailAttr,
} from '../../_mapComponents/layerRowEdit'
import { PROTO_FEES, PROTO_LEDGERS, type ProtoFeeRow, type ProtoLedgerRow } from './dummyData'

type ListProps = {
  onClose: () => void
  selectedId: string | null
  onSelectId: (id: string) => void
}

export function UseFeeProtoListPanel({ onClose, selectedId, onSelectId }: ListProps) {
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return PROTO_FEES
    return PROTO_FEES.filter((r) =>
      [r.chargeNo, r.payer, r.status, r.year, r.usageName, r.usagePlace, r.deptName]
        .join(' ')
        .toLowerCase()
        .includes(k)
    )
  }, [keyword])

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">점사용료</span>
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

      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (부과번호, 납부자, 상태, 연도)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  상태
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  부과번호
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  연도
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  납부자
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  금액
                </th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                  납기일
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selectedId === row.id
                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectId(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectId(row.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80',
                      isSelected && 'bg-primary/10'
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          row.status === '미납'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-emerald-50 text-emerald-700'
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-800">{row.chargeNo}</td>
                    <td className="px-2 py-1.5 text-slate-700">{row.year}</td>
                    <td className="px-2 py-1.5 text-slate-700">{row.payer}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                      {row.amount}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                      {row.dueDate}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          {rows.length.toLocaleString()}건 · 조회 전용 · 더미데이터
        </div>
      </div>
    </div>
  )
}

const FEE_DETAIL_INITIAL_COUNT = 20

/** 점사용료 상세 — 표시값 (더미 기본값 포함) */
function resolveFeeDetailValues(fee: ProtoFeeRow, ledger?: ProtoLedgerRow | null) {
  const dash = '—'
  return {
    manageCode6: fee.manageCode6 || dash,
    status: fee.status,
    deptName: fee.deptName,
    year: fee.year,
    acctType: fee.acctType,
    subjectName: fee.subjectName,
    usePeriod: `${fee.useStartDate} ~ ${fee.useEndDate}`,
    area: fee.area ? `${fee.area} ㎡` : dash,
    officialLandPrice: fee.officialLandPrice ?? dash,
    usagePurpose: fee.usagePurpose ?? ledger?.purpose ?? dash,
    objectPlace: fee.objectPlace || dash,
    objectAddress: fee.objectAddress || dash,
    chargeType: fee.chargeType ?? dash,
    chargeDate: fee.chargeDate,
    chargeStatus: fee.chargeStatus,
    initialChargeAmount: fee.initialChargeAmount ?? fee.amount,
    paymentType: fee.paymentType ?? (fee.status === '수납' ? '완납' : '미납'),
    seizureType: fee.seizureType ?? dash,
    reductionType: fee.reductionType ?? dash,
    lossType: fee.lossType ?? dash,
    payerType: fee.payerType,
    payerNo: fee.payerNo,
    payerStatus: fee.payerStatus ?? dash,
    payer: fee.payer,
    address: fee.address,
    payerEmail: fee.payerEmail ?? dash,
    phone: fee.phone || dash,
    mobile: fee.mobile || dash,
    ePaymentNo: fee.ePaymentNo,
    installmentType: fee.installmentType ?? (fee.installment === '1' ? '일시납' : fee.installment),
    installmentInterest: fee.installmentInterest ?? dash,
    arrearsReasonCode: fee.arrearsReasonCode ?? dash,
    arrearsReason: fee.arrearsReason ?? dash,
    firstDueDate: fee.firstDueDate,
    dueDateFull: fee.dueDateFull,
    postDueAmount: fee.postDueAmount ?? dash,
    postDueDate: fee.postDueDate ?? dash,
    surcharge: fee.surcharge ?? dash,
    finalBaseFee: fee.baseFee,
    vbankRows: [
      { bank: fee.vbankBank1 ?? dash, account: fee.vbankNo1 ?? dash },
      { bank: fee.vbankBank2 ?? dash, account: fee.vbankNo2 ?? dash },
      { bank: fee.vbankBank3 ?? dash, account: fee.vbankNo3 ?? dash },
    ],
  }
}

function feeDetailAttributes(fee: ProtoFeeRow, ledger?: ProtoLedgerRow | null): LayerRowDetailAttr[] {
  const v = resolveFeeDetailValues(fee, ledger)
  const main: LayerRowDetailAttr[] = [
    { field: 'manageCode6', label: '점용대장키', value: v.manageCode6 },
    { field: 'status', label: '상태', value: v.status },
    { field: 'deptName', label: '부서', value: v.deptName },
    { field: 'chargeAmount', label: '부과금액', value: v.initialChargeAmount },
    { field: 'chargeDate', label: '부과일자', value: v.chargeDate },
    { field: 'dueDateFull', label: '납기일자', value: v.dueDateFull },
    { field: 'usePeriod', label: '점용기간', value: v.usePeriod },
    { field: 'area', label: '점용면적', value: v.area },
    { field: 'officialLandPrice', label: '공시지가', value: v.officialLandPrice },
    { field: 'usagePurpose', label: '점용목적', value: v.usagePurpose },
    { field: 'objectPlace', label: '물건지명', value: v.objectPlace },
    { field: 'objectAddress', label: '물건지주소', value: v.objectAddress },
    { field: 'payerType', label: '납부자구분', value: v.payerType },
    { field: 'payerNo', label: '납부자번호', value: v.payerNo },
    { field: 'payer', label: '납부자명', value: v.payer },
    { field: 'address', label: '납부자주소', value: v.address },
    { field: 'payerEmail', label: '납부자이메일', value: v.payerEmail },
    { field: 'phone', label: '전화번호', value: v.phone },
    { field: 'mobile', label: '휴대폰번호', value: v.mobile },
    { field: 'subjectName', label: '대표세입과목', value: v.subjectName },
    { field: 'chargeStatus', label: '부과상태', value: v.chargeStatus },
    { field: 'year', label: '회계연도', value: v.year },
    { field: 'acctType', label: '회계구분', value: v.acctType },
    { field: 'paymentType', label: '수납구분', value: v.paymentType },
    { field: 'seizureType', label: '압류구분', value: v.seizureType },
    { field: 'chargeType', label: '부과구분', value: v.chargeType },
    { field: 'reductionType', label: '감경구분', value: v.reductionType },
    { field: 'lossType', label: '결손구분', value: v.lossType },
    { field: 'installmentType', label: '분납구분', value: v.installmentType },
    { field: 'installmentInterest', label: '분납이자', value: v.installmentInterest },
    { field: 'ePaymentNo', label: '전자납부번호', value: v.ePaymentNo },
    { field: 'arrearsReason', label: '체납사유', value: v.arrearsReason },
    { field: 'firstDueDate', label: '최초납기일자', value: v.firstDueDate },
    { field: 'postDueAmount', label: '납기 후 금액', value: v.postDueAmount },
    { field: 'postDueDate', label: '납기 후 일자', value: v.postDueDate },
    { field: 'surcharge', label: '가산금', value: v.surcharge },
    { field: 'finalBaseFee', label: '최종본세', value: v.finalBaseFee },
  ]
  const vbank = v.vbankRows.flatMap((row, index) => [
    { field: `vbankBank${index + 1}`, label: `가상계좌은행${index + 1}`, value: row.bank },
    { field: `vbankNo${index + 1}`, label: `가상계좌번호${index + 1}`, value: row.account },
  ])
  return [...main, ...vbank]
}

function FeeProtoDetailAttributeSection({
  fee,
  ledger,
  expanded,
  onToggleExpanded,
}: {
  fee: ProtoFeeRow
  ledger?: ProtoLedgerRow | null
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const allAttributes = feeDetailAttributes(fee, ledger)
  const visibleAttributes = expanded
    ? allAttributes
    : allAttributes.slice(0, FEE_DETAIL_INITIAL_COUNT)
  const hiddenCount = allAttributes.length - FEE_DETAIL_INITIAL_COUNT
  const showMoreButton = allAttributes.length > FEE_DETAIL_INITIAL_COUNT

  return (
    <>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        상세 속성
      </div>
      <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50/50">
        {visibleAttributes.map((row) => (
          <div
            key={row.field}
            className="grid grid-cols-detail-30 gap-x-2 gap-y-0.5 px-2 py-1.5"
          >
            <dt className="shrink-0 font-medium text-slate-600">{row.label}</dt>
            <dd
              className={cn(
                'min-w-0 break-words text-slate-800',
                row.field.startsWith('vbankNo') && 'break-all tabular-nums'
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </div>
      {showMoreButton && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="mt-2 w-full rounded border border-slate-200 bg-white py-1.5 text-[11px] font-medium text-primary hover:bg-slate-50"
        >
          {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
        </button>
      )}
    </>
  )
}

type DetailProps = {
  detailId: string
  onClose: () => void
  selectedLedgerId?: string | null
  onSelectLedger?: (ledgerId: string) => void
}

export function UseFeeProtoDetailPanel({
  detailId,
  onClose,
  selectedLedgerId,
  onSelectLedger,
}: DetailProps) {
  const [expanded, setExpanded] = useState(false)
  const fee = PROTO_FEES.find((r) => r.id === detailId)
  const ledger = fee?.ledgerId ? PROTO_LEDGERS.find((r) => r.id === fee.ledgerId) : null

  useEffect(() => {
    setExpanded(false)
  }, [detailId])

  if (!fee) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <LayerRowEditHeader
          title="점사용료 상세"
          isEditing={false}
          saving={false}
          onEdit={() => undefined}
          onSave={() => undefined}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="px-3 py-6 text-center text-xs text-slate-500">선택한 점사용료를 찾을 수 없습니다.</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <LayerRowEditHeader
        title="점사용료 상세"
        isEditing={false}
        saving={false}
        onEdit={() => undefined}
        onSave={() => undefined}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs">
        <FeeProtoDetailAttributeSection
          fee={fee}
          ledger={ledger}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />

        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            점용대장
          </div>
          {!ledger ? (
            <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-4 text-center text-slate-500">
              연계된 점용대장이 없습니다.
            </div>
          ) : (
            <div className="overflow-auto rounded border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                      점용명
                    </th>
                    <th className="border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                      점용시작일
                    </th>
                    <th className="border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                      점용종료일
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectLedger?.(ledger.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectLedger?.(ledger.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 hover:bg-slate-50/80',
                      selectedLedgerId === ledger.id && 'bg-primary/10'
                    )}
                  >
                    <td className="px-2 py-1.5 text-slate-800">{ledger.name}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                      {ledger.startDate}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                      {ledger.endDate}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
