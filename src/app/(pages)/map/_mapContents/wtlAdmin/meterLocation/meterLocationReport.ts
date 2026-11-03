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

/**
 * 계량기위치 보고서 HTML — roadNetwork 상세보고서 헤더 양식 참고.
 */
export function buildMeterLocationReportHtml(args: {
  zones: MeterReportZoneRow[]
  parcelCount: number
  meterCount: number
}): string {
  const now = formatReportDateTime()
  const title = '계량기위치 보고서'
  const bodyRows = args.zones
    .map((z) => {
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
      return `<tr>
        <td class="zone-cell">${esc(z.zoneLabel)}</td>
        <td>${metersHtml}</td>
        <td class="map-cell">${mapHtml}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:12px;color:#222;margin:20px 24px;line-height:1.45}
  .doc-head{border-bottom:2px solid #1e293b;padding-bottom:10px;margin-bottom:14px}
  .doc-head h1{font-size:18px;margin:0 0 6px;letter-spacing:-0.02em}
  .meta-row{display:flex;flex-wrap:wrap;gap:8px 18px;color:#475569;font-size:11px}
  .summary{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
  .summary span{border:1px solid #cbd5e1;background:#f8fafc;border-radius:4px;padding:4px 10px;font-size:11px}
  h2{font-size:13px;margin:18px 0 8px;padding:4px 8px;background:#f1f5f9;border-left:3px solid #334155}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  th,td{border:1px solid #94a3b8;padding:5px 7px;text-align:left;vertical-align:top}
  table.list th{background:#e2e8f0;font-weight:600;text-align:center}
  table.list td{font-size:11px}
  .zone-cell{width:12%;font-weight:600;white-space:nowrap}
  .map-cell{width:42%}
  .meter-list{margin:0;padding-left:16px}
  .meter-list li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin:3px 0}
  .meter-no{font-weight:600;color:#0f172a;white-space:nowrap}
  .meter-addr{color:#64748b;font-size:10px;line-height:1.35;min-width:0}
  .zone-map{display:block;width:100%;max-height:220px;object-fit:cover;border:1px solid #cbd5e1;background:#e2e8f0}
  .zone-map-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:120px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;text-align:center;padding:8px;font-weight:600}
  .fail-reason{display:block;margin-top:4px;font-size:10px;font-weight:400;color:#64748b}
  .foot{margin-top:14px;font-size:10px;color:#64748b}
  @media print{
    body{margin:12px}
    tr{break-inside:avoid}
    h2{break-after:avoid}
    .zone-map{max-height:180px}
  }
</style>
</head>
<body>
  <div class="doc-head">
    <h1>${esc(title)}</h1>
    <div class="meta-row">
      <span>계량기위치 · 구역별 목록</span>
      <span>작성일시 ${esc(now)}</span>
    </div>
  </div>

  <div class="summary">
    <span>구역 ${args.zones.length}건</span>
    <span>계량기 ${args.meterCount}건</span>
    <span>필지 ${args.parcelCount}건</span>
  </div>

  <h2>1. 구역·계량기·지도</h2>
  <table class="list">
    <thead>
      <tr>
        <th style="width:12%">구역</th>
        <th style="width:46%">계량기 목록</th>
        <th style="width:42%">지도</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || `<tr><td colspan="3" style="text-align:center;color:#64748b">표시할 구역이 없습니다.</td></tr>`}
    </tbody>
  </table>

  <p class="foot">본 보고서는 계량기위치 목록을 바탕으로 작성되었습니다. 인쇄 시 PDF로 저장할 수 있습니다.</p>
</body>
</html>`
}
