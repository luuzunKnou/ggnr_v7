import * as XLSX from 'xlsx-js-style'
import {
  TEAMS,
  type VillagePatrolRow,
  type VillagePatrolTeam,
  formatPhone,
  normalizePhone,
  sortVillagePatrolRows,
} from './villagePatrolData'

/** 원본 편성표와 맞춤 — 시군명은 runtime(FOOTER_ADDR)에서 주입 */
const DEFAULT_ROSTER_SIGUN = '시군'
const FONT_NAME = '맑은 고딕'
const HEADER_FILL = 'E8D5F2' // 연한 보라(원본 헤더 톤)
const BORDER_RGB = '000000'

function isTeam(v: string): v is VillagePatrolTeam {
  return (TEAMS as readonly string[]).includes(v)
}

function teamFromHeader(text: string): VillagePatrolTeam | null {
  const t = text.replace(/\s/g, '')
  if (t.includes('A조') || t.includes('1일차')) return 'A조'
  if (t.includes('B조') || t.includes('2일차')) return 'B조'
  if (t.includes('C조') || t.includes('3일차')) return 'C조'
  return null
}

function parseNameAff(raw: string): { name: string; affiliation: string } {
  const text = raw.replace(/\r/g, '').replace(/\n/g, '').trim()
  const open = text.lastIndexOf('(')
  const close = text.lastIndexOf(')')
  if (open > 0 && close > open) {
    return {
      name: text.slice(0, open).trim(),
      affiliation: text.slice(open + 1, close).replace(/,/g, '·').trim(),
    }
  }
  return { name: text, affiliation: '' }
}

type CellStyle = NonNullable<XLSX.CellObject['s']>

function thinBorder(): CellStyle['border'] {
  const side = { style: 'thin' as const, color: { rgb: BORDER_RGB } }
  return { top: side, bottom: side, left: side, right: side }
}

function baseStyle(extra?: CellStyle): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 10, color: { rgb: '000000' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
    ...extra,
  }
}

function styled(v: string | number, style?: CellStyle): XLSX.CellObject {
  return { v, t: typeof v === 'number' ? 'n' : 's', s: baseStyle(style) }
}

function formatNameWithAff(r: VillagePatrolRow | undefined): string {
  if (!r?.name) return ''
  const aff = (r.affiliation ?? '').trim()
  return aff ? `${r.name}\n(${aff})` : r.name
}

type VillageBlock = {
  eup: string
  village: string
  byTeam: Record<VillagePatrolTeam, VillagePatrolRow[]>
}

function buildVillageBlocks(rows: VillagePatrolRow[]): VillageBlock[] {
  const sorted = sortVillagePatrolRows(rows)
  const order: string[] = []
  const map = new Map<string, VillageBlock>()
  for (const r of sorted) {
    const key = `${r.eup}\0${r.village}`
    let block = map.get(key)
    if (!block) {
      block = {
        eup: r.eup,
        village: r.village,
        byTeam: { A조: [], B조: [], C조: [] },
      }
      map.set(key, block)
      order.push(key)
    }
    block.byTeam[r.team].push(r)
  }
  return order.map((k) => map.get(k)!)
}

/** 원본과 같은 근무조 편성표 형태로 내보내기 */
function exportRosterSheet(
  assignmentRows: VillagePatrolRow[],
  opts?: { sigun?: string }
): XLSX.WorkSheet {
  const sigun = (opts?.sigun ?? '').trim() || DEFAULT_ROSTER_SIGUN
  const title = `${sigun} 마을순찰대 근무조 편성(안)`
  const blocks = buildVillageBlocks(assignmentRows)
  const merges: XLSX.Range[] = []
  const ws: XLSX.WorkSheet = {}

  const set = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell
  }

  // 제목
  set(0, 0, styled(title, {
    font: { name: FONT_NAME, sz: 16, bold: true, color: { rgb: '000000' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: undefined,
  }))
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } })

  // 제목·헤더 사이 빈 행 — 테두리 없음, 마지막 열에 내려받기 날짜
  const downloadDate = (() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  })()
  for (let c = 0; c < 10; c++) {
    set(
      1,
      c,
      styled(c === 9 ? downloadDate : '', {
        border: undefined,
        font: { name: FONT_NAME, sz: 9, color: { rgb: '000000' } },
        alignment: {
          horizontal: c === 9 ? 'right' : 'center',
          vertical: 'center',
        },
      })
    )
  }

  const headerFill = { patternType: 'solid' as const, fgColor: { rgb: HEADER_FILL } }
  const headerStyle: CellStyle = {
    font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '000000' } },
    fill: headerFill,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  }

  // 헤더 1행 (r=2)
  const h1 = ['시군', '읍면동', '마을명', 'A조', '', 'B조', '', 'C조', '', '비고']
  h1.forEach((v, c) => set(2, c, styled(v, headerStyle)))
  // 헤더 2행 (r=3)
  const h2 = ['', '', '', '성명', '연락처', '성명', '연락처', '성명', '연락처', '']
  h2.forEach((v, c) => set(3, c, styled(v, headerStyle)))

  merges.push(
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, // 시군
    { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } }, // 읍면동
    { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } }, // 마을명
    { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } }, // A조
    { s: { r: 2, c: 5 }, e: { r: 2, c: 6 } }, // B조
    { s: { r: 2, c: 7 }, e: { r: 2, c: 8 } }, // C조
    { s: { r: 2, c: 9 }, e: { r: 3, c: 9 } } // 비고
  )

  let r = 4
  for (const block of blocks) {
    const height = Math.max(
      block.byTeam.A조.length,
      block.byTeam.B조.length,
      block.byTeam.C조.length,
      1
    )
    const start = r
    for (let i = 0; i < height; i++) {
      const a = block.byTeam.A조[i]
      const b = block.byTeam.B조[i]
      const c = block.byTeam.C조[i]
      set(r, 0, styled(i === 0 ? sigun : ''))
      set(r, 1, styled(i === 0 ? block.eup : ''))
      set(r, 2, styled(i === 0 ? block.village : ''))
      set(r, 3, styled(formatNameWithAff(a)))
      set(r, 4, styled(a ? formatPhone(a.phone) : ''))
      set(r, 5, styled(formatNameWithAff(b)))
      set(r, 6, styled(b ? formatPhone(b.phone) : ''))
      set(r, 7, styled(formatNameWithAff(c)))
      set(r, 8, styled(c ? formatPhone(c.phone) : ''))
      // 비고: 해당 엑셀 행(A/B/C 같은 줄)의 비고만 — 마을 전체 세로 병합하지 않음
      const rowNotes = [a?.note, b?.note, c?.note]
        .map((n) => (n ?? '').trim())
        .filter(Boolean)
      set(r, 9, styled([...new Set(rowNotes)].join('\n')))
      r += 1
    }
    const end = r - 1
    if (end > start) {
      merges.push(
        { s: { r: start, c: 0 }, e: { r: end, c: 0 } },
        { s: { r: start, c: 1 }, e: { r: end, c: 1 } },
        { s: { r: start, c: 2 }, e: { r: end, c: 2 } }
      )
    }
  }

  ws['!merges'] = merges
  ws['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
  ]
  ws['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 18 }, { hpt: 18 }]
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(r - 1, 3), c: 9 },
  })
  return ws
}

/** 전체 편성 명단을 엑셀로 저장 (필터·중복 모드와 무관) */
export function exportVillagePatrolExcel(
  assignmentRows: VillagePatrolRow[],
  opts?: { sigun?: string }
) {
  const wb = XLSX.utils.book_new()
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  XLSX.utils.book_append_sheet(wb, exportRosterSheet(assignmentRows, opts), '편성명단')
  XLSX.writeFile(wb, `마을순찰대_편성_${stamp}.xlsx`)
}

/** 가져오기용 양식(단순 목록) — 헤더 + 예시 1행 */
export function downloadVillagePatrolImportTemplate() {
  const header = ['읍면', '마을', '조', '성명', '소속', '연락처', '비고']
  const example = ['영양읍', '동부1', 'A조', '홍길동', '이장', '010-0000-0000', '']
  const aoa = [header, example]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr]
      if (!cell) continue
      cell.s = baseStyle(
        R === 0
          ? {
              font: { name: FONT_NAME, sz: 10, bold: true },
              fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL } },
            }
          : undefined
      )
    }
  }
  ws['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '편성명단')
  XLSX.writeFile(wb, '마을순찰대_가져오기양식.xlsx')
}

/**
 * 근무조 편성표 또는 단순 목록 엑셀을 편성 행으로 변환.
 * 판별 순서:
 * 1) 1행이 읍면·마을·조·성명… 단순 목록 헤더
 * 2) 편성표(조별 성명·연락처 또는 성명·소속·연락처)
 * 3) 그 외 1행 성명 헤더 목록
 */
export function parseVillagePatrolExcel(buf: ArrayBuffer): VillagePatrolRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
  if (!sheet) return []
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
  const cell = (r: number, c: number) => String((json[r] ?? [])[c] ?? '').trim()

  // 데이터 셀의 「A조」까지 묶어 편성표로 오인하지 않도록, 단순 목록을 먼저 판별
  if (isFlatListHeader(json[0] ?? [])) {
    return parseFlatListSheet(json, cell)
  }

  const headerJoined = json
    .slice(0, 4)
    .map((row) => row.map((v) => String(v ?? '')).join(' '))
    .join(' ')
  const looksLikeRoster =
    /마을/.test(headerJoined) &&
    (/(^|\s)(A조|B조|C조|1일차|2일차|3일차)(\s|$)/.test(headerJoined) ||
      /A조.*B조|1일차.*2일차/.test(headerJoined.replace(/\s/g, '')))

  if (looksLikeRoster) {
    const roster = parseRosterSheet(json, cell)
    if (roster.length > 0) return roster
  }

  return parseFlatListSheet(json, cell)
}

function isFlatListHeader(row: unknown[]): boolean {
  const header = row.map((v) => String(v ?? '').replace(/\s/g, '').trim())
  const hasName = header.some((h) => h === '성명' || h === '이름')
  if (!hasName) return false
  // 편성표 조 헤더(A조…)가 1행에 있으면 단순 목록이 아님
  if (header.some((h) => /^(A조|B조|C조|1일차|2일차|3일차)$/.test(h))) return false
  const hasTeamCol = header.some((h) => h === '조' || h === '근무조')
  const hasPlace = header.some((h) => h.includes('읍면') || h === '마을' || h === '마을명')
  return hasTeamCol || hasPlace
}

function parseFlatListSheet(
  json: unknown[][],
  cell: (r: number, c: number) => string
): VillagePatrolRow[] {
  const header = (json[0] ?? []).map((v) => String(v ?? '').trim())
  const col = (name: string) => {
    const exact = header.findIndex((h) => h.replace(/\s/g, '') === name)
    if (exact >= 0) return exact
    return header.findIndex((h) => h.includes(name))
  }
  // 「조」는 includes면 다른 열에 섞일 수 있어 정확 일치 우선
  const iEup = col('읍면')
  const iVil = (() => {
    const exact = header.findIndex((h) => {
      const n = h.replace(/\s/g, '')
      return n === '마을' || n === '마을명'
    })
    return exact >= 0 ? exact : col('마을')
  })()
  const iTeam = (() => {
    const exact = header.findIndex((h) => {
      const n = h.replace(/\s/g, '')
      return n === '조' || n === '근무조'
    })
    return exact >= 0 ? exact : -1
  })()
  const iName = (() => {
    const exact = header.findIndex((h) => {
      const n = h.replace(/\s/g, '')
      return n === '성명' || n === '이름'
    })
    return exact >= 0 ? exact : col('성명') >= 0 ? col('성명') : col('이름')
  })()
  const iAff = col('소속')
  const iPhone = col('연락처') >= 0 ? col('연락처') : col('전화')
  const iNote = (() => {
    const exact = header.findIndex((h) => h.replace(/\s/g, '') === '비고')
    return exact >= 0 ? exact : col('비고')
  })()
  if (iName < 0) return []

  const out: VillagePatrolRow[] = []
  for (let r = 1; r < json.length; r++) {
    const name = cell(r, iName)
    if (!name) continue
    const teamRaw = iTeam >= 0 ? cell(r, iTeam) : 'A조'
    const team: VillagePatrolTeam = isTeam(teamRaw) ? teamRaw : teamFromHeader(teamRaw) ?? 'A조'
    out.push({
      id: `imp-${r}-${out.length}`,
      eup: iEup >= 0 ? cell(r, iEup) : '',
      village: iVil >= 0 ? cell(r, iVil) : '',
      team,
      name,
      affiliation: iAff >= 0 ? cell(r, iAff) : '',
      phone: normalizePhone(iPhone >= 0 ? cell(r, iPhone) : ''),
      note: iNote >= 0 ? cell(r, iNote) : '',
    })
  }
  return out
}

function isJunkRosterName(name: string): boolean {
  return !name || name === '성명' || name === '소속' || /^(1일차|2일차|3일차|A조|B조|C조)$/.test(name)
}

type RosterTeamCols = {
  team: VillagePatrolTeam
  nameCol: number
  /** null이면 성명 칸 `이름(소속)`에서 분리 */
  affCol: number | null
  phoneCol: number
  /** 조별 비고. null이면 sharedNoteCol 사용 */
  noteCol: number | null
}

type RosterLayout = {
  headerRow: number
  /** 데이터 시작 행(서브헤더 다음, 없으면 헤더 다음) */
  dataStartRow: number
  teams: RosterTeamCols[]
  sharedNoteCol: number | null
}

const TEAM_ORDER: VillagePatrolTeam[] = ['A조', 'B조', 'C조']

/** 서브헤더 행에서 성명·소속·연락처·비고 열 위치 수집 */
function scanSubHeaderCols(
  cell: (r: number, c: number) => string,
  row: number,
  maxCol = 20
): { nameCols: number[]; affCols: number[]; phoneCols: number[]; noteCols: number[] } {
  const nameCols: number[] = []
  const affCols: number[] = []
  const phoneCols: number[] = []
  const noteCols: number[] = []
  for (let c = 0; c < maxCol; c++) {
    const v = cell(row, c).replace(/\s/g, '')
    if (v === '성명' || v === '이름') nameCols.push(c)
    else if (v === '소속') affCols.push(c)
    else if (v.includes('연락') || v.includes('전화')) phoneCols.push(c)
    else if (v === '비고') noteCols.push(c)
  }
  return { nameCols, affCols, phoneCols, noteCols }
}

/**
 * 편성표 열 배치 자동 판별
 * - 기존: 조별 성명·연락처 + (선택) 공통 비고
 * - 확장: 조별 성명·소속·연락처·비고
 */
function detectRosterLayout(
  json: unknown[][],
  cell: (r: number, c: number) => string
): RosterLayout | null {
  let headerRow = -1
  for (let r = 0; r < Math.min(8, json.length); r++) {
    const joined = Array.from({ length: 16 }, (_, c) => cell(r, c)).join('')
    if (/1일차|A조/.test(joined) && /2일차|B조|3일차|C조/.test(joined)) {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) {
    // 구형: A조가 3·5·7열에만 있는 경우
    for (let r = 0; r < Math.min(8, json.length); r++) {
      if (/1일차|A조/.test(cell(r, 3) + cell(r, 5) + cell(r, 7))) {
        headerRow = r
        break
      }
    }
  }
  if (headerRow < 0) return null

  const sub = headerRow + 1
  const scanned = scanSubHeaderCols(cell, sub)
  const hasSubLabels = scanned.nameCols.length >= 2

  // 확장 양식: 서브헤더에 소속이 조마다(2개 이상)
  if (hasSubLabels && scanned.affCols.length >= 2) {
    const teams: RosterTeamCols[] = []
    const n = Math.min(3, scanned.nameCols.length)
    for (let i = 0; i < n; i++) {
      const nameCol = scanned.nameCols[i]!
      const affCol =
        scanned.affCols.find((c) => c > nameCol && (i === n - 1 || c < scanned.nameCols[i + 1]!)) ??
        scanned.affCols[i] ??
        null
      const phoneCol =
        scanned.phoneCols.find((c) => c > nameCol && (i === n - 1 || c < scanned.nameCols[i + 1]!)) ??
        scanned.phoneCols[i] ??
        nameCol + 2
      const nextName = scanned.nameCols[i + 1]
      const noteCol =
        scanned.noteCols.find(
          (c) => c > nameCol && (nextName == null || c < nextName)
        ) ?? null
      teams.push({
        team: TEAM_ORDER[i]!,
        nameCol,
        affCol,
        phoneCol,
        noteCol,
      })
    }
    const lastTeamEnd = teams[teams.length - 1]?.noteCol ?? teams[teams.length - 1]?.phoneCol ?? 0
    const sharedNoteCol =
      scanned.noteCols.find((c) => c > lastTeamEnd) ??
      (scanned.noteCols.length === 1 && teams.every((t) => t.noteCol == null)
        ? scanned.noteCols[0]!
        : null)
    return {
      headerRow,
      dataStartRow: sub + 1,
      teams,
      sharedNoteCol,
    }
  }

  // 기존 양식: 성명·연락처 × 3 (+ 공통 비고)
  if (hasSubLabels && scanned.nameCols.length >= 2) {
    const teams: RosterTeamCols[] = []
    const n = Math.min(3, scanned.nameCols.length)
    for (let i = 0; i < n; i++) {
      const nameCol = scanned.nameCols[i]!
      const phoneCol =
        scanned.phoneCols.find((c) => c > nameCol && (i === n - 1 || c < scanned.nameCols[i + 1]!)) ??
        nameCol + 1
      teams.push({
        team: TEAM_ORDER[i]!,
        nameCol,
        affCol: null,
        phoneCol,
        noteCol: null,
      })
    }
    return {
      headerRow,
      dataStartRow: sub + 1,
      teams,
      sharedNoteCol: scanned.noteCols[0] ?? 9,
    }
  }

  // 서브헤더 라벨이 없거나 구형 고정 열
  return {
    headerRow,
    dataStartRow: headerRow + 1,
    teams: [
      { team: 'A조', nameCol: 3, affCol: null, phoneCol: 4, noteCol: null },
      { team: 'B조', nameCol: 5, affCol: null, phoneCol: 6, noteCol: null },
      { team: 'C조', nameCol: 7, affCol: null, phoneCol: 8, noteCol: null },
    ],
    sharedNoteCol: 9,
  }
}

function parseRosterSheet(
  json: unknown[][],
  cell: (r: number, c: number) => string
): VillagePatrolRow[] {
  const layout = detectRosterLayout(json, cell)
  if (!layout) return []

  const out: VillagePatrolRow[] = []
  let eup = ''
  let village = ''
  for (let r = layout.dataStartRow; r < json.length; r++) {
    const a = cell(r, 0)
    const b = cell(r, 1)
    const c = cell(r, 2)
    if (a === '계') continue
    // 서브헤더가 데이터로 섞인 경우 스킵
    if (b === '읍면동' || c === '마을명') continue
    if (/^성명$|^소속$|^연락/.test(cell(r, layout.teams[0]?.nameCol ?? 3))) continue
    if (b && b !== '읍면동') eup = b
    if (c && c !== '마을명') village = c
    for (const t of layout.teams) {
      const rawName = cell(r, t.nameCol)
      let name: string
      let affiliation: string
      if (t.affCol != null) {
        name = rawName.replace(/\r/g, '').replace(/\n/g, '').trim()
        affiliation = cell(r, t.affCol).replace(/\r/g, '').replace(/\n/g, '').trim()
        // 소속 열이 비어 있고 성명에 괄호가 있으면 기존처럼 분리
        if (!affiliation) {
          const parsed = parseNameAff(rawName)
          name = parsed.name
          affiliation = parsed.affiliation
        }
      } else {
        const parsed = parseNameAff(rawName)
        name = parsed.name
        affiliation = parsed.affiliation
      }
      if (isJunkRosterName(name)) continue
      const note =
        (t.noteCol != null ? cell(r, t.noteCol) : '') ||
        (layout.sharedNoteCol != null ? cell(r, layout.sharedNoteCol) : '') ||
        ''
      out.push({
        id: `imp-${r}-${t.team}-${out.length}`,
        eup,
        village,
        team: t.team,
        name,
        affiliation,
        phone: normalizePhone(cell(r, t.phoneCol)),
        note,
      })
    }
  }
  return sortVillagePatrolRows(out)
}
