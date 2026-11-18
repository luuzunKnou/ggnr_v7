'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { call } from '@/lib/api'
import { DetailAttrRow, DetailAttrTable, LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  REAL_TRANSACTION_PRICE_SERVICE,
  dealYmdLabel,
  formatArea,
  formatManWon,
  formatWon,
  type LandTradeRow,
} from './realTransactionPriceConfig'

const NOOP = () => undefined

type Props = {
  umdNm: string
  dealYmd: string
  onClose: () => void
}

type DetailPayload = {
  umdNm: string
  emdCd: string | null
  count: number
  medianPerSqm: number | null
  avgPerSqm: number | null
  avgAmountMan: number | null
  totalAmountMan: number
  rows: LandTradeRow[]
}

function AttrTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <DetailAttrTable>
      {rows.map(([label, value], idx) => (
        <DetailAttrRow key={label} label={label} isLast={idx === rows.length - 1}>
          {value === '' || value == null ? '—' : value}
        </DetailAttrRow>
      ))}
    </DetailAttrTable>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="standard-detail-section-title-wrap">{children}</div>
}

/** truncate 없는 셀 — 지목·면적 말줄임 방지 */
const tdPlain =
  'max-w-none whitespace-nowrap px-2 py-1.5 align-middle tabular-nums text-foreground/90'

export function RealTransactionPriceDetailPanel({ umdNm, dealYmd, onClose }: Props) {
  const [loaded, setLoaded] = useState<{
    key: string
    detail: DetailPayload | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = `${dealYmd}:${umdNm}`
    call('', 'POST', {
      service: REAL_TRANSACTION_PRICE_SERVICE,
      action: 'dongTrades',
      params: { dealYmd, umdNm },
    })
      .then((res) => {
        if (cancelled) return
        if (!res?.success) {
          setLoaded({
            key,
            detail: null,
            error: String((res as { error?: string })?.error ?? '거래 목록을 불러오지 못했습니다.'),
          })
          return
        }
        setLoaded({ key, detail: (res.data ?? res) as DetailPayload, error: null })
      })
      .catch((e) => {
        if (!cancelled) {
          setLoaded({
            key,
            detail: null,
            error: e instanceof Error ? e.message : '거래 목록을 불러오지 못했습니다.',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [dealYmd, umdNm])

  const currentKey = `${dealYmd}:${umdNm}`
  const current = loaded?.key === currentKey ? loaded : null
  const detail = current?.detail ?? null
  const title = `${umdNm} 상세`
  const period = dealYmdLabel(dealYmd)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={title}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />

      {current && !detail ? (
        <div className="standard-detail-empty-dashed m-3">
          {current.error ?? '자료를 찾을 수 없습니다.'}
        </div>
      ) : detail ? (
        <MapSideDetailScroll className="min-h-0 flex-1 px-3 py-2 text-xs">
          <SectionTitle>기본정보</SectionTitle>
          <AttrTable
            rows={[
              ['읍면동', detail.umdNm],
              ['계약월', period],
              ['거래 건수', `${detail.count.toLocaleString('ko-KR')}건`],
              [
                '평균 실거래가(원/m²)',
                detail.avgPerSqm == null ? '' : `${formatWon(detail.avgPerSqm)}원/m²`,
              ],
              [
                '평균 거래금액',
                detail.avgAmountMan == null ? '' : formatManWon(detail.avgAmountMan),
              ],
            ]}
          />

          <SectionTitle>
            거래 목록
            <span className="ml-1 font-normal text-muted-foreground">({detail.rows.length}건)</span>
          </SectionTitle>
          {detail.rows.length === 0 ? (
            <div className="standard-detail-empty-dashed-compact">거래가 없습니다.</div>
          ) : (
            <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain scrollbar-thin rounded border border-border">
              <table className="standard-list-table table-fixed w-full">
                <thead className="standard-table-thead">
                  <tr>
                    <th className="standard-table-th standard-table-th-center w-[14%]">지번</th>
                    <th className="standard-table-th standard-table-th-center w-[14%]">계약일</th>
                    <th className="standard-table-th standard-table-th-center w-[14%]">지목</th>
                    <th className="standard-table-th standard-table-th-center w-[18%]">면적</th>
                    <th className="standard-table-th standard-table-th-center w-[22%]">거래금액</th>
                    <th className="standard-table-th standard-table-th-center w-[18%]">단가</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((t, i) => (
                    <tr
                      key={`${t.dealDate}-${t.jibun}-${t.dealAmountMan}-${i}`}
                      className="standard-list-row cursor-default"
                      title={[t.landUse, t.dealingGbn, t.shareDealingType].filter(Boolean).join(' · ')}
                    >
                      <td className={`${tdPlain} text-center`}>{t.jibun || '—'}</td>
                      <td className={`${tdPlain} text-center`}>{t.dealDate.slice(5)}</td>
                      <td className={`${tdPlain} text-center`}>{t.jimok}</td>
                      <td className={`${tdPlain} text-right`}>{formatArea(t.dealArea)}</td>
                      <td className={`${tdPlain} text-right font-medium`}>
                        {formatManWon(t.dealAmountMan)}
                      </td>
                      <td className={`${tdPlain} text-right`}>{formatWon(t.perSqm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MapSideDetailScroll>
      ) : (
        <div className="standard-detail-empty-dashed m-3">불러오는 중…</div>
      )}
    </div>
  )
}
