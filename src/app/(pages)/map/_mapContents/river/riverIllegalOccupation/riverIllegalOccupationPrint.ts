import {
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
} from "./riverIllegalOccupationConfig";
import {
  riverIllegalStatusTotal,
  splitRiverIllegalLines,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import { formatRiverIllegalCardDate, splitRiverIllegalKindLabel } from "./riverIllegalOccupationFormat";

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

/** «@» 줄 → 줄마다 한 줄, bullet 항목은 «▸» */
function lines(value: string, bullet: boolean) {
  const rows = splitRiverIllegalLines(value);
  if (rows.length === 0) return "";
  return rows.map((l) => `<div class="ln">${bullet ? "▸ " : ""}${esc(l)}</div>`).join("");
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
    const cells = RIVER_ILLEGAL_STATUS_KINDS.map(
      (k) => `<td>${tx(card.status[k.key]?.[row.key])}</td>`
    ).join("");
    return `<tr><th>${esc(row.label)}</th><td>${total > 0 ? total : ""}</td>${cells}</tr>`;
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

export function riverIllegalOccupationPrintHtml(card: RiverIllegalOccupationCard, docTitle: string) {
  const row1 = (label: string, value: string, cls = "") =>
    `<tr><th>${label}</th><td colspan="3" class="${cls}">${value}</td></tr>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>
<style>
  /* 여백 0 — 브라우저 머리글·바닥글(날짜·제목·주소·쪽수)이 들어갈 자리를 없애고 여백은 본문 안쪽으로 (접도구역 건축물 인쇄와 동일) */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { padding: 12mm; font-family: "Malgun Gothic", "맑은 고딕", sans-serif; color: #000; font-size: 10.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0 0 4mm; text-align: center; font-size: 19pt; font-weight: 800; letter-spacing: -0.5px; text-decoration: underline; text-underline-offset: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .f > tbody > tr > th, .f > tbody > tr > td { border: 1px solid #000; padding: 1.6mm 2mm; vertical-align: middle; }
  .f > tbody > tr > th { padding: 1.6mm 1mm; font-size: 10pt; font-weight: 600; text-align: center; white-space: nowrap; background: #fff; }
  .f > tbody > tr > td.c { text-align: center; }
  .ln + .ln { margin-top: 0.6mm; }
  .st th, .st td { border: 1px solid #666; padding: 0.6mm 0.3mm; text-align: center; font-size: 7.5pt; line-height: 1.15; }
  .st th { font-weight: 600; background: #f3f3f3; }
  .st td { height: 4.6mm; }
  .ph td { border: 1px solid #000; text-align: center; }
  .ph td.box { height: 62mm; padding: 1.5mm; }
  .ph td.box img { display: block; width: 100%; height: 59mm; object-fit: cover; }
  .ph td.cap { height: 7mm; letter-spacing: 1px; }
  .ph { margin-top: -1px; }
</style></head><body>
<h1>하천·계곡 구역 내 불법 점용시설 관리카드</h1>
<table class="f">
  <colgroup><col style="width:29mm" /><col /><col style="width:29mm" /><col /></colgroup>
  <tbody>
    <tr><th>연 번</th><td class="c">${tx(card.serialNo)}</td><th>하천구분</th><td class="c">${tx(card.riverType)}</td></tr>
    <tr><th>최초 확인일자</th><td class="c">${tx(formatRiverIllegalCardDate(card.firstCheckYmd))}</td><th>완료(예정)일자</th><td class="c">${tx(formatRiverIllegalCardDate(card.completeYmd), "-")}</td></tr>
  </tbody>
</table>
<table class="f" style="margin-top:-1px">
  <colgroup><col style="width:29mm" /><col /><col style="width:29mm" /><col style="width:22%" /></colgroup>
  <tbody>
    <tr><th>위 치</th><td>${tx(card.location)}</td><th>재발여부</th><td class="c">${tx(card.recurrence)}</td></tr>
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
</table>
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

/** 관리카드 원본 모양(A4 세로 1쪽)으로 인쇄 — 접도구역 건축물 인쇄와 같은 iframe 방식 */
export async function printRiverIllegalOccupationCard(card: RiverIllegalOccupationCard | null) {
  if (!card) return;
  const [locationMapUrl, photo1Url, photo2Url, completePhotoUrl] = await Promise.all([
    urlToDataUrl(card.locationMapUrl.trim()),
    urlToDataUrl(card.photo1Url.trim()),
    urlToDataUrl(card.photo2Url.trim()),
    urlToDataUrl(card.completePhotoUrl.trim()),
  ]);
  const printable: RiverIllegalOccupationCard = {
    ...card,
    locationMapUrl,
    photo1Url,
    photo2Url,
    completePhotoUrl,
  };

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

  const docTitle = printDocTitle(printable);
  doc.open();
  doc.write(riverIllegalOccupationPrintHtml(printable, docTitle));
  doc.close();
  await waitImages(doc);
  await new Promise((r) => window.setTimeout(r, 50));

  /** iframe 인쇄 시 Chrome은 상위 문서 제목을 PDF 파일명으로 쓴다 */
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
