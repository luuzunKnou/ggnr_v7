'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fetchLandInfoConfig, fetchVworldOfficialLandPriceHistory } from '@/lib/vworldParcelLandClient'
import { DetailAttrRow, DetailAttrTable, LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  INDIVIDUAL_LAND_PRICE_SERVICE,
  formatRate,
  formatStandardYn,
  formatWon,
  formatYmd,
  parcelAddress,
  rateClassName,
  type LandPriceHistoryRow,
  type LandPriceParcelDetail,
} from './individualLandPriceConfig'
import { IndividualLandPriceMemoSection } from './IndividualLandPriceMemoSection'
import { useIndividualLandPriceHighlight } from './useIndividualLandPriceLayer'

const NOOP = () => undefined
const CHART_HEIGHT = 96

type Props = {
  pnu: string
  onClose: () => void
}

function withChangeRates(rowsDesc: Omit<LandPriceHistoryRow, 'changeRate'>[]): LandPriceHistoryRow[] {
  return rowsDesc.map((r, i) => {
    const prev = rowsDesc[i + 1]?.price ?? null
    return {
      ...r,
      changeRate: r.price != null && prev ? Math.round(((r.price - prev) / prev) * 10000) / 100 : null,
    }
  })
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

/** 막대 칸·막대 두께 — 연도 2자리가 겹치지 않을 만큼만 두고 간격은 최소 */
const CHART_COL_WIDTH_PX = 16
const CHART_BAR_WIDTH_PX = 8

/** 연도별 공시지가 막대 — 오래된 연도가 왼쪽. 연도가 많으면 가로 스크롤 */
function HistoryChart({ rows }: { rows: { year: string; price: number | null }[] }) {
  const max = Math.max(0, ...rows.map((r) => r.price ?? 0))
  if (max <= 0) return null
  return (
    <div className="overflow-x-auto scrollbar-thin rounded border border-border">
      <div
        className="flex items-end gap-0 px-2 pb-1 pt-3"
        style={{ minWidth: Math.max(rows.length * CHART_COL_WIDTH_PX, 100) }}
      >
        {rows.map((r) => {
          const h = r.price ? Math.max(2, Math.round((r.price / max) * CHART_HEIGHT)) : 0
          return (
            <div
              key={r.year}
              className="flex shrink-0 flex-col items-center gap-1"
              style={{ width: CHART_COL_WIDTH_PX }}
            >
              <div className="flex w-full items-end justify-center" style={{ height: CHART_HEIGHT }}>
                <div
                  className="rounded-t bg-amber-500/80"
                  style={{ height: h, width: CHART_BAR_WIDTH_PX }}
                  title={`${r.year}년 ${formatWon(r.price)}원/㎡`}
                />
              </div>
              <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                {r.year.slice(2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function IndividualLandPriceDetailPanel({ pnu, onClose }: Props) {
  const [loaded, setLoaded] = useState<{ pnu: string; detail: LandPriceParcelDetail | null; error: string | null } | null>(
    null
  )
  /** 행망이 없을 때 우클릭과 같은 브이월드 연도별 이력 */
  const [vworldByPnu, setVworldByPnu] = useState<{ pnu: string; rows: LandPriceHistoryRow[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    call('', 'POST', { service: INDIVIDUAL_LAND_PRICE_SERVICE, action: 'parcel', params: { pnu } })
      .then((res) => {
        if (cancelled) return
        if (!res?.success) {
          setLoaded({ pnu, detail: null, error: String((res as { error?: string })?.error ?? '필지를 불러오지 못했습니다.') })
          return
        }
        setLoaded({ pnu, detail: (res.data ?? res) as LandPriceParcelDetail, error: null })
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ pnu, detail: null, error: e instanceof Error ? e.message : '필지를 불러오지 못했습니다.' })
      })
    return () => {
      cancelled = true
    }
  }, [pnu])

  const current = loaded?.pnu === pnu ? loaded : null
  const detail = current?.detail ?? null
  const vworldHistory = vworldByPnu?.pnu === pnu ? vworldByPnu.rows : null

  useEffect(() => {
    if (!detail || detail.historySource === 'koreps') return
    let cancelled = false
    const targetPnu = detail.pnu
    fetchLandInfoConfig()
      .then((cfg) => {
        if (cancelled || !cfg.vworldKey) return null
        return fetchVworldOfficialLandPriceHistory({ pnu: targetPnu, vworldKey: cfg.vworldKey })
      })
      .then((rows) => {
        if (cancelled || !rows?.length) return
        setVworldByPnu({
          pnu: targetPnu,
          rows: withChangeRates(
            rows.map((r) => ({
              year: r.year,
              baseMonth: r.month,
              price: r.price,
              announceDate: r.announceDate,
              note: r.note,
            }))
          ),
        })
      })
      .catch(() => {
        /* 브이월드 실패 시 서버(파일) 이력 유지 */
      })
    return () => {
      cancelled = true
    }
  }, [detail])

  useIndividualLandPriceHighlight(detail?.geometry ?? null, detail?.extent ?? null)

  const history = useMemo(
    () => vworldHistory ?? detail?.history ?? [],
    [vworldHistory, detail?.history]
  )
  const historySource = vworldHistory ? 'vworld' : (detail?.historySource ?? 'file')
  const latest = history[0] ?? null
  const prev = history[1] ?? null
  const chartRows = useMemo(() => [...history].reverse(), [history])
  const title = detail ? `${parcelAddress(detail) || pnu} 상세` : '필지 상세'

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
        <div className="standard-detail-empty-dashed m-3">{current.error ?? '필지를 찾을 수 없습니다.'}</div>
      ) : detail ? (
        <MapSideDetailScroll className="min-h-0 flex-1 px-3 py-2 text-xs">
          <SectionTitle>기본정보</SectionTitle>
          <AttrTable
            rows={[
              ['소재지', detail.location],
              ['지번', detail.lot],
              ['필지번호', <span key="pnu" className="tabular-nums">{detail.pnu}</span>],
              ['지목', detail.jimok],
              ['면적', detail.areaSqm == null ? '' : `${detail.areaSqm.toLocaleString('ko-KR')}㎡`],
              ['표준지 여부', formatStandardYn(detail.standardYn)],
            ]}
          />

          <SectionTitle>공시지가</SectionTitle>
          <AttrTable
            rows={[
              [
                latest ? `${latest.year}년 공시지가` : '공시지가',
                latest?.price == null ? '' : `${formatWon(latest.price)}원/㎡`,
              ],
              [
                prev ? `전년(${prev.year}년) 공시지가` : '전년 공시지가',
                prev?.price == null ? '' : `${formatWon(prev.price)}원/㎡`,
              ],
              [
                '변동률',
                <span key="rate" className={rateClassName(latest?.changeRate)}>
                  {formatRate(latest?.changeRate)}
                </span>,
              ],
              ['공시일자', latest ? formatYmd(latest.announceDate) : ''],
              ['비고', latest?.note ?? ''],
            ]}
          />

          <SectionTitle>
            연도별 이력
            <span className="ml-1 font-normal text-muted-foreground">({history.length}개 연도)</span>
          </SectionTitle>
          {historySource === 'file' ? (
            <div className="mb-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              행망·브이월드 이력을 쓰지 못해 연계 파일 자료로 표시합니다.
              {detail.historyMessage ? ` (${detail.historyMessage})` : ''}
            </div>
          ) : null}
          {history.length === 0 ? (
            <div className="standard-detail-empty-dashed-compact">이 필지의 공시지가 이력이 없습니다.</div>
          ) : (
            <>
              <HistoryChart rows={chartRows} />
              <div className="mt-2 max-h-52 overflow-y-auto overscroll-contain scrollbar-thin rounded border border-border">
                <table className="standard-list-table">
                  <thead className="standard-table-thead">
                    <tr>
                      <th className="standard-table-th standard-table-th-center w-[16%]">연도</th>
                      <th className="standard-table-th standard-table-th-center w-[30%]">공시지가(원/㎡)</th>
                      <th className="standard-table-th standard-table-th-center w-[20%]">변동률</th>
                      <th className="standard-table-th standard-table-th-center w-[34%]">공시일자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.year} className="standard-list-row cursor-default" title={h.note || undefined}>
                        <td className="standard-table-td-date text-center">{h.year}</td>
                        <td className="standard-table-td-date text-right">{formatWon(h.price)}</td>
                        <td className={cn('standard-table-td-date text-right', rateClassName(h.changeRate))}>
                          {formatRate(h.changeRate)}
                        </td>
                        <td className="standard-table-td-date text-center">{formatYmd(h.announceDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <SectionTitle>메모</SectionTitle>
          <IndividualLandPriceMemoSection pnu={detail.pnu} />
        </MapSideDetailScroll>
      ) : null}
    </div>
  )
}
