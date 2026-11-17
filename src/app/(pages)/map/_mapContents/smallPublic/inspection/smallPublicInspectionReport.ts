import type { SmallPublicCandidate, SmallPublicFacType } from '../smallPublicConfig'
import { applyThinBorders } from '../smallPublicExcelStyle'
import { downloadHwpx, type HwpxBlock } from '../smallPublicHwpx'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'

/** 기준일 점검 대상 한 줄 — 출력 당시 값을 그대로 보관한다 */
export type SmallPublicReportRow = {
  facilityId: string
  mngNo: string
  name: string
  type: SmallPublicFacType
  emd: string
  ri: string
  address: string
  spec: string
  /** 기준일 이전 마지막 점검의 평가구분(없으면 시설 구분) */
  prevClass: SmallPublicCandidate
  /** 기준일 이전 마지막 점검일 */
  prevDate: string
}

/** 안전점검 보고서 — 기준일 점검 대상 목록과 보고서 내용. 대상 목록은 만들 때 값으로 보관한다 */
export type SmallPublicInspectionReport = {
  id: string
  year: number
  /** 대상 산정 시점(보고서 만든 날) — 화면에는 작성일로 보인다 */
  baseDate: string
  title: string
  agency: string
  author: string
  /** 보고서 개요(본문) */
  summary: string
  createdAt: string
  rows: SmallPublicReportRow[]
  /** 예시 자료로 미리 넣은 보고서 */
  sample?: boolean
}

/** 직전 연도 보고서 중 가장 나중 것 — 전년 대비 변동 비교 기준 */
export function prevYearSmallPublicReport(
  list: SmallPublicInspectionReport[],
  year: number
): SmallPublicInspectionReport | null {
  return list.filter((s) => s.year === year - 1).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

export type SmallPublicReportChanges = {
  added: SmallPublicReportRow[]
  removed: SmallPublicReportRow[]
  changed: { row: SmallPublicReportRow; from: SmallPublicCandidate; to: SmallPublicCandidate }[]
}

function specText(f: SmallPublicFacility): string {
  return [
    f.length ? `연장 ${f.length}m` : '',
    f.width ? `폭 ${f.width}m` : '',
    f.height ? `높이 ${f.height}m` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 기준일 점검 대상 — 기준일 시점 평가구분이 일반·관리이거나 «시설 등록»으로 추가한 시설(제외 빼고).
 * 시점 평가구분 = 기준일 이전 마지막 점검의 평가구분, 없으면 현재 시설 구분.
 */
export function buildSmallPublicReportRows(
  facilities: SmallPublicFacility[],
  inspections: SmallPublicInspection[],
  baseDate: string
): SmallPublicReportRow[] {
  const byId = new Map(facilities.map((f) => [f.id, f]))
  return facilities
    .filter((f) => f.candidate !== '제외')
    .map((f) => smallPublicReportRowOf(f, inspections, baseDate))
    .filter((r) => r.prevClass === '일반' || r.prevClass === '관리' || byId.get(r.facilityId)?.inspectionTarget)
    .sort(
      (a, b) =>
        a.emd.localeCompare(b.emd, 'ko') || a.type.localeCompare(b.type, 'ko') || a.name.localeCompare(b.name, 'ko')
    )
}

/** 시설 한 곳의 보고서 줄 — 기준일 이전 마지막 점검 기준 */
export function smallPublicReportRowOf(
  f: SmallPublicFacility,
  inspections: SmallPublicInspection[],
  baseDate: string
): SmallPublicReportRow {
  const last = inspections
    .filter((i) => i.facilityId === f.id && i.date <= baseDate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0]
  return {
    facilityId: f.id,
    mngNo: f.mngNo,
    name: f.name,
    type: f.type,
    emd: f.emd,
    ri: f.ri,
    address: f.address,
    spec: specText(f),
    prevClass: last?.classResult ?? f.candidate,
    prevDate: last?.date ?? '',
  }
}

export function compareSmallPublicReportRows(
  cur: SmallPublicReportRow[],
  prev: SmallPublicReportRow[]
): SmallPublicReportChanges {
  const prevById = new Map(prev.map((r) => [r.facilityId, r]))
  const curIds = new Set(cur.map((r) => r.facilityId))
  const changed: SmallPublicReportChanges['changed'] = []
  const added: SmallPublicReportRow[] = []
  for (const r of cur) {
    const p = prevById.get(r.facilityId)
    if (!p) added.push(r)
    else if (p.prevClass !== r.prevClass) changed.push({ row: r, from: p.prevClass, to: r.prevClass })
  }
  return { added, removed: prev.filter((r) => !curIds.has(r.facilityId)), changed }
}

function countBy(rows: SmallPublicReportRow[], key: (r: SmallPublicReportRow) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
}

/** 출력 일시 — 화면 표시용 지역 시각(YYYY-MM-DDTHH:mm:ss) */
export function smallPublicReportStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function smallPublicReportTitle(year: number): string {
  return `${year}년 소규모 공공시설 안전점검 대상`
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function countTableHtml(title: string, entries: [string, number][]): string {
  const body = entries.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('')
  return `<table class="list cnt"><thead><tr><th>${esc(title)}</th><th>곳</th></tr></thead><tbody>${body}</tbody></table>`
}

/** 사업발주 근거자료 — 화면 미리보기·인쇄용 HTML */
export function buildSmallPublicReportHtml(
  snap: SmallPublicInspectionReport,
  prev: SmallPublicInspectionReport | null
): string {
  const { rows, year, baseDate } = snap
  const changes = prev ? compareSmallPublicReportRows(rows, prev.rows) : null
  const listRows = rows
    .map(
      (r, k) =>
        `<tr><td class="num">${k + 1}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${esc(
          [r.emd, r.ri].filter(Boolean).join(' ')
        )}</td><td>${esc(r.spec || '—')}</td><td>${esc(r.prevClass)}</td><td>${esc(r.prevDate || '—')}</td></tr>`
    )
    .join('')
  const changeList = (title: string, list: string[]) =>
    `<p class="sub">${esc(title)} ${list.length}곳</p>${
      list.length ? `<ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
    }`
  const changeHtml = !changes
    ? `<p class="empty">비교할 ${year - 1}년 보고서가 없습니다.</p>`
    : `<p class="meta">비교 기준: ${prev!.year}년 보고서(작성일 ${esc(prev!.baseDate)}, ${prev!.rows.length}곳)</p>
       ${changeList('신규', changes.added.map((r) => `${r.name} (${r.emd}, ${r.prevClass})`))}
       ${changeList('제외', changes.removed.map((r) => `${r.name} (${r.emd}, 전년 ${r.prevClass})`))}
       ${changeList('평가구분 변경', changes.changed.map((c) => `${c.row.name} (${c.row.emd}) ${c.from} → ${c.to}`))}`

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${esc(snap.title || smallPublicReportTitle(year))}</title>
<style>
  body{font-family:'Malgun Gothic',sans-serif;margin:24px;color:#0f172a;font-size:12px}
  h1{font-size:20px;margin:0 0 6px}
  h2{font-size:14px;margin:18px 0 6px;padding-bottom:3px;border-bottom:2px solid #334155}
  .meta{color:#64748b;font-size:11px;margin:2px 0 6px}
  .sub{font-weight:600;margin:8px 0 2px}
  .empty{color:#64748b}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #94a3b8;padding:4px 6px;text-align:left}
  th{background:#e2e8f0;font-weight:600;text-align:center}
  td.num{text-align:right;width:40px}
  .cnts{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
  table.cnt{width:auto;min-width:180px}
  ul{margin:2px 0 6px;padding-left:18px}
  .box{border:1px dashed #94a3b8;padding:8px 10px;color:#475569}
  @media print{body{margin:12px} h2{break-after:avoid} tr{break-inside:avoid}}
</style>
</head>
<body>
  <h1>${esc(snap.title || smallPublicReportTitle(year))}</h1>
  <p class="meta">대상 ${rows.length}곳${snap.agency ? ` · 점검 기관 ${esc(snap.agency)}` : ''}${
    snap.author ? ` · 작성 ${esc(snap.author)}` : ''
  }${snap.createdAt ? ` · 작성일 ${esc(snap.createdAt.slice(0, 10))}` : ''}${snap.sample ? ' · 예시 자료' : ''}</p>

  <h2>1. 개요</h2>
  <p>${year}년 소규모 공공시설 안전점검 대상은 보고서 작성 시점(${esc(baseDate)}) ${rows.length}곳이다.</p>
  ${snap.summary ? `<p style="white-space:pre-wrap">${esc(snap.summary)}</p>` : ''}
  <div class="cnts">${countTableHtml('읍면', countBy(rows, (r) => r.emd || '—'))}${countTableHtml(
    '유형',
    countBy(rows, (r) => r.type)
  )}${countTableHtml('평가구분', countBy(rows, (r) => r.prevClass))}</div>

  <h2>2. 대상 선정 기준</h2>
  <p>전체 소규모 공공시설 중 보고서 작성 시점에 평가구분이 일반·관리인 시설을 대상으로 하고, 위험시설 재점검 등 담당자가 추가한 시설을 포함한다. 선정 제외 시설은 뺀다.</p>

  <h2>3. 법적 근거</h2>
  <div class="box">점검 주기·의무 조항은 법령 원문 확인 후 기재</div>

  <h2>4. 대상 목록</h2>
  <table class="list">
    <thead><tr><th>번호</th><th>시설명</th><th>유형</th><th>위치</th><th>제원</th><th>직전 평가구분</th><th>직전 점검일</th></tr></thead>
    <tbody>${listRows || '<tr><td colspan="7" class="empty">대상이 없습니다.</td></tr>'}</tbody>
  </table>

  <h2>5. 전년 대비 변동</h2>
  ${changeHtml}
</body>
</html>`
}

/** 대상 목록·집계·변동을 시트로 나눠 내려받기 (엑셀 라이브러리는 누를 때만 불러옴) */
export async function exportSmallPublicReportExcel(
  snap: SmallPublicInspectionReport,
  prev: SmallPublicInspectionReport | null
): Promise<void> {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()
  const add = (rows: Record<string, unknown>[], name: string) => {
    const ws = XLSX.utils.json_to_sheet(rows)
    applyThinBorders(ws, XLSX.utils)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const list = snap.rows.map((r, k) => ({
    번호: k + 1,
    관리번호: r.mngNo,
    시설명: r.name,
    유형: r.type,
    읍면: r.emd,
    리: r.ri,
    주소: r.address,
    제원: r.spec,
    직전평가구분: r.prevClass,
    직전점검일: r.prevDate,
  }))
  add(list, '점검대상')
  const cnt = (title: string, entries: [string, number][]) => entries.map(([k, n]) => ({ [title]: k, 곳: n }))
  add(cnt('읍면', countBy(snap.rows, (r) => r.emd || '—')), '읍면별')
  add(cnt('유형', countBy(snap.rows, (r) => r.type)), '유형별')
  if (prev) {
    const c = compareSmallPublicReportRows(snap.rows, prev.rows)
    const rows = [
      ...c.added.map((r) => ({ 변동: '신규', 시설명: r.name, 읍면: r.emd, 전년: '', 올해: r.prevClass })),
      ...c.removed.map((r) => ({ 변동: '제외', 시설명: r.name, 읍면: r.emd, 전년: r.prevClass, 올해: '' })),
      ...c.changed.map((x) => ({ 변동: '평가구분 변경', 시설명: x.row.name, 읍면: x.row.emd, 전년: x.from, 올해: x.to })),
    ]
    add(rows.length ? rows : [{ 변동: '변동 없음' }], '전년대비변동')
  }
  XLSX.writeFile(wb, `안전점검대상_${snap.year}_${snap.baseDate.replace(/-/g, '')}.xlsx`)
}

/** 보고서 한글 문서 본문 — 미리보기 HTML과 같은 구성 */
export function buildSmallPublicReportHwpxBlocks(
  snap: SmallPublicInspectionReport,
  prev: SmallPublicInspectionReport | null
): HwpxBlock[] {
  const { rows, year, baseDate } = snap
  const title = snap.title || smallPublicReportTitle(year)
  const metaParts = [
    `대상 ${rows.length}곳`,
    snap.agency ? `점검 기관 ${snap.agency}` : '',
    snap.author ? `작성 ${snap.author}` : '',
    snap.createdAt ? `작성일 ${snap.createdAt.slice(0, 10)}` : '',
    snap.sample ? '예시 자료' : '',
  ].filter(Boolean)
  const changes = prev ? compareSmallPublicReportRows(rows, prev.rows) : null
  const countRows = (entries: [string, number][]) =>
    entries.map(([k, n]) => [{ text: k }, { text: String(n), align: 'right' as const }])
  const blocks: HwpxBlock[] = [
    { kind: 'title', text: title },
    { kind: 'meta', text: metaParts.join(' · ') },
    { kind: 'heading', text: '1. 개요' },
    {
      kind: 'para',
      text: `${year}년 소규모 공공시설 안전점검 대상은 보고서 작성 시점(${baseDate}) ${rows.length}곳이다.`,
    },
  ]
  if (snap.summary.trim()) blocks.push({ kind: 'para', text: snap.summary })
  blocks.push(
    {
      kind: 'table',
      widths: [70, 30],
      head: ['읍면', '곳'],
      align: ['left', 'right'],
      rows: countRows(countBy(rows, (r) => r.emd || '—')),
    },
    {
      kind: 'table',
      widths: [70, 30],
      head: ['유형', '곳'],
      align: ['left', 'right'],
      rows: countRows(countBy(rows, (r) => r.type)),
    },
    {
      kind: 'table',
      widths: [70, 30],
      head: ['평가구분', '곳'],
      align: ['left', 'right'],
      rows: countRows(countBy(rows, (r) => r.prevClass)),
    },
    { kind: 'heading', text: '2. 대상 선정 기준' },
    {
      kind: 'para',
      text: '전체 소규모 공공시설 중 보고서 작성 시점에 평가구분이 일반·관리인 시설을 대상으로 하고, 위험시설 재점검 등 담당자가 추가한 시설을 포함한다. 선정 제외 시설은 뺀다.',
    },
    { kind: 'heading', text: '3. 법적 근거' },
    { kind: 'note', text: '점검 주기·의무 조항은 법령 원문 확인 후 기재' },
    { kind: 'heading', text: '4. 대상 목록' },
    {
      kind: 'table',
      widths: [8, 22, 12, 14, 16, 14, 14],
      head: ['번호', '시설명', '유형', '위치', '제원', '직전 평가구분', '직전 점검일'],
      align: ['right', 'left', 'left', 'left', 'left', 'center', 'center'],
      rows: rows.length
        ? rows.map((r, k) => [
            { text: String(k + 1), align: 'right' as const },
            r.name,
            r.type,
            [r.emd, r.ri].filter(Boolean).join(' '),
            r.spec || '—',
            { text: r.prevClass, align: 'center' as const },
            { text: r.prevDate || '—', align: 'center' as const },
          ])
        : [{ group: '대상이 없습니다.' }],
    },
    { kind: 'heading', text: '5. 전년 대비 변동' }
  )
  if (!changes || !prev) {
    blocks.push({ kind: 'para', text: `비교할 ${year - 1}년 보고서가 없습니다.` })
  } else {
    blocks.push({
      kind: 'meta',
      text: `비교 기준: ${prev.year}년 보고서(작성일 ${prev.baseDate}, ${prev.rows.length}곳)`,
    })
    const pushList = (label: string, list: string[]) => {
      blocks.push({ kind: 'para', text: `${label} ${list.length}곳` })
      for (const t of list) blocks.push({ kind: 'para', text: `· ${t}` })
    }
    pushList(
      '신규',
      changes.added.map((r) => `${r.name} (${r.emd}, ${r.prevClass})`)
    )
    pushList(
      '제외',
      changes.removed.map((r) => `${r.name} (${r.emd}, 전년 ${r.prevClass})`)
    )
    pushList(
      '평가구분 변경',
      changes.changed.map((c) => `${c.row.name} (${c.row.emd}) ${c.from} → ${c.to}`)
    )
  }
  return blocks
}

/** 보고서 한글(.hwpx) 내려받기 — 점검 대상 목록·사업발주 근거자료 */
export function downloadSmallPublicReportHwpx(
  snap: SmallPublicInspectionReport,
  prev: SmallPublicInspectionReport | null
): void {
  const title = snap.title || smallPublicReportTitle(snap.year)
  const safe = title.replace(/[\/:*?"<>|]/g, '_')
  downloadHwpx(
    `${safe}_${snap.baseDate.replace(/-/g, '')}.hwpx`,
    title,
    buildSmallPublicReportHwpxBlocks(snap, prev)
  )
}
