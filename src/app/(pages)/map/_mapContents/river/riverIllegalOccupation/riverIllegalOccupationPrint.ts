/**
 * 불법점용 관리카드 — 브라우저 인쇄 + Chromium PDF 직접 다운로드
 */
import { appFetch } from "@/lib/basePath";
import { hydrateRiverIllegalCardPhotoUrls } from "./riverIllegalOccupationFiles";
import type { RiverIllegalOccupationCard } from "./riverIllegalOccupationModel";
import {
  riverIllegalOccupationPrintHtml,
  riverIllegalPrintAllCardsDocTitle,
  riverIllegalPrintDocTitle,
} from "./riverIllegalOccupationPrintLayout";

export { riverIllegalOccupationPrintHtml } from "./riverIllegalOccupationPrintLayout";

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

function waitImagesIn(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (el) =>
        new Promise<void>((resolve) => {
          if (el.complete && el.naturalWidth > 0) {
            resolve();
            return;
          }
          el.onload = () => resolve();
          el.onerror = () => resolve();
          window.setTimeout(() => resolve(), 15000);
        })
    )
  ).then(() => undefined);
}

/** 인쇄용 — 첨부 URL → data URL */
async function toPrintableCard(card: RiverIllegalOccupationCard): Promise<RiverIllegalOccupationCard> {
  const hydrated = await hydrateRiverIllegalCardPhotoUrls(card);
  const [locationMapUrl, photo1Url, photo2Url, completePhotoUrl] = await Promise.all([
    urlToDataUrl(hydrated.locationMapUrl.trim()),
    urlToDataUrl(hydrated.photo1Url.trim()),
    urlToDataUrl(hydrated.photo2Url.trim()),
    urlToDataUrl(hydrated.completePhotoUrl.trim()),
  ]);
  return { ...hydrated, locationMapUrl, photo1Url, photo2Url, completePhotoUrl };
}

async function openPrintWindow(html: string, docTitle: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    throw new Error("인쇄 창을 열지 못했습니다.");
  }

  doc.open();
  doc.write(html);
  doc.close();
  await waitImagesIn(doc);
  await new Promise((r) => window.setTimeout(r, 120));

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
  window.setTimeout(cleanup, 120000);
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadPdfFromApi(ids: string[], fallbackName: string): Promise<void> {
  const res = await appFetch("/api/river-illegal-occupation/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    let msg = "PDF 저장에 실패했습니다.";
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(cd) ?? /filename\s*=\s*([^;]+)/i.exec(cd);
  let name = fallbackName;
  if (star?.[1]) {
    try {
      name = decodeURIComponent(star[1]);
    } catch {
      name = star[1];
    }
  } else if (plain?.[1]) {
    name = plain[1].trim();
  }
  const ct = (res.headers.get("Content-Type") ?? "").toLowerCase();
  const isZip = ct.includes("zip") || name.toLowerCase().endsWith(".zip");
  if (isZip) {
    if (!name.toLowerCase().endsWith(".zip")) name = `${name}.zip`;
  } else if (!name.toLowerCase().endsWith(".pdf")) {
    name = `${name}.pdf`;
  }
  triggerBlobDownload(blob, name);
}

/** 관리카드 1장 인쇄 (브라우저 인쇄 창) */
export async function printRiverIllegalOccupationCard(card: RiverIllegalOccupationCard | null) {
  if (!card) return;
  const printable = await toPrintableCard(card);
  const docTitle = riverIllegalPrintDocTitle(printable);
  await openPrintWindow(riverIllegalOccupationPrintHtml(printable, docTitle), docTitle);
}

/**
 * 상세 «PDF 저장» — Chromium 인쇄 엔진으로 PDF 파일 바로 다운로드
 * (브라우저 «인쇄 → PDF로 저장»과 동일 품질)
 */
export async function downloadRiverIllegalOccupationCardPdf(card: RiverIllegalOccupationCard | null) {
  if (!card?.id) return;
  await downloadPdfFromApi([card.id], riverIllegalPrintDocTitle(card));
}

/**
 * 목록 «전체 PDF 저장» — 서버 캐시 병합(미스만 Chrome) 후 PDF 1개
 */
export async function downloadRiverIllegalOccupationCardsPdf(cards: RiverIllegalOccupationCard[]) {
  const ids = cards.map((c) => String(c.id ?? "").trim()).filter(Boolean);
  if (ids.length === 0) return;
  await downloadPdfFromApi(ids, riverIllegalPrintAllCardsDocTitle());
}
