/**
 * 급경사지 안전점검표 — 브라우저 인쇄 + PDF(인쇄 대화상자)
 */
import { STEEP_SLOPE_ATTACHMENT_MAX } from "./steepSlopeSafetyConfig";
import type { SteepSlopeSafetyCard } from "./steepSlopeSafetyMock";
import {
  steepSlopeSafetyPrintDocTitle,
  steepSlopeSafetyPrintHtml,
} from "./steepSlopeSafetyPrintLayout";

async function urlToDataUrl(src: string): Promise<string> {
  const s = String(src ?? "").trim();
  if (!s || s.startsWith("data:")) return s;
  try {
    const res = await fetch(s, { credentials: "include" });
    if (!res.ok) return s;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : s);
      reader.onerror = () => resolve(s);
      reader.readAsDataURL(blob);
    });
  } catch {
    return s;
  }
}

/** 인쇄·PDF용 — 고정사진·첨부 URL을 data URL로 변환해 원본처럼 출력 */
async function toPrintableCard(
  card: SteepSlopeSafetyCard
): Promise<SteepSlopeSafetyCard> {
  const photos = await Promise.all(
    (card.photos ?? []).map(async (p) => ({
      ...p,
      url: await urlToDataUrl(p.url),
    }))
  );
  const attachments = await Promise.all(
    (card.attachments ?? [])
      .filter((a) => String(a.url ?? "").trim())
      .slice(0, STEEP_SLOPE_ATTACHMENT_MAX)
      .map(async (a) => ({
        ...a,
        url: await urlToDataUrl(a.url),
      }))
  );
  return { ...card, photos, attachments };
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
          window.setTimeout(() => resolve(), 8000);
        })
    )
  ).then(() => undefined);
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
  await new Promise((r) => window.setTimeout(r, 80));
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

export async function printSteepSlopeSafetyCard(
  card: SteepSlopeSafetyCard
): Promise<void> {
  const printable = await toPrintableCard(card);
  const title = steepSlopeSafetyPrintDocTitle(printable);
  await openPrintWindow(steepSlopeSafetyPrintHtml(printable), title);
}

/** 프로토타입 — 인쇄 대화상자에서 «PDF로 저장» */
export async function downloadSteepSlopeSafetyCardPdf(
  card: SteepSlopeSafetyCard
): Promise<void> {
  await printSteepSlopeSafetyCard(card);
}
