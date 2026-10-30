import {
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
} from "./riverIllegalOccupationConfig";
import {
  riverIllegalStatusTotal,
  splitRiverIllegalLines,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import {
  formatRiverIllegalCardDate,
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

/** «@» 줄 → 줄마다 한 줄, bullet 항목은 «▸», #…# 은 빨강 */
function lines(value: string, bullet: boolean) {
  const rows = splitRiverIllegalLines(value);
  if (rows.length === 0) return "";
  return rows
    .map((l) => `<div class="ln">${bullet ? "▸ " : ""}${riverIllegalRedMarkupToHtml(l)}</div>`)
    .join("");
}

async function urlToDataUrl(src: string): Promise<string> {
  if (!src || src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { credentials: "include" });
    if (!res.ok) return src;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : src);
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

function photo(src: string) {
  return src ? `<img src="${esc(src)}" alt="" />` : "";
}

function statusHtml(card: RiverIllegalOccupationCard) {
  const head = RIVER_ILLEGAL_STATUS_KINDS.map(
    (k) => `<th>${splitRiverIllegalKindLabel(k.label).map(esc).join("<br/>")}</th>`
  ).join("");
  const body = RIVER_ILLEGAL_STATUS_ROWS.map((row) => {
    const total = riverIllegalStatusTotal(card.status, row.key);
    const cells = RIVER_ILLEGAL_STATUS_KINDS.map((k) => {
      const raw = card.status[k.key]?.[row.key] ?? "";
      const s = String(raw).trim();
      return `<td>${s ? riverIllegalRedMarkupToHtml(s) : ""}</td>`;
    }).join("");
    /** 적발 합계만 검정, 조치·미조치 합계는 빨강 */
    const totCls = row.key !== "detected" ? ' class="rio-red"' : "";
    const totalCell = total > 0 ? `<td${totCls}>${total}</td>` : "<td></td>";
    return `<tr><th>${esc(row.label)}</th>${totalCell}${cells}</tr>`;
  }).join("");
  return `<table class="st"><tr><th>구분</th><th>합계</th>${head}</tr>${body}</table>`;
}

function printDocTitle(card: RiverIllegalOccupationCard): string {
  return ["불법 점용시설 관리카드", String(card.serialNo ?? "").trim()]
    .filter(Boolean)
    .join("_")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function allCardsDocTitle(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `불법 점용시설 관리카드_전체_${ymd}`;
}

/** 인쇄 미리보기 서식 — «인쇄 → PDF로 저장»과 동일 */
function printCss(): string {
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

function printBodyHtml(card: RiverIllegalOccupationCard): string {
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

export function riverIllegalOccupationPrintHtml(card: RiverIllegalOccupationCard, docTitle: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>
<style>${printCss()}</style></head><body>
<div class="sheet">${printBodyHtml(card)}</div>
</body></html>`;
}

function riverIllegalOccupationPrintHtmlMany(cards: RiverIllegalOccupationCard[], docTitle: string) {
  const sheets = cards.map((c) => `<div class="sheet">${printBodyHtml(c)}</div>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>
<style>${printCss()}</style></head><body>
${sheets}
</body></html>`;
}

function waitImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (el) =>
        new Promise<void>((resolve) => {
          if (el.complete) {
            resolve();
            return;
          }
          el.onload = () => resolve();
          el.onerror = () => resolve();
          window.setTimeout(() => resolve(), 2500);
        })
    )
  ).then(() => undefined);
}

async function toPrintableCard(card: RiverIllegalOccupationCard): Promise<RiverIllegalOccupationCard> {
  const [locationMapUrl, photo1Url, photo2Url, completePhotoUrl] = await Promise.all([
    urlToDataUrl(card.locationMapUrl.trim()),
    urlToDataUrl(card.photo1Url.trim()),
    urlToDataUrl(card.photo2Url.trim()),
    urlToDataUrl(card.completePhotoUrl.trim()),
  ]);
  return { ...card, locationMapUrl, photo1Url, photo2Url, completePhotoUrl };
}

/**
 * 브라우저 인쇄 창을 연다.
 * 대상에서 «PDF로 저장»을 고르면 인쇄 미리보기와 같은 PDF가 저장된다.
 * (브라우저 보안상 인쇄 창 없이 PDF만 자동 저장은 불가)
 */
async function openPrintWindow(html: string, docTitle: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();
  await waitImages(doc);
  await new Promise((r) => window.setTimeout(r, 50));

  const prevTitle = document.title;
  document.title = docTitle;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = prevTitle;
    iframe.remove();
    win.removeEventListener("afterprint", cleanup);
  };
  win.addEventListener("afterprint", cleanup);
  win.focus();
  win.print();
  window.setTimeout(cleanup, 30000);
}

/** 관리카드 1장 인쇄 (인쇄 창 → PDF로 저장 가능) */
export async function printRiverIllegalOccupationCard(card: RiverIllegalOccupationCard | null) {
  if (!card) return;
  const printable = await toPrintableCard(card);
  const docTitle = printDocTitle(printable);
  await openPrintWindow(riverIllegalOccupationPrintHtml(printable, docTitle), docTitle);
}

/**
 * 상세 «PDF 저장» — 인쇄와 동일한 창을 연다.
 * 대상: PDF로 저장 → 저장하면 인쇄 미리보기와 같은 PDF가 나온다.
 */
export async function downloadRiverIllegalOccupationCardPdf(card: RiverIllegalOccupationCard | null) {
  await printRiverIllegalOccupationCard(card);
}

/**
 * 목록 «전체 PDF 저장» — 카드마다 A4 한 쪽으로 묶어 인쇄 창을 연다.
 * 대상: PDF로 저장 → 전체 카드가 한 PDF로 저장된다.
 */
export async function downloadRiverIllegalOccupationCardsPdf(cards: RiverIllegalOccupationCard[]) {
  if (cards.length === 0) return;
  const printables = await Promise.all(cards.map((c) => toPrintableCard(c)));
  const docTitle = allCardsDocTitle();
  await openPrintWindow(riverIllegalOccupationPrintHtmlMany(printables, docTitle), docTitle);
}
