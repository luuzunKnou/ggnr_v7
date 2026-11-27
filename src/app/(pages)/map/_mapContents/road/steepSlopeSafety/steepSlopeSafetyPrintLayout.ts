/**
 * 급경사지 안전점검표 인쇄·PDF
 * — ［붙임1］급경사지 안전점검 체크리스트 (서식1 169~) 한글 원본 레이아웃
 */
import {
  STEEP_SLOPE_ATTACHMENT_MAX,
  STEEP_SLOPE_CHECK_GROUPS,
  STEEP_SLOPE_CHECK_VALUE_LABEL,
  type SteepSlopeCheckValue,
} from "./steepSlopeSafetyConfig";
import {
  formatSteepSlopeSpec,
  steepSlopeAttachmentCaption,
  type SteepSlopeSafetyCard,
} from "./steepSlopeSafetyMock";

function esc(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tx(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s ? esc(s) : "";
}

/** 한글 서식: 2026.  8.  25. */
function formatInspectYmdHangul(ymd: string): string {
  const m = String(ymd ?? "")
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return tx(ymd);
  return `${m[1]}.  ${String(Number(m[2]))}.  ${String(Number(m[3]))}.`;
}

function box(v: SteepSlopeCheckValue, want: Exclude<SteepSlopeCheckValue, "">) {
  return v === want ? "☑" : "□";
}

type PrintBand = {
  band: string;
  groupKeys: readonly string[];
  showGroupTitle: boolean;
};

/** 한글 원본 구간 배치 */
const PRINT_BANDS: readonly PrintBand[] = [
  {
    band: "인공 비탈면",
    groupKeys: ["surround", "slope"],
    showGroupTitle: true,
  },
  {
    band: "비탈면 시설물<br/>(옹벽, 낙석방지책 등)",
    groupKeys: ["facility"],
    showGroupTitle: false,
  },
  {
    band: "기 타",
    groupKeys: ["sign", "alert"],
    showGroupTitle: true,
  },
];

function groupByKey(key: string) {
  return STEEP_SLOPE_CHECK_GROUPS.find((g) => g.key === key);
}

function checkRowsHtml(card: SteepSlopeSafetyCard): string {
  const blocks: string[] = [];
  for (const band of PRINT_BANDS) {
    blocks.push(
      `<tr class="band">
        <td class="band-q">${band.band}</td>
        <td class="band-c"></td>
        <td class="band-c"></td>
        <td class="band-c"></td>
        <td class="band-note"></td>
      </tr>`
    );
    for (const gk of band.groupKeys) {
      const g = groupByKey(gk);
      if (!g) continue;
      if (band.showGroupTitle) {
        blocks.push(
          `<tr class="sub">
            <td class="q">○ ${esc(g.title)}</td>
            <td class="c"></td>
            <td class="c"></td>
            <td class="c"></td>
            <td class="note"></td>
          </tr>`
        );
      }
      g.items.forEach((it, i) => {
        const row = card.checks[it.key] ?? { value: "" as const, note: "" };
        blocks.push(`<tr class="item">
        <td class="q"><span class="num">${i + 1}.</span> ${esc(it.label)}</td>
        <td class="c">${box(row.value, "yes")}</td>
        <td class="c">${box(row.value, "no")}</td>
        <td class="c">${box(row.value, "na")}</td>
        <td class="note">${tx(row.note)}</td>
      </tr>`);
      });
    }
  }
  // 한글 원본: 점검표 마지막 행 = 【 기타 의견 】
  blocks.push(
    `<tr class="opinion-row">
      <td colspan="5">
        <div class="opinion-label">【&nbsp;기타 의견&nbsp;】</div>
        <div class="opinion-body">${tx(card.otherOpinion) || "&nbsp;"}</div>
      </td>
    </tr>`
  );
  return blocks.join("");
}

function photoCell(label: string, url: string): string {
  const img = url.trim()
    ? `<img src="${esc(url)}" alt="" />`
    : `<div class="ph-empty"></div>`;
  return `<td class="ph">
    <div class="ph-box">${img}</div>
    <div class="ph-cap">${esc(label)}</div>
  </td>`;
}

function emptyPhotoCell(): string {
  return `<td class="ph"><div class="ph-box"><div class="ph-empty"></div></div><div class="ph-cap">&nbsp;</div></td>`;
}

function photoCellFull(label: string, url: string): string {
  const img = url.trim()
    ? `<img src="${esc(url)}" alt="" />`
    : `<div class="ph-empty"></div>`;
  return `<td class="ph ph-full" colspan="2">
    <div class="ph-box ph-box-full">${img}</div>
    <div class="ph-cap">${esc(label)}</div>
  </td>`;
}

/**
 * 한글 원본 배치:
 * - 시설물 전경 2장: 위·아래 전폭
 * - 시점부·종점부: 좌·우 칸 유지
 * - 첨부(최대 6): 2열
 */
function photosTableHtml(card: SteepSlopeSafetyCard): string {
  const photos = card.photos ?? [];
  const o1 = photos[0];
  const o2 = photos[1];
  const start = photos[2];
  const end = photos[3];
  const facilityRows = `<tr>
    ${photoCellFull(o1?.label || "시설물 전경", o1?.url ?? "")}
  </tr>
  <tr>
    ${photoCellFull(o2?.label || "시설물 전경", o2?.url ?? "")}
  </tr>`;
  const endpointRows = `<tr>
    ${photoCell(start?.label || "시점부 전경", start?.url ?? "")}
    ${photoCell(end?.label || "종점부 전경", end?.url ?? "")}
  </tr>`;

  const atts = (card.attachments ?? [])
    .filter((a) => String(a.url ?? "").trim())
    .slice(0, STEEP_SLOPE_ATTACHMENT_MAX);

  const attachRows: string[] = [];
  for (let i = 0; i < atts.length; i += 2) {
    const a = atts[i]!;
    const b = atts[i + 1];
    attachRows.push(`<tr>
      ${photoCell(steepSlopeAttachmentCaption(a), a.url)}
      ${
        b
          ? photoCell(steepSlopeAttachmentCaption(b), b.url)
          : emptyPhotoCell()
      }
    </tr>`);
  }

  const attachTable = attachRows.length
    ? `<table class="photos photos-attach">${attachRows.join("")}</table>`
    : "";

  return `<table class="photos photos-facility">${facilityRows}</table>
  <table class="photos photos-endpoint">${endpointRows}</table>
  ${attachTable}`;
}

export function steepSlopeSafetyPrintCss(): string {
  return `
  @page { size: A4 portrait; margin: 15mm 20mm 10mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
    color: #000;
    font-size: 9.5pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { width: 100%; }
  .sheet-page {
    width: 100%;
    page-break-after: always;
    break-after: page;
  }
  .sheet-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  /* 제목 배너 — 원본: 진한청록 연번 | 구분 | 지구명+점검표 */
  table.title-banner {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0 0 2.5mm;
  }
  table.title-banner td {
    vertical-align: middle;
    padding: 0;
    height: 11mm;
  }
  table.title-banner td.serial {
    width: 14%;
    background: #02405B !important;
    border: 1px solid #02405B;
    color: #fff !important;
    text-align: center;
    font-family: "HY헤드라인M", "HYHeadLine", "Malgun Gothic", "맑은 고딕", sans-serif;
    font-size: 16pt;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  table.title-banner td.gap {
    width: 1.6%;
    border-top: none;
    border-bottom: none;
    border-left: 1px solid #02405B;
    border-right: 1px solid #999;
    background: #fff;
  }
  table.title-banner td.headline {
    width: auto;
    border: 1px solid #999;
    padding: 0 3mm;
    text-align: left;
    font-size: 15pt;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
  }
  table.title-banner td.headline .site-name {
    font-family: "Malgun Gothic", "맑은 고딕", sans-serif;
    font-weight: 600;
  }
  table.title-banner td.headline .doc-name {
    font-family: "HY헤드라인M", "HYHeadLine", "Malgun Gothic", "맑은 고딕", sans-serif;
    font-weight: 800;
  }
  table.meta, table.chk, table.photos {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.meta { margin-bottom: 2mm; }
  table.meta th, table.meta td {
    border: 1px solid #000;
    padding: 1.3mm 1.6mm;
    vertical-align: middle;
    font-size: 9.5pt;
  }
  table.meta th {
    width: 14%;
    font-weight: 700;
    text-align: center;
    background: #fff;
    white-space: nowrap;
  }
  table.meta td.v { width: 28%; }
  table.chk { margin-bottom: 0; }
  table.chk th, table.chk td {
    border: 1px solid #000;
    padding: 0.9mm 1.1mm;
    vertical-align: middle;
    font-size: 8.5pt;
  }
  table.chk thead th {
    font-weight: 700;
    text-align: center;
    background: #F2F2F2 !important;
    line-height: 1.25;
  }
  table.chk thead .h-item { width: 46%; }
  table.chk thead .h-c { width: 7.5%; }
  table.chk thead .h-note { width: 24%; }
  /* 인공 비탈면 · 비탈면 시설물 · 기 타 — 원본 #FAF3DB */
  table.chk tr.band td {
    background: #FAF3DB !important;
    font-weight: 800;
    letter-spacing: 1px;
  }
  table.chk tr.band td.band-q { text-align: center; }
  table.chk tr.sub td {
    font-weight: 700;
    text-align: left;
    background: #fff;
  }
  table.chk td.q { text-align: left; line-height: 1.3; }
  table.chk td.q .num { font-weight: 700; margin-right: 1px; }
  table.chk td.c {
    text-align: center;
    font-size: 11pt;
    font-weight: 700;
    line-height: 1;
  }
  table.chk td.note { text-align: left; font-size: 8.5pt; }
  table.chk tr.opinion-row td {
    vertical-align: top;
    background: #fff;
    padding: 1.5mm 2mm 2mm;
  }
  .opinion-label {
    font-weight: 800;
    font-size: 10pt;
    margin: 0 0 1mm;
  }
  .opinion-body {
    min-height: 8mm;
    font-size: 9pt;
    line-height: 1.4;
    white-space: pre-wrap;
  }
  .foot {
    font-size: 9pt;
    margin: 1.5mm 0 2.5mm;
    line-height: 1.45;
  }
  .foot .em { font-weight: 800; }
  .result-label {
    font-weight: 800;
    margin: 0 0 1.5mm;
    font-size: 10pt;
  }
  table.photos { margin-top: 0; }
  table.photos-attach { margin-top: 0; }
  table.photos td.ph {
    border: 1px solid #000;
    padding: 1.5mm;
    width: 50%;
    vertical-align: top;
  }
  .ph-box {
    height: 40mm;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    overflow: hidden;
  }
  /* 시설물 전경 — 위·아래 전폭 */
  table.photos-facility .ph-box-full { height: 48mm; }
  table.photos-endpoint .ph-box { height: 42mm; }
  table.photos-attach .ph-box { height: 36mm; }
  .ph-box img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .ph-empty { width: 100%; height: 100%; }
  .ph-cap {
    text-align: center;
    margin-top: 1mm;
    font-size: 9pt;
    font-weight: 600;
  }
  `;
}

function titleBannerHtml(serial: string, site: string): string {
  return `<table class="title-banner">
    <tr>
      <td class="serial">${serial}</td>
      <td class="gap"></td>
      <td class="headline">
        <span class="site-name">${site || "&nbsp;"}</span>
        <span class="doc-name"> 급경사지 안전점검표</span>
      </td>
    </tr>
  </table>`;
}

export function steepSlopeSafetyPrintHtml(card: SteepSlopeSafetyCard): string {
  const inspectors = card.inspectors
    .map(
      (p) =>
        `(소속) ${tx(p.org) || "—"}  (직위) ${tx(p.title) || "—"}  (성명) ${tx(p.name) || "—"}`
    )
    .join("<br/>");
  const serial = tx(card.serialNo) || "&nbsp;";
  const site = tx(card.siteName) || "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(
    steepSlopeSafetyPrintDocTitle(card)
  )}</title><style>${steepSlopeSafetyPrintCss()}</style></head><body>
  <div class="sheet">
  <div class="sheet-page">
  ${titleBannerHtml(serial, site)}
  <table class="meta">
    <tr>
      <th>점검일시</th><td class="v">${formatInspectYmdHangul(card.inspectYmd)}</td>
      <th>급경사지명</th><td class="v">${site || "&nbsp;"}</td>
    </tr>
    <tr>
      <th>분 류</th><td class="v">${tx(card.category)}</td>
      <th>제 원</th><td class="v">${esc(formatSteepSlopeSpec(card))}</td>
    </tr>
    <tr>
      <th>점검장소</th><td class="wide" colspan="3">${tx(card.address)}</td>
    </tr>
    <tr>
      <th>점검자</th><td class="wide" colspan="3">${inspectors || "—"}</td>
    </tr>
  </table>
  <table class="chk">
    <thead>
      <tr>
        <th class="h-item" rowspan="2">세 부 점 검 사 항</th>
        <th colspan="4">점 검 결 과<br/><span style="font-weight:600;font-size:8pt">(해당란에 ✔체크)</span></th>
      </tr>
      <tr>
        <th class="h-c">있음</th>
        <th class="h-c">없음</th>
        <th class="h-c">해당<br/>없음</th>
        <th class="h-note">세부내용<br/>(위치, 상태 등)<br/>및 조치계획</th>
      </tr>
    </thead>
    <tbody>${checkRowsHtml(card)}</tbody>
  </table>
  <div class="foot">※&nbsp;주요 구조부의 균열 등 <span class="em">중대 결함</span>이 발견된 경우 민간전문가 및 점검장비를 활용하여 확인점검 실시</div>
  </div>
  <div class="sheet-page">
  <div class="result-label">□ 점검 결과</div>
  ${photosTableHtml(card)}
  </div>
  </div>
  </body></html>`;
}

export function steepSlopeSafetyPrintDocTitle(card: SteepSlopeSafetyCard): string {
  const name = card.siteName.trim() || "급경사지";
  const no = card.serialNo.trim();
  return no ? `급경사지_안전점검표_${no}_${name}` : `급경사지_안전점검표_${name}`;
}

export { STEEP_SLOPE_CHECK_VALUE_LABEL };
