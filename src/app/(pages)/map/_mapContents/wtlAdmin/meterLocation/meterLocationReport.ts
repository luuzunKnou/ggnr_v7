export type MeterReportMeterLine = {
  meterNo: string
  address: string
}

export type MeterReportZoneRow = {
  zoneLabel: string
  meters: MeterReportMeterLine[]
  /** 구역 내 고유 필지(PNU) 건수 */
  parcelCount: number
  mapDataUrl: string | null
  /** 캡처 성공/실패 구분 — 실패 시 보고서에 이유 표시 */
  mapCaptureStatus?: 'ok' | 'failed'
  mapCaptureReason?: string
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

/** 이 건수 이하: 행당 1건. 초과 시 행당 2건(왼쪽 열 먼저 채움). */
const METER_TABLE_DUAL_THRESHOLD = 14

function meterCellsHtml(m: MeterReportMeterLine | undefined, index: number): string {
  if (!m) {
    return `<td class="col-idx"></td><td class="col-meter-no"></td><td class="col-meter-addr"></td>`
  }
  const no = esc(m.meterNo) || '—'
  const addr = esc(String(m.address ?? '').trim() || '—')
  return `<td class="col-idx">${index + 1}</td><td class="col-meter-no">${no}</td><td class="col-meter-addr">${addr}</td>`
}

const METER_HEAD_3 =
  `<th class="col-idx">번호</th><th class="col-meter-no">계량기 번호</th><th class="col-meter-addr">계량기 주소</th>`

/** 15건 이하: 행당 1건. 초과: 행당 2건(왼쪽→오른쪽). */
function zoneMetersTableHtml(z: MeterReportZoneRow): string {
  const meters = z.meters
  const dual = meters.length > METER_TABLE_DUAL_THRESHOLD
  if (meters.length === 0) {
    return `<table class="list zone-table zone-table-single">
    <thead><tr>${METER_HEAD_3}</tr></thead>
    <tbody>
      <tr><td colspan="3" class="empty-row">—</td></tr>
    </tbody>
  </table>`
  }
  if (!dual) {
    const bodyRows = meters
      .map((m, i) => `<tr>${meterCellsHtml(m, i)}</tr>`)
      .join('')
    return `<table class="list zone-table zone-table-single">
    <thead><tr>${METER_HEAD_3}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`
  }
  const leftCount = Math.ceil(meters.length / 2)
  const bodyRows = Array.from({ length: leftCount }, (_, row) => {
    const leftIdx = row
    const rightIdx = leftCount + row
    const right = rightIdx < meters.length ? meters[rightIdx] : undefined
    return `<tr>${meterCellsHtml(meters[leftIdx], leftIdx)}${meterCellsHtml(right, rightIdx)}</tr>`
  }).join('')
  return `<table class="list zone-table zone-table-dual">
    <thead><tr>${METER_HEAD_3}${METER_HEAD_3}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`
}

function zoneMapSectionHtml(z: MeterReportZoneRow): string {
  const captureFailed = z.mapCaptureStatus === 'failed' || !z.mapDataUrl
  const failReason = (z.mapCaptureReason ?? '').trim()
  const mapHtml = z.mapDataUrl
    ? `<img class="zone-map" src="${z.mapDataUrl}" alt="${esc(z.zoneLabel)} 지도" />`
    : `<div class="zone-map-empty">${
        captureFailed
          ? `캡처 실패${failReason ? `<br/><span class="fail-reason">${esc(failReason)}</span>` : ''}`
          : '지도 없음'
      }</div>`
  return `<section class="zone-map-section">${mapHtml}</section>`
}

export type MeterReportPageOrientation = 'portrait' | 'landscape'

/** 인쇄 방향에 맞춰 @page size · 메타 문구만 교체 */
export function applyMeterReportPageOrientation(
  html: string,
  orientation: MeterReportPageOrientation
): string {
  const size =
    orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'
  const label = orientation === 'landscape' ? 'A4 가로' : 'A4 세로'
  return html
    .replace(
      /@page\s*\{[^}]*\}/m,
      `@page{\n    size:${size};\n    margin:12mm;\n  }`
    )
    .replace(
      /계량기위치 · 구역별 목록 · A4 (?:세로|가로)/,
      `계량기위치 · 구역별 목록 · ${label}`
    )
}

/**
 * 계량기위치 보고서 HTML.
 * 구역마다 h2 · 계량기 표 · 하단 지도. 표가 길면 다음 페이지에도 h2 반복.
 */
export function buildMeterLocationReportHtml(args: {
  zones: MeterReportZoneRow[]
  parcelCount: number
  meterCount: number
  pageOrientation?: MeterReportPageOrientation
}): string {
  const now = formatReportDateTime()
  const title = '계량기위치 보고서'
  const orientation: MeterReportPageOrientation =
    args.pageOrientation === 'landscape' ? 'landscape' : 'portrait'
  const pageLabel = orientation === 'landscape' ? 'A4 가로' : 'A4 세로'
  const headHtml = `<div class="doc-head">
    <h1>${esc(title)}</h1>
    <div class="meta-row">
      <span>계량기위치 · 구역별 목록 · ${pageLabel}</span>
      <span>작성일시 ${esc(now)}</span>
    </div>
  </div>
  <div class="summary">
    <span>구역 ${args.zones.length}건</span>
    <span>계량기 ${args.meterCount}건</span>
    <span>필지 ${args.parcelCount}건</span>
  </div>`

  const zoneNavHtml =
    args.zones.length === 0
      ? ''
      : `<aside class="zone-nav">
    <nav class="zone-nav-inner" aria-label="구역 목록">
      ${args.zones
        .map((z, idx) => {
          const label = esc(z.zoneLabel) || `구역 ${idx + 1}`
          return `<button type="button" class="zone-nav-item" data-zone-id="zone-${idx}" title="${label}">${label}</button>`
        })
        .join('')}
    </nav>
  </aside>`

  const zoneBlocks =
    args.zones.length === 0
      ? `${headHtml}<div class="zone-empty">표시할 구역이 없습니다.</div>`
      : args.zones
          .map((z, idx) => {
            const last = idx === args.zones.length - 1
            const first = idx === 0
            const cls = [
              'zone-page',
              first ? 'zone-page-first' : '',
              last ? 'zone-page-last' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const meterCount = z.meters.length
            const parcelCount = Math.max(0, Number(z.parcelCount) || 0)
            // thead에 h2 — 인쇄 시 페이지가 갈라져도 헤더 반복
            return `<section class="${cls}" id="zone-${idx}">
  ${first ? headHtml : ''}
  <table class="zone-flow">
    <thead>
      <tr>
        <th class="zone-flow-head"><h2>${esc(z.zoneLabel)} (계량기 ${meterCount}건 · 필지 ${parcelCount}건)</h2></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="zone-flow-cell">
          <h3>- 목록</h3>
          ${zoneMetersTableHtml(z)}
        </td>
      </tr>
      <tr>
        <td class="zone-flow-cell zone-flow-map">
          <h3>- 지도</h3>
          ${zoneMapSectionHtml(z)}
        </td>
      </tr>
    </tbody>
  </table>
</section>`
          })
          .join('\n')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  @page{
    size:A4 ${orientation};
    margin:12mm;
  }
  :root{
    color-scheme:light;
    --rpt-bg:#ffffff;--rpt-fg:#1a1a1a;--rpt-muted:#8a8a8a;--rpt-line:#e5e5e5;
    --rpt-head:#f5f5f5;--rpt-soft:#fafafa;--rpt-strong:#1a1a1a;--rpt-accent:#334155;
    --rpt-fail-bg:#fef2f2;--rpt-fail-fg:#b91c1c;--rpt-fail-line:#fecaca;--rpt-map:#e2e8f0;
    --rpt-primary:#0F91B2;--rpt-aside-bg:rgba(245,245,245,.8)
  }
  html.dark{
    color-scheme:dark;
    --rpt-bg:#1a1a1a;--rpt-fg:#fafafa;--rpt-muted:#b3b3b3;--rpt-line:rgba(255,255,255,.16);
    --rpt-head:#3a3a3a;--rpt-soft:#2a2a2a;--rpt-strong:#fafafa;--rpt-accent:#8a8a8a;
    --rpt-fail-bg:#3a2424;--rpt-fail-fg:#fca5a5;--rpt-fail-line:#7f1d1d;--rpt-map:#2a2a2a;
    --rpt-primary:#0F91B2;--rpt-aside-bg:rgba(58,58,58,.8)
  }
  html,body{background:var(--rpt-bg);color:var(--rpt-fg);height:100%}
  body{
    font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:12px;
    margin:0;line-height:1.45;overflow:hidden
  }
  /* 설치 매뉴얼(InstallManual) 좌측 목차 패널과 동일 골격 */
  .report-layout{
    display:flex;height:100%;min-height:0;background:var(--rpt-bg);color:var(--rpt-fg);
    border:1px solid var(--rpt-line);box-sizing:border-box
  }
  .report-main{flex:1;min-width:0;min-height:0;overflow:auto;padding:16px 20px;box-sizing:border-box}
  .zone-nav{
    display:flex;flex-direction:column;flex:0 0 8rem;width:8rem;min-height:0;
    border-right:1px solid var(--rpt-line);background:var(--rpt-aside-bg);box-sizing:border-box
  }
  .zone-nav-inner{
    display:flex;flex-direction:column;gap:20px;flex:1;min-height:0;
    overflow:auto;padding:8px;box-sizing:border-box
  }
  .zone-nav-item{
    display:block;width:100%;box-sizing:border-box;cursor:pointer;
    border:0;border-radius:2px;background:transparent;color:var(--rpt-fg);
    text-align:left;font:inherit;font-size:12px;font-weight:500;line-height:1.375;
    padding:4px 4px 4px 10px;word-break:keep-all
  }
  .zone-nav-item:hover{
    background:rgba(15,145,178,.05);color:var(--rpt-primary)
  }
  .zone-nav-item.is-active{
    background:rgba(15,145,178,.08);color:var(--rpt-primary);font-weight:600
  }
  .doc-head{border-bottom:2px solid var(--rpt-strong);padding-bottom:10px;margin-bottom:12px}
  /* 모달 헤더와 제목 중복 — 화면에서는 h1만 숨기고 작성일시 등 메타는 유지 */
  .doc-head h1{display:none}
  .meta-row{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--rpt-muted);font-size:11px}
  .summary{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .summary span{border:1px solid var(--rpt-line);background:var(--rpt-soft);color:var(--rpt-fg);border-radius:4px;padding:4px 10px;font-size:11px}
  h2{font-size:12px;margin:0 0 8px;padding:4px 8px;background:var(--rpt-soft);border-left:3px solid var(--rpt-accent);color:var(--rpt-fg)}
  h3{font-size:12px;font-weight:700;margin:0 0 6px;color:var(--rpt-strong)}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;background:var(--rpt-bg);color:var(--rpt-fg);table-layout:fixed}
  th,td{border:1px solid var(--rpt-line);padding:6px 8px;text-align:left;vertical-align:top;color:var(--rpt-fg)}
  table.list th{background:var(--rpt-head);font-weight:600;text-align:center}
  table.list td{font-size:11px}
  .zone-table-single .col-idx{width:10%;text-align:center;white-space:nowrap}
  .zone-table-single .col-meter-no{width:28%;font-weight:600;color:var(--rpt-strong);white-space:nowrap}
  .zone-table-single .col-meter-addr{width:62%;color:var(--rpt-fg);line-height:1.35;word-break:keep-all}
  .zone-table-dual .col-idx{width:6%;text-align:center;white-space:nowrap}
  .zone-table-dual .col-meter-no{width:16%;font-weight:600;color:var(--rpt-strong);white-space:nowrap}
  .zone-table-dual .col-meter-addr{width:28%;color:var(--rpt-fg);line-height:1.35;word-break:keep-all}
  th.col-idx,th.col-meter-no,th.col-meter-addr{font-weight:600;color:inherit;white-space:nowrap}
  th.col-idx,td.col-idx{text-align:center !important;vertical-align:middle}
  .empty-row{text-align:center;color:var(--rpt-muted)}
  /* 구역 흐름 래퍼 — 인쇄 시 thead(h2) 페이지 반복용 */
  table.zone-flow{margin:0 0 12px;border:0;background:transparent}
  table.zone-flow > thead{display:table-header-group}
  table.zone-flow > thead > tr > th.zone-flow-head{
    border:0;padding:0;margin:0;background:transparent;font-weight:normal;text-align:left;vertical-align:top
  }
  table.zone-flow > tbody > tr > td.zone-flow-cell{
    border:0;padding:0;margin:0;background:transparent;vertical-align:top
  }
  table.zone-flow .zone-table{margin-bottom:8px}
  .zone-map-section{margin-top:4px}
  .zone-map{display:block;width:100%;height:auto;max-height:none;object-fit:contain;object-position:center;border:1px solid var(--rpt-line);background:var(--rpt-map)}
  .zone-map-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;background:var(--rpt-fail-bg);color:var(--rpt-fail-fg);border:1px solid var(--rpt-fail-line);text-align:center;padding:8px;font-weight:600}
  .fail-reason{display:block;margin-top:4px;font-size:10px;font-weight:400;color:var(--rpt-muted)}
  .zone-empty{padding:24px;text-align:center;color:var(--rpt-muted);border:1px dashed var(--rpt-line)}
  .zone-page{margin-bottom:24px}
  .foot{margin-top:12px;font-size:10px;color:var(--rpt-muted)}
  @media print{
    :root,html.dark{
      color-scheme:light;
      --rpt-bg:#ffffff;--rpt-fg:#1a1a1a;--rpt-muted:#64748b;--rpt-line:#94a3b8;
      --rpt-head:#e2e8f0;--rpt-soft:#f8fafc;--rpt-strong:#1e293b;--rpt-accent:#334155;
      --rpt-fail-bg:#fef2f2;--rpt-fail-fg:#b91c1c;--rpt-fail-line:#fecaca;--rpt-map:#e2e8f0
    }
    html,body{
      background:#ffffff;color:#1a1a1a;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;
      width:100%;height:auto;margin:0;padding:0;overflow:visible
    }
    .zone-nav{display:none !important}
    .report-layout{
      display:block;height:auto;min-height:0;border:0;overflow:visible
    }
    .report-main{
      width:100%;overflow:visible;padding:0
    }
    .foot{display:none}
    .doc-head{
      display:block;
      margin:0 0 3mm;
      padding:0 0 2mm;
      border-bottom:2px solid #1a1a1a;
    }
    .doc-head h1{
      display:block;
      font-size:18px;
      margin:0 0 6px;
      letter-spacing:-0.02em;
      color:#1a1a1a;
    }
    .meta-row{font-size:9pt;gap:4px 12px}
    .summary{
      display:flex;
      gap:4px;
      margin:0 0 3mm;
    }
    .summary span{padding:1.5mm 3mm;font-size:9pt}
    h2,h3{
      break-after:avoid;
      page-break-after:avoid;
    }
    h3{margin:0 0 1.5mm}
    .zone-page{
      box-sizing:border-box;
      width:100%;
      height:auto;
      margin:0;
      padding:0;
      overflow:visible;
      display:block;
      break-after:page;
      page-break-after:always;
      /* 표·지도가 길면 페이지 분할 허용 — thead h2 반복 */
      break-inside:auto;
      page-break-inside:auto;
    }
    .zone-page-last{
      break-after:auto;
      page-break-after:auto;
    }
    table.zone-flow{
      width:100%;
      margin:0;
      border-collapse:collapse;
      table-layout:fixed;
    }
    table.zone-flow > thead{display:table-header-group}
    table.zone-flow > tbody{display:table-row-group}
    table.zone-flow > thead > tr > th.zone-flow-head{
      border:0;padding:0 0 2mm;background:transparent
    }
    table.zone-flow > tbody > tr > td.zone-flow-cell{
      border:0;padding:0;background:transparent
    }
    .zone-table{
      width:100%;
      height:auto;
      margin:0 0 2mm;
      table-layout:fixed;
      border-collapse:collapse;
      break-inside:auto;
      page-break-inside:auto;
    }
    .zone-table thead{display:table-header-group}
    .zone-table thead th{padding:1.5mm 2mm;vertical-align:middle}
    .zone-table td{
      padding:1.5mm 2mm;
      vertical-align:top;
    }
    .zone-table th.col-idx,
    .zone-table td.col-idx{
      text-align:center !important;
      vertical-align:middle;
    }
    .zone-table tr{break-inside:avoid;page-break-inside:avoid}
    /* 지도는 한 덩어리 — 다음 페이지로 넘어가도 thead h2가 위에 붙음 */
    .zone-flow-map{
      break-inside:avoid;
      page-break-inside:avoid;
    }
    .zone-map-section{
      margin:0;
      width:100%;
    }
    .zone-map{
      display:block;
      box-sizing:border-box;
      width:100%;
      height:auto;
      max-height:none;
      object-fit:contain;
      object-position:center;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    .zone-map-empty{
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      box-sizing:border-box;
      width:100%;
      min-height:40mm;
      height:auto;
      break-inside:avoid;
      page-break-inside:avoid;
    }
  }
</style>
</head>
<body>
  <div class="report-layout">
    ${zoneNavHtml}
    <div class="report-main">
      ${zoneBlocks}
    </div>
  </div>
  <script>
  (function () {
    var nav = document.querySelector('.zone-nav-inner');
    var main = document.querySelector('.report-main');
    if (!nav || !main) return;
    var items = Array.prototype.slice.call(nav.querySelectorAll('.zone-nav-item'));
    var sections = items
      .map(function (btn) {
        return document.getElementById(btn.getAttribute('data-zone-id') || '');
      })
      .filter(Boolean);
    var lockUntil = 0;
    function setActive(id) {
      items.forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-zone-id') === id);
      });
    }
    /** 스크롤 컨테이너 상단에 가장 가까운(이미 지나간) 구역을 활성으로 */
    function syncActiveFromScroll() {
      if (Date.now() < lockUntil) return;
      var mainTop = main.getBoundingClientRect().top;
      var marker = mainTop + 12;
      var activeId = sections[0] && sections[0].id;
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i];
        if (sec.getBoundingClientRect().top <= marker) activeId = sec.id;
      }
      if (activeId) setActive(activeId);
    }
    items.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-zone-id');
        var el = id ? document.getElementById(id) : null;
        if (!el) return;
        setActive(id);
        lockUntil = Date.now() + 800;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    if (items.length) setActive(items[0].getAttribute('data-zone-id'));
    main.addEventListener('scroll', syncActiveFromScroll, { passive: true });
  })();
  </script>
</body>
</html>`
}
