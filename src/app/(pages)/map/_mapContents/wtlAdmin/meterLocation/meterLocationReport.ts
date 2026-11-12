export type MeterReportMeterLine = {
  meterNo: string
  address: string
}

export type MeterReportZoneRow = {
  zoneLabel: string
  meters: MeterReportMeterLine[]
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

function zoneTableHtml(z: MeterReportZoneRow): string {
  const metersHtml =
    z.meters.length === 0
      ? '—'
      : `<ul class="meter-list">${z.meters
          .map((m) => {
            const no = esc(m.meterNo)
            const addr = String(m.address ?? '').trim()
            return addr
              ? `<li><span class="meter-no">${no}</span><span class="meter-addr">${esc(addr)}</span></li>`
              : `<li><span class="meter-no">${no}</span></li>`
          })
          .join('')}</ul>`
  const captureFailed = z.mapCaptureStatus === 'failed' || !z.mapDataUrl
  const failReason = (z.mapCaptureReason ?? '').trim()
  const mapHtml = z.mapDataUrl
    ? `<img class="zone-map" src="${z.mapDataUrl}" alt="${esc(z.zoneLabel)} 지도" />`
    : `<div class="zone-map-empty">${
        captureFailed
          ? `캡처 실패${failReason ? `<br/><span class="fail-reason">${esc(failReason)}</span>` : ''}`
          : '지도 없음'
      }</div>`
  return `<table class="list zone-table">
    <thead>
      <tr>
        <th class="col-zone">구역</th>
        <th class="col-meters">계량기 목록</th>
        <th class="col-map">지도</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="zone-cell">${esc(z.zoneLabel)}</td>
        <td class="meters-cell">${metersHtml}</td>
        <td class="map-cell">${mapHtml}</td>
      </tr>
    </tbody>
  </table>`
}

/**
 * 계량기위치 보고서 HTML — A4 가로 전제.
 * 인쇄 시 제목·요약 유지. 구역마다 표 1개·1페이지. 구역 제목(h2) 없음.
 */
export function buildMeterLocationReportHtml(args: {
  zones: MeterReportZoneRow[]
  parcelCount: number
  meterCount: number
}): string {
  const now = formatReportDateTime()
  const title = '계량기위치 보고서'
  const headHtml = `<div class="doc-head">
    <h1>${esc(title)}</h1>
    <div class="meta-row">
      <span>계량기위치 · 구역별 목록 · A4 가로</span>
      <span>작성일시 ${esc(now)}</span>
    </div>
  </div>
  <div class="summary">
    <span>구역 ${args.zones.length}건</span>
    <span>계량기 ${args.meterCount}건</span>
    <span>필지 ${args.parcelCount}건</span>
  </div>`

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
            // 첫 페이지에 제목·요약을 넣어 인쇄에도 남기고, 남은 높이를 표가 채움
            return `<section class="${cls}">
  ${first ? headHtml : ''}
  <div class="zone-body">${zoneTableHtml(z)}</div>
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
    size:A4 landscape;
    margin:8mm;
  }
  :root{
    color-scheme:light;
    --rpt-bg:#ffffff;--rpt-fg:#1a1a1a;--rpt-muted:#8a8a8a;--rpt-line:#e5e5e5;
    --rpt-head:#f5f5f5;--rpt-soft:#fafafa;--rpt-strong:#1a1a1a;--rpt-accent:#334155;
    --rpt-fail-bg:#fef2f2;--rpt-fail-fg:#b91c1c;--rpt-fail-line:#fecaca;--rpt-map:#e2e8f0
  }
  html.dark{
    color-scheme:dark;
    --rpt-bg:#1a1a1a;--rpt-fg:#fafafa;--rpt-muted:#b3b3b3;--rpt-line:rgba(255,255,255,.16);
    --rpt-head:#3a3a3a;--rpt-soft:#2a2a2a;--rpt-strong:#fafafa;--rpt-accent:#8a8a8a;
    --rpt-fail-bg:#3a2424;--rpt-fail-fg:#fca5a5;--rpt-fail-line:#7f1d1d;--rpt-map:#2a2a2a
  }
  html,body{background:var(--rpt-bg);color:var(--rpt-fg)}
  body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:12px;margin:16px 20px;line-height:1.45}
  .doc-head{border-bottom:2px solid var(--rpt-strong);padding-bottom:10px;margin-bottom:12px}
  .doc-head h1{font-size:18px;margin:0 0 6px;letter-spacing:-0.02em;color:var(--rpt-fg)}
  .meta-row{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--rpt-muted);font-size:11px}
  .summary{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .summary span{border:1px solid var(--rpt-line);background:var(--rpt-soft);color:var(--rpt-fg);border-radius:4px;padding:4px 10px;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;background:var(--rpt-bg);color:var(--rpt-fg);table-layout:fixed}
  th,td{border:1px solid var(--rpt-line);padding:6px 8px;text-align:left;vertical-align:top;color:var(--rpt-fg)}
  table.list th{background:var(--rpt-head);font-weight:600;text-align:center}
  table.list td{font-size:11px}
  .col-zone,.zone-cell{width:10%;font-weight:600;white-space:nowrap}
  .col-meters,.meters-cell{width:28%}
  .col-map,.map-cell{width:62%}
  .meter-list{margin:0;padding-left:16px}
  .meter-list li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin:3px 0}
  .meter-no{font-weight:600;color:var(--rpt-strong);white-space:nowrap}
  .meter-addr{color:var(--rpt-muted);font-size:10px;line-height:1.35;min-width:0}
  .zone-map{display:block;width:100%;height:auto;max-height:none;object-fit:contain;border:1px solid var(--rpt-line);background:var(--rpt-map)}
  .zone-map-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;background:var(--rpt-fail-bg);color:var(--rpt-fail-fg);border:1px solid var(--rpt-fail-line);text-align:center;padding:8px;font-weight:600}
  .fail-reason{display:block;margin-top:4px;font-size:10px;font-weight:400;color:var(--rpt-muted)}
  .zone-empty{padding:24px;text-align:center;color:var(--rpt-muted);border:1px dashed var(--rpt-line)}
  .zone-page{margin-bottom:16px}
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
      width:100%;height:100%;margin:0;padding:0;
    }
    .foot{display:none}
    .doc-head{
      display:block;
      flex:0 0 auto;
      margin:0 0 3mm;
      padding:0 0 2mm;
      border-bottom:1.5pt solid #1a1a1a;
    }
    .doc-head h1{font-size:14pt;margin:0 0 1.5mm}
    .meta-row{font-size:9pt;gap:4px 12px}
    .summary{
      display:flex;
      flex:0 0 auto;
      gap:4px;
      margin:0 0 3mm;
    }
    .summary span{padding:1.5mm 3mm;font-size:9pt}
    .zone-page{
      box-sizing:border-box;
      width:100%;
      /* A4 landscape − @page margin 8mm×2 */
      height:194mm;
      margin:0;
      padding:0;
      overflow:hidden;
      display:flex;
      flex-direction:column;
      break-after:page;
      page-break-after:always;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    .zone-page-last{
      break-after:auto;
      page-break-after:auto;
    }
    /* flex 남은 공간을 표·지도가 채움 (1페이지 제목 아래도 동일) */
    .zone-body{
      flex:1 1 auto;
      min-height:0;
      height:0;
      display:flex;
      flex-direction:column;
    }
    .zone-table{
      width:100%;
      height:100%;
      margin:0;
      table-layout:fixed;
      border-collapse:collapse;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    .zone-table thead{height:8mm}
    .zone-table thead th{height:8mm;padding:2mm 2mm;vertical-align:middle}
    .zone-table tbody,
    .zone-table tbody tr{
      height:calc(100% - 8mm);
    }
    .zone-table td{
      height:100%;
      padding:2mm;
      vertical-align:top;
    }
    .meters-cell{overflow:hidden}
    .map-cell{
      position:relative;
      height:100%;
      padding:2mm;
    }
    .zone-map,.zone-map-empty{
      display:block;
      box-sizing:border-box;
      width:100%;
      /* 표 셀 % 높이가 브라우저마다 무시될 때 대비 — 페이지 기준 절대 높이 */
      height:178mm;
      max-height:none;
      object-fit:fill;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    /* 1페이지: 제목·요약(~26mm) + thead(8mm) 제외한 높이로 지도 채움 */
    .zone-page-first .zone-map,
    .zone-page-first .zone-map-empty{
      height:160mm;
    }
    .zone-map-empty{min-height:0}
  }
</style>
</head>
<body>
  ${zoneBlocks}

  <p class="foot">본 보고서는 A4 가로 인쇄를 전제로 합니다. 인쇄 대화상자에서 용지 방향을 가로로 선택하세요. 구역마다 한 페이지로 출력됩니다.</p>
</body>
</html>`
}
