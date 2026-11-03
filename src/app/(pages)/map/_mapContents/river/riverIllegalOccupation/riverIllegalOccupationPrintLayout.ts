/**
 * 불법점용 관리카드 인쇄·PDF 공통 HTML/CSS (서버·클라이언트 공용, DOM API 없음)
 */
import {
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
} from "./riverIllegalOccupationConfig";
import {
  riverIllegalStatusTotalMarked,
  splitRiverIllegalLines,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationModel";
import {
  formatRiverIllegalCardDate,
  parseRiverIllegalRedMarkup,
  riverIllegalRedMarkupToHtml,
  splitRiverIllegalKindLabel,
} from "./riverIllegalOccupationFormat";

function esc(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tx(v: string | null | undefined, empty = "") {
  const s = String(v ?? "").trim();
  return s ? esc(s) : empty;
}

function lines(value: string, bullet: boolean) {
  const rows = splitRiverIllegalLines(value);
  if (rows.length === 0) return "";
  return rows
    .map((l) => {
      const hasRed = parseRiverIllegalRedMarkup(l).some((p) => p.red);
      const tip = bullet
        ? hasRed
          ? `<span class="rio-red">▸ </span>`
          : "▸ "
        : "";
      return `<div class="ln">${tip}${riverIllegalRedMarkupToHtml(l)}</div>`;
    })
    .join("");
}

function photo(src: string) {
  return src ? `<img src="${esc(src)}" alt="" />` : "";
}

function statusHtml(card: RiverIllegalOccupationCard) {
  const head = RIVER_ILLEGAL_STATUS_KINDS.map(
    (k) => `<th>${splitRiverIllegalKindLabel(k.label).map(esc).join("<br/>")}</th>`
  ).join("");
  const body = RIVER_ILLEGAL_STATUS_ROWS.map((row) => {
    const totShown = riverIllegalStatusTotalMarked(card.status, row.key);
    const cells = RIVER_ILLEGAL_STATUS_KINDS.map((k) => {
      const raw = card.status[k.key]?.[row.key] ?? "";
      const s = String(raw).trim();
      return `<td>${s ? riverIllegalRedMarkupToHtml(s) : ""}</td>`;
    }).join("");
    const totalCell = totShown
      ? `<td>${riverIllegalRedMarkupToHtml(totShown)}</td>`
      : "<td></td>";
    return `<tr><th>${esc(row.label)}</th>${totalCell}${cells}</tr>`;
  }).join("");
  return `<table class="st"><tr><th>구분</th><th>합계</th>${head}</tr>${body}</table>`;
}

/** 인쇄 미리보기·Chromium PDF 공통 서식 */
export function riverIllegalPrintCss(): string {
  return `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: "Malgun Gothic", "맑은 고딕", sans-serif;
    color: #000;
    font-size: 10.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    padding: 12mm;
    background: #fff;
    page-break-after: always;
    break-after: page;
  }
  .sheet:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  h1 {
    margin: 0 0 4mm;
    text-align: center;
    font-size: 19pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .f > tbody > tr > th,
  .f > tbody > tr > td {
    border: 1px solid #000;
    padding: 1.6mm 2mm;
    vertical-align: middle;
  }
  .f > tbody > tr > th {
    padding: 1.6mm 1mm;
    font-size: 10pt;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    background: #fff;
  }
  .f > tbody > tr > td.c { text-align: center; }
  .f > tbody > tr > td.p0 { padding: 0; }
  .split { display: flex; align-items: stretch; min-height: 7mm; }
  .split .grow { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1.2mm 2mm; }
  .split .yn { width: 12mm; display: flex; align-items: center; justify-content: center; border-left: 1px solid #000; font-weight: 600; }
  .split .subth {
    width: 18mm; display: flex; align-items: center; justify-content: center;
    border-right: 1px solid #000; background: #fff; font-weight: 600; font-size: 10pt; white-space: nowrap;
  }
  .ln + .ln { margin-top: 0.6mm; }
  .st th, .st td {
    border: 1px solid #666;
    padding: 0.6mm 0.3mm;
    text-align: center;
    font-size: 7.5pt;
    line-height: 1.15;
  }
  .st th { font-weight: 600; background: #f3f3f3; }
  .st td { height: 4.6mm; }
  .ph td { border: 1px solid #000; text-align: center; }
  .ph td.box { height: 62mm; padding: 1.5mm; }
  .ph td.box img { display: block; width: 100%; height: 59mm; object-fit: cover; }
  .ph td.cap { height: 7mm; letter-spacing: 1px; }
  .ph { margin-top: -1px; }
  .rio-red { color: #dc2626; font-weight: inherit; }
`;
}

export function riverIllegalPrintBodyHtml(card: RiverIllegalOccupationCard): string {
  const row1 = (label: string, value: string, cls = "") =>
    `<tr><th>${label}</th><td colspan="3" class="${cls}">${value}</td></tr>`;
  return `
<h1>하천·계곡 구역 내 불법 점용시설 관리카드</h1>
<table class="f">
  <colgroup><col style="width:29mm" /><col /><col style="width:29mm" /><col style="width:38%" /></colgroup>
  <tbody>
    <tr><th>연 번</th><td class="c">${tx(card.serialNo)}</td><th>하천구분</th><td class="c">${tx(card.riverType)}</td></tr>
    <tr>
      <th>최초 확인일자</th><td class="c">${tx(formatRiverIllegalCardDate(card.firstCheckYmd))}</td>
      <th>완료(예정)일자</th>
      <td class="p0"><div class="split"><div class="c grow">${tx(formatRiverIllegalCardDate(card.completeYmd), "-")}</div><div class="c yn">${card.completeYn === "Y" ? "완료" : ""}</div></div></td>
    </tr>
    <tr>
      <th>위 치</th><td colspan="2">${tx(card.location)}</td>
      <td class="p0"><div class="split"><div class="subth">재발여부</div><div class="c grow">${tx(card.recurrence)}</div></div></td>
    </tr>
    ${row1("행 위 자", lines(card.actor, false))}
    ${row1("조치현황", statusHtml(card))}
    ${row1("위법내용", lines(card.violation, true))}
    ${row1("관 련 법", lines(card.relatedLaw, true))}
    ${row1("조치내용", lines(card.actionContent, true))}
    ${row1("조치계획", lines(card.actionPlan, true))}
    ${row1("관리책임자", lines(card.manager, true))}
  </tbody>
</table>
<table class="ph">
  <colgroup><col /><col /></colgroup>
  <tr><td class="box">${photo(card.locationMapUrl)}</td><td class="box">${photo(card.photo1Url)}</td></tr>
  <tr><td class="cap">&lt;위 치 도&gt;</td><td class="cap">&lt;현황사진&gt;</td></tr>
  <tr><td class="box">${photo(card.photo2Url)}</td><td class="box">${photo(card.completePhotoUrl)}</td></tr>
  <tr><td class="cap">&lt;현황사진&gt;</td><td class="cap">&lt;완료사진&gt;</td></tr>
</table>`;
}

export function riverIllegalPrintDocTitle(card: RiverIllegalOccupationCard): string {
  return ["불법 점용시설 관리카드", String(card.serialNo ?? "").trim()]
    .filter(Boolean)
    .join("_")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function riverIllegalPrintAllCardsDocTitle(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `불법 점용시설 관리카드_전체_${ymd}`;
}

export function riverIllegalOccupationPrintHtml(card: RiverIllegalOccupationCard, docTitle: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>
<style>${riverIllegalPrintCss()}</style></head><body>
<div class="sheet">${riverIllegalPrintBodyHtml(card)}</div>
</body></html>`;
}

export function riverIllegalOccupationPrintHtmlMany(
  cards: RiverIllegalOccupationCard[],
  docTitle: string
) {
  const sheets = cards.map((c) => `<div class="sheet">${riverIllegalPrintBodyHtml(c)}</div>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>
<style>${riverIllegalPrintCss()}</style></head><body>
${sheets}
</body></html>`;
}
