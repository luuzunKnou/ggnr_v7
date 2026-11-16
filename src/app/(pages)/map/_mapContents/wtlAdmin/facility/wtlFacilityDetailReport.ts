/**
 * 시설·설비·이력관리 상세 보고서 HTML
 * — 계량기위치 보고서와 동일한 테마·인쇄 톤, 섹션 구성은 상세 탭 순서.
 */

export type FacilityReportAttrRow = {
  label: string
  value: string
}

export type FacilityReportTableSection = {
  title: string
  columns: string[]
  rows: string[][]
  emptyText?: string
}

function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatReportDateTime(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function attrTwoColTable(attrs: FacilityReportAttrRow[]): string {
  if (attrs.length === 0) {
    return `<p class="empty">표시할 기본정보가 없습니다.</p>`
  }
  const rowsHtml: string[] = []
  for (let i = 0; i < attrs.length; i += 2) {
    const left = attrs[i]!
    const right = attrs[i + 1]
    if (right) {
      rowsHtml.push(
        `<tr><th>${esc(left.label)}</th><td>${esc(left.value)}</td><th>${esc(right.label)}</th><td>${esc(right.value)}</td></tr>`
      )
    } else {
      rowsHtml.push(
        `<tr><th>${esc(left.label)}</th><td colspan="3">${esc(left.value)}</td></tr>`
      )
    }
  }
  return `<table class="attr">${rowsHtml.join('')}</table>`
}

function listTableHtml(section: FacilityReportTableSection): string {
  if (section.columns.length === 0) {
    return `<p class="empty">${esc(section.emptyText || '표시할 열이 없습니다.')}</p>`
  }
  if (section.rows.length === 0) {
    return `<p class="empty">${esc(section.emptyText || '데이터가 없습니다.')}</p>`
  }
  const head = section.columns
    .map((c) => `<th>${esc(c)}</th>`)
    .join('')
  const body = section.rows
    .map(
      (r) =>
        `<tr>${section.columns
          .map((_, i) => `<td>${esc(r[i] ?? '—')}</td>`)
          .join('')}</tr>`
    )
    .join('')
  return `<table class="list"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

/** 시설·설비·이력관리 상세 보고서 HTML */
export function buildWtlFacilityDetailReportHtml(args: {
  title: string
  layerLabel: string
  basicAttrs: FacilityReportAttrRow[]
  sections: FacilityReportTableSection[]
}): string {
  const now = formatReportDateTime()
  const docTitle = `${args.title} 상세보고서`
  const layer = String(args.layerLabel ?? '').trim()
  const totalPages = 1 + args.sections.length
  const pageClass = (idx: number, total: number) =>
    [
      'report-page',
      idx === 0 ? 'report-page-first' : '',
      idx === total - 1 ? 'report-page-last' : '',
    ]
      .filter(Boolean)
      .join(' ')

  const basicPage = `<section class="${pageClass(0, totalPages)}">
  <div class="doc-head">
    <h1>${esc(docTitle)}</h1>
    <div class="meta-row">
      <span>${esc(layer || '상세')} · 기본정보·탭 현황</span>
      <span>작성일시 ${esc(now)}</span>
    </div>
  </div>
  <h2>1. 기본정보</h2>
  ${attrTwoColTable(args.basicAttrs)}
</section>`

  const sectionPages = args.sections
    .map((sec, idx) => {
      const n = idx + 2
      return `<section class="${pageClass(idx + 1, totalPages)}">
  <h2>${n}. ${esc(sec.title)}${
        sec.rows.length > 0 ? ` (${sec.rows.length})` : ''
      }</h2>
  ${listTableHtml(sec)}
</section>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>${esc(docTitle)}</title>
<style>
  @page{size:A4 portrait;margin:12mm}
  :root{
    color-scheme:light;
    --rpt-bg:#ffffff;--rpt-fg:#1a1a1a;--rpt-muted:#64748b;--rpt-line:#94a3b8;
    --rpt-head:#e2e8f0;--rpt-soft:#f8fafc;--rpt-strong:#1e293b;--rpt-accent:#334155
  }
  html.dark{
    color-scheme:dark;
    --rpt-bg:#1a1a1a;--rpt-fg:#fafafa;--rpt-muted:#b3b3b3;--rpt-line:rgba(255,255,255,.16);
    --rpt-head:#3a3a3a;--rpt-soft:#2a2a2a;--rpt-strong:#fafafa;--rpt-accent:#8a8a8a
  }
  html,body{background:var(--rpt-bg);color:var(--rpt-fg)}
  body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:12px;margin:16px 20px;line-height:1.45}
  .doc-head{border-bottom:2px solid var(--rpt-strong);padding-bottom:10px;margin-bottom:12px}
  /* 모달 헤더와 제목 중복 — 화면에서는 h1만 숨기고 작성일시 등 메타는 유지 */
  .doc-head h1{display:none}
  .meta-row{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--rpt-muted);font-size:11px}
  .report-page{margin-bottom:20px;padding-bottom:16px;border-bottom:1px dashed var(--rpt-line)}
  .report-page-last{margin-bottom:0;padding-bottom:0;border-bottom:0}
  h2{font-size:13px;margin:0 0 8px;padding:4px 8px;background:var(--rpt-soft);border-left:3px solid var(--rpt-accent);color:var(--rpt-fg)}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;background:var(--rpt-bg);color:var(--rpt-fg)}
  th,td{border:1px solid var(--rpt-line);padding:5px 7px;text-align:left;vertical-align:top;color:var(--rpt-fg)}
  table.attr th{background:var(--rpt-head);width:14%;font-weight:600;white-space:nowrap}
  table.attr td{width:36%}
  table.list th{background:var(--rpt-head);font-weight:600;text-align:center}
  table.list td{font-size:11px}
  .empty{color:var(--rpt-muted);margin:4px 0 8px}
  @media print{
    :root,html.dark{
      color-scheme:light;
      --rpt-bg:#ffffff;--rpt-fg:#1a1a1a;--rpt-muted:#64748b;--rpt-line:#94a3b8;
      --rpt-head:#e2e8f0;--rpt-soft:#f8fafc;--rpt-strong:#1e293b;--rpt-accent:#334155
    }
    html,body{
      background:#ffffff;color:#1a1a1a;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;
      margin:0;padding:0
    }
    .doc-head{
      margin:0 0 12px;
      padding:0 0 10px;
      border-bottom:2px solid #1a1a1a;
    }
    .doc-head h1{
      display:block;
      font-size:18px;
      margin:0 0 6px;
      letter-spacing:-0.02em;
      color:#1a1a1a;
    }
    .report-page{
      box-sizing:border-box;
      width:100%;
      margin:0;
      padding:0;
      border:0;
      break-after:page;
      page-break-after:always;
    }
    .report-page-last{
      break-after:auto;
      page-break-after:auto;
    }
    h2{break-after:avoid;page-break-after:avoid}
    table{break-inside:auto}
    tr{break-inside:avoid;page-break-inside:avoid}
  }
</style>
</head>
<body>
  ${basicPage}
  ${sectionPages}
</body>
</html>`
}
