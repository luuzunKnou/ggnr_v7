import { applyThinBorders } from '../smallPublicExcelStyle'
import { todayYmd } from './smallPublicPlanCalc'
import {
  PLAN_DB_YEARS,
  planCellsOfRow,
  planRowLocation,
  planSheetMid,
  sumPlanSheetCells,
  type PlanDbRow,
  type PlanSheetCells,
} from './smallPublicPlanDb'

const million = (mil: number) => (mil ? Math.round(mil * 10) / 10 : '')
const qty = (n: number) => (n ? Math.round(n) : '')
const rate = (r: number | null) => (r == null || r === 0 ? '' : r)

function cellsRow(c: PlanSheetCells): (string | number)[] {
  const mid = planSheetMid(c.years)
  return [
    qty(c.totalQty),
    million(c.totalCost),
    qty(c.doneQty),
    million(c.doneCost),
    rate(c.doneRate),
    qty(mid.qty),
    million(mid.costMil),
    rate(c.midRate),
    ...c.years.flatMap((y) => [qty(y.qty), million(y.costMil)]),
    c.people || '',
    c.farmHa || '',
    c.buildings || '',
    qty(c.afterQty),
    million(c.afterCost),
  ]
}

/**
 * 중기 정비계획 명세서(별지 제3호 칸 순서, 머리줄 3단) + 읍면별 종합표 — 단위 m, 백만원, %.
 * 엑셀 라이브러리는 누를 때만 불러온다.
 */
export async function exportSmallPublicPlanExcel(list: PlanDbRow[], startYear: number, emd = ''): Promise<void> {
  const XLSX = await import('xlsx-js-style')
  const n = PLAN_DB_YEARS
  const years = Array.from({ length: n }, (_, i) => startYear + i)
  const rows = [...list].sort((a, b) => (a.finalRank ?? 1e9) - (b.finalRank ?? 1e9) || a.id - b.id)
  const cells = rows.map((r) => planCellsOfRow(r))
  const midCols = 3 + n * 2 + 3

  const head1 = [
    '시설명칭',
    '위치',
    '전체 정비계획',
    '',
    '정비된 부분',
    '',
    '',
    '중기 정비계획',
    ...Array(midCols - 1).fill(''),
    '5개년 후 정비대상',
    '',
    '우선순위',
  ]
  const head2 = ['', '', '', '', '', '', '', '계', '', '', ...years.flatMap((y) => [`${y}년`, '']), '사업효과', '', '', '', '', '']
  const head3 = [
    '',
    '',
    '사업량',
    '사업비',
    '사업량',
    '사업비',
    '정비율',
    '사업량',
    '사업비',
    '정비율',
    ...years.flatMap(() => ['사업량', '사업비']),
    '수혜자(명)',
    '농경지(ha)',
    '건물(동)',
    '사업량',
    '사업비',
    '',
  ]
  const totalRow = ['계', `${rows.length}곳`, ...cellsRow(sumPlanSheetCells(cells)), '']
  const body = rows.map((r, i) => [r.name, planRowLocation(r), ...cellsRow(cells[i]!), r.finalRank ?? ''])
  const ws = XLSX.utils.aoa_to_sheet([head1, head2, head3, totalRow, ...body])
  const c = (col: number, row: number) => ({ c: col, r: row })
  const afterCol = 7 + midCols
  ws['!merges'] = [
    { s: c(0, 0), e: c(0, 2) },
    { s: c(1, 0), e: c(1, 2) },
    { s: c(2, 0), e: c(3, 1) },
    { s: c(4, 0), e: c(6, 1) },
    { s: c(7, 0), e: c(7 + midCols - 1, 0) },
    { s: c(7, 1), e: c(9, 1) },
    ...years.map((_, i) => ({ s: c(10 + i * 2, 1), e: c(11 + i * 2, 1) })),
    { s: c(10 + n * 2, 1), e: c(12 + n * 2, 1) },
    { s: c(afterCol, 0), e: c(afterCol + 1, 1) },
    { s: c(afterCol + 2, 0), e: c(afterCol + 2, 2) },
  ]
  applyThinBorders(ws, XLSX.utils)
  /** «위치» 칸 머리글에 엑셀 자동필터 — 읍면으로 걸러 볼 수 있게 (머리줄 3단 중 마지막 줄부터 끝까지) */
  ws['!autofilter'] = { ref: `B3:B${3 + 1 + rows.length}` }

  const byEmd = new Map<string, PlanSheetCells[]>()
  rows.forEach((r, i) => byEmd.set(r.emd || '—', [...(byEmd.get(r.emd || '—') ?? []), cells[i]!]))
  const summary = [...byEmd.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    .map(([emd, list]) => {
      const s = sumPlanSheetCells(list)
      const mid = planSheetMid(s.years)
      return {
        읍면: emd,
        개소: list.length,
        '전체 사업량(m)': qty(s.totalQty),
        '전체 사업비': million(s.totalCost),
        '정비된 사업비': million(s.doneCost),
        '중기 사업비': million(mid.costMil),
        ...Object.fromEntries(years.map((y, i) => [`${y}년`, million(s.years[i]!.costMil)])),
        '5개년 후': million(s.afterCost),
      }
    })

  const wsSummary = XLSX.utils.json_to_sheet(summary)
  applyThinBorders(wsSummary, XLSX.utils)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '중기계획 명세서')
  XLSX.utils.book_append_sheet(wb, wsSummary, '읍면별 종합표')
  const scope = [`${startYear}`, emd].filter(Boolean).join('_')
  XLSX.writeFile(wb, `소규모공공시설_정비계획_${scope}_${todayYmd().replace(/-/g, '')}.xlsx`)
}
