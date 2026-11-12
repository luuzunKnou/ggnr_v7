/**
 * 소규모 공공시설 엑셀 — 표 칸에 가는 구분선(테두리)을 넣는다.
 * xlsx-js-style로 만든 시트에만 스타일이 살아 있다.
 */

type BorderSide = { style: 'thin'; color: { rgb: string } }

const SIDE: BorderSide = { style: 'thin', color: { rgb: '000000' } }
const BORDER = { top: SIDE, bottom: SIDE, left: SIDE, right: SIDE }

type Cell = { t?: string; v?: unknown; s?: Record<string, unknown> }

type SheetUtils = {
  encode_cell: (c: { r: number; c: number }) => string
  decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } }
}

/** 시트의 사용 범위(!ref) 안 모든 칸에 가는 테두리. 빈 칸은 채워 넣는다. */
export function applyThinBorders(
  ws: { [key: string]: unknown; '!ref'?: string },
  utils: SheetUtils
): void {
  const ref = ws['!ref']
  if (!ref) return
  const range = utils.decode_range(ref)
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = utils.encode_cell({ r: R, c: C })
      const cell = (ws[addr] as Cell | undefined) ?? { t: 's', v: '' }
      ws[addr] = cell
      cell.s = { ...(cell.s ?? {}), border: BORDER }
    }
  }
}
