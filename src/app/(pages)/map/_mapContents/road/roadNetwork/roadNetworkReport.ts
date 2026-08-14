import {
  type RoadNetworkAttachment,
  type RoadNetworkRow,
} from "./roadNetworkMock";
import { formatRoadNetworkNumericAttr } from "./roadNetworkFormat";

function esc(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safePreviewSrc(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return null;
}

function formatReportDateTime(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function attachmentReportBlock(list: RoadNetworkAttachment[], emptyText: string): string {
  if (list.length === 0) return `<p class='empty'>${esc(emptyText)}</p>`;
  /** 이미지·PDF만 썸네일. zip 등 기타는 파일명 목록만 (빈 박스 의미 없음) */
  const visual = list.filter(
    (a) => a.previewKind === "image" || a.previewKind === "pdf"
  );
  const others = list.filter(
    (a) => a.previewKind !== "image" && a.previewKind !== "pdf"
  );
  const cards = visual
    .map((a) => {
      const src = safePreviewSrc(a.previewUrl);
      const thumb =
        src && a.previewKind === "image"
          ? `<img src="${src}" alt="${esc(a.name)}" />`
          : `<div class='ph'>PDF</div>`;
      return `<div class='att-card'>${thumb}<div class='att-name'>${esc(a.name)}</div><div class='meta'>${esc(a.sizeLabel)} · ${esc(a.uploadedAt)}</div></div>`;
    })
    .join("");
  const otherList =
    others.length === 0
      ? ""
      : `<ul class='att-files'>${others
          .map(
            (a) =>
              `<li>${esc(a.name)} <span class='meta'>(${esc(a.sizeLabel)} · ${esc(a.uploadedAt)})</span></li>`
          )
          .join("")}</ul>`;
  if (!cards && !otherList) return `<p class='empty'>${esc(emptyText)}</p>`;
  return `${cards ? `<div class='att-grid'>${cards}</div>` : ""}${otherList}`;
}

function attrTwoColTable(row: RoadNetworkRow): string {
  const pairs: [string, string][] = [
    ["도로명", row.roadName || "—"],
    ["도로종류", row.roadType],
    ["개설여부", row.openStatus ?? "—"],
    ["도로번호", row.roadNo || "—"],
  ];
  if (row.dept?.trim()) pairs.push(["관리기관", row.dept]);
  if (row.lengthAttr?.trim()) pairs.push(["길이", row.lengthAttr]);
  if (row.defense?.trim()) pairs.push(["방위", row.defense]);
  if (row.sinuosity?.trim()) {
    const s = formatRoadNetworkNumericAttr(row.sinuosity);
    if (s) pairs.push(["굴곡도", s]);
  }
  if (row.detailReason?.trim()) pairs.push(["상세", row.detailReason]);
  if (row.address?.trim()) pairs.push(["주소", row.address]);
  const rowsHtml: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const left = pairs[i]!;
    const right = pairs[i + 1];
    if (right) {
      rowsHtml.push(
        `<tr><th>${esc(left[0])}</th><td>${esc(left[1])}</td><th>${esc(right[0])}</th><td>${esc(right[1])}</td></tr>`
      );
    } else {
      rowsHtml.push(
        `<tr><th>${esc(left[0])}</th><td colspan="3">${esc(left[1])}</td></tr>`
      );
    }
  }
  return `<table class='attr'>${rowsHtml.join("")}</table>`;
}

function siteLabel(address: string | undefined, hasPoint: boolean): string {
  if (address?.trim()) return address.trim();
  return hasPoint ? "위치만 지정" : "미지정";
}

/** 상세 보고서 HTML — 업무용 상세보고서 양식 */
export function buildRoadNetworkReportHtml(row: RoadNetworkRow): string {
  const now = formatReportDateTime();
  const title = `${row.roadName} 도로망도 상세보고서`;
  const openComplaints = row.complaints.filter((c) => c.state !== "완료").length;

  const maintHtml =
    row.maintenance.length === 0
      ? "<p class='empty'>유지보수 이력이 없습니다.</p>"
      : `<table class='list'><thead><tr><th style="width:12%">일자</th><th style="width:12%">유형</th><th>내용</th><th style="width:14%">시공</th><th style="width:22%">현장</th><th style="width:8%">첨부</th></tr></thead><tbody>${row.maintenance
          .map(
            (m) =>
              `<tr><td>${esc(m.date)}</td><td>${esc(m.workType)}</td><td>${esc(m.content)}</td><td>${esc(m.contractor || "—")}</td><td>${esc(siteLabel(m.siteAddress, !!m.point))}</td><td>${esc(String((m.attachments ?? []).length))}건</td></tr>`
          )
          .join("")}</tbody></table>`;

  const compHtml =
    row.complaints.length === 0
      ? "<p class='empty'>관련 민원이 없습니다.</p>"
      : `<table class='list'><thead><tr><th style="width:9%">상태</th><th style="width:11%">접수일</th><th style="width:10%">신청인</th><th>내용</th><th style="width:22%">현장</th><th style="width:7%">첨부</th></tr></thead><tbody>${row.complaints
          .map(
            (c) =>
              `<tr><td>${esc(c.state)}</td><td>${esc(c.date)}</td><td>${esc(c.name || "—")}</td><td>${esc(c.content)}</td><td>${esc(siteLabel(c.address, !!c.point))}</td><td>${esc(String((c.attachments ?? []).length))}건</td></tr>`
          )
          .join("")}</tbody></table>`;

  const histHtml =
    row.history.length === 0
      ? "<p class='empty'>수정이력이 없습니다.</p>"
      : `<table class='list'><thead><tr><th style="width:22%">일시</th><th style="width:12%">작업자</th><th style="width:14%">구분</th><th>내용</th></tr></thead><tbody>${row.history
          .map(
            (h) =>
              `<tr><td>${esc(h.at)}</td><td>${esc(h.user)}</td><td>${esc(h.action)}</td><td>${esc(h.detail)}</td></tr>`
          )
          .join("")}</tbody></table>`;

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
  table.attr th{background:#e2e8f0;width:12%;font-weight:600;white-space:nowrap}
  table.attr td{width:38%}
  table.list th{background:#e2e8f0;font-weight:600;text-align:center}
  table.list td{font-size:11px}
  .empty{color:#64748b;margin:4px 0 8px}
  .meta{color:#64748b;font-size:10px}
  .att-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:8px}
  .att-card{border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;background:#f8fafc}
  .att-card img,.att-card .ph{display:block;width:100%;height:220px;object-fit:cover;background:#e2e8f0}
  .att-card .ph{display:flex;align-items:center;justify-content:center;font-size:16px;color:#64748b;font-weight:600}
  .att-name{padding:10px 12px 2px;font-size:12px;word-break:break-all}
  .att-card .meta{padding:0 12px 10px}
  .att-files{margin:8px 0 0;padding-left:18px;font-size:11px}
  .att-files li{margin:2px 0}
  .foot{margin-top:14px;font-size:10px;color:#64748b}
  @media print{body{margin:12px} .att-card{break-inside:avoid} h2{break-after:avoid}}
</style>
</head>
<body>
  <div class="doc-head">
    <h1>${esc(title)}</h1>
    <div class="meta-row">
      <span>${esc(row.roadType)} · 도로번호 ${esc(row.roadNo || "—")}</span>
      <span>관리기관 ${esc(row.dept || "—")} / ${esc(row.manager || "—")}</span>
      <span>작성일시 ${esc(now)}</span>
    </div>
  </div>

  <div class="summary">
    <span>유지보수 ${row.maintenance.length}건</span>
    <span>민원 ${row.complaints.length}건 (미완료 ${openComplaints})</span>
    <span>첨부 ${row.attachments.length}건</span>
    <span>이력 ${row.history.length}건</span>
  </div>

  <h2>1. 도로 현황</h2>
  ${attrTwoColTable(row)}

  <h2>2. 유지보수 현황 (${row.maintenance.length})</h2>
  ${maintHtml}

  <h2>3. 민원 현황 (${row.complaints.length})</h2>
  ${compHtml}

  <h2>4. 첨부파일 (${row.attachments.length})</h2>
  ${attachmentReportBlock(row.attachments, "도로 공통 첨부가 없습니다.")}

  <h2>5. 수정이력 (${row.history.length})</h2>
  ${histHtml}

  <p class="foot">본 보고서는 도로망도 상세 자료를 바탕으로 작성되었습니다. 인쇄 시 PDF로 저장할 수 있습니다.</p>
</body>
</html>`;
}
