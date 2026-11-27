/**
 * Chromium(Chrome/Edge) print-to-PDF — 브라우저 «인쇄 → PDF로 저장»과 동일한 엔진.
 * html2canvas 대비 선·레이아웃이 인쇄 미리보기와 맞음.
 *
 * 폐쇄망: 인터넷 없이 동작. 실행 파일만 서버에 두고 CHROME_PATH 또는 tools/chromium 배치.
 * (런타임에 구글·CDN 접속 없음 — HTML·사진은 로컬/data URL)
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

/** 배포 폴더에 수동 배치한 Chromium (Chrome for Testing zip 구조) */
function bundledChromeCandidates(): string[] {
  const cwd = process.cwd();
  const roots = [path.join(cwd, 'tools', 'chromium'), path.join(cwd, 'chromium')];
  const rel =
    process.platform === 'win32'
      ? [
          path.join('chrome-win64', 'chrome.exe'),
          path.join('chrome-win', 'chrome.exe'),
          path.join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
          'chrome.exe',
        ]
      : process.platform === 'darwin'
        ? [
            path.join('chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            'Google Chrome for Testing',
          ]
        : [
            path.join('chrome-linux64', 'chrome'),
            path.join('chrome-linux', 'chrome'),
            path.join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
            'chrome',
            'chromium',
          ];
  const out: string[] = [];
  for (const root of roots) {
    for (const r of rel) out.push(path.join(root, r));
  }
  return out;
}

function chromeCandidates(): string[] {
  const fromEnv = String(process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? '').trim();
  const list = [
    fromEnv,
    ...bundledChromeCandidates(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return list.filter(Boolean);
}

export function resolveChromeExecutable(): string | null {
  for (const p of chromeCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 서버·폐쇄망 headless (GPU process Code 1002 완화) */
const CHROME_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--font-render-hinting=medium',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--in-process-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
];

async function launchChrome(): Promise<Browser> {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    const hint = chromeCandidates()
      .filter(Boolean)
      .slice(0, 8)
      .map((p) => `  - ${p}`)
      .join('\n');
    throw new Error(
      'Chrome/Edge/Chromium 을 찾을 수 없습니다. 폐쇄망이면 tools/chromium 에 Chrome for Testing을 두거나 CHROME_PATH를 설정하세요.\n시도 경로 예:\n' +
        hint
    );
  }
  try {
    return await puppeteer.launch({
      executablePath,
      headless: true,
      args: CHROME_LAUNCH_ARGS,
    });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Chrome 실행 실패 (경로: ${path.normalize(executablePath)}).\n` +
        `폐쇄망·서버 GPU 이슈면 동일 OS용 Chrome for Testing을 tools/chromium 에 두고 CHROME_PATH로 지정하세요.\n` +
        detail
    );
  }
}

/** data URL 위주 HTML — networkidle 대기 불필요(타임아웃 원인). */
async function waitImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
            window.setTimeout(() => resolve(), 8_000);
          })
      )
    );
  });
}

async function renderHtmlToPdfBuffer(page: Page, html: string): Promise<Buffer> {
  // networkidle0 는 대량 data URL 문서에서 Navigation timeout 유발 → DOM 로드만 대기
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitImages(page);
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  return Buffer.from(pdf);
}

/**
 * HTML 문서 → PDF 바이트 (A4, CSS @page 우선, 배경 인쇄)
 */
export async function htmlToPdfWithChrome(html: string): Promise<Buffer> {
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    return await renderHtmlToPdfBuffer(page, html);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * HTML 여러 장 → PDF Buffer[] (순서 유지).
 * Chrome N개를 재사용하며 큐를 나눠 렌더 — 단건 캐시 대량 생성용.
 */
export async function htmlPagesToPdfBuffersWithChrome(
  htmlPages: string[],
  opts?: { concurrency?: number }
): Promise<Buffer[]> {
  if (htmlPages.length === 0) return [];
  if (htmlPages.length === 1) {
    return [await htmlToPdfWithChrome(htmlPages[0]!)];
  }

  const concurrency = Math.max(
    1,
    Math.min(Math.floor(opts?.concurrency ?? 3) || 3, htmlPages.length)
  );
  const parts: Buffer[] = new Array(htmlPages.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      while (true) {
        const i = next++;
        if (i >= htmlPages.length) return;
        parts[i] = await renderHtmlToPdfBuffer(page, htmlPages[i]!);
        await page
          .goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 })
          .catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
  await Promise.all(workers);
  return parts;
}

/**
 * 여러 HTML → PDF 조각 → 하나로 병합.
 * concurrency>1 이면 Chrome N개를 띄워 조각 인덱스를 나눠 병렬 렌더(순서는 유지).
 * 한 HTML에 사진을 몰아넣지 않고 조각 단위로 올려 Navigation timeout·메모리 폭주를 막음.
 */
export async function htmlChunksToMergedPdfWithChrome(
  htmlChunks: string[],
  opts?: { concurrency?: number }
): Promise<Buffer> {
  if (htmlChunks.length === 0) {
    throw new Error('PDF로 만들 HTML이 없습니다.');
  }
  if (htmlChunks.length === 1) {
    return htmlToPdfWithChrome(htmlChunks[0]!);
  }

  const concurrency = Math.max(
    1,
    Math.min(Math.floor(opts?.concurrency ?? 1) || 1, htmlChunks.length)
  );

  if (concurrency === 1) {
    const browser = await launchChrome();
    const parts: Buffer[] = [];
    try {
      const page = await browser.newPage();
      for (const html of htmlChunks) {
        parts.push(await renderHtmlToPdfBuffer(page, html));
        // 이전 문서 DOM·이미지 메모리 해제
        await page
          .goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 })
          .catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return mergePdfBuffers(parts);
  }

  const parts: Buffer[] = new Array(htmlChunks.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      while (true) {
        const i = next++;
        if (i >= htmlChunks.length) return;
        parts[i] = await renderHtmlToPdfBuffer(page, htmlChunks[i]!);
        await page
          .goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 })
          .catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
  await Promise.all(workers);
  return mergePdfBuffers(parts);
}

const MERGE_BATCH_SIZE = 12;

async function mergePdfBuffersFlat(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('병합할 PDF가 없습니다.');
  if (buffers.length === 1) return buffers[0]!;

  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
    // 대량 병합 중에도 같은 서버의 다른 요청(사진·목록)이 처리되도록 양보
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  // object streams 끄면 대량 페이지 저장이 대체로 더 빠름
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

/**
 * PDF 조각 병합. 조각이 많으면 배치로 나눠 합쳐 피크 메모리를 줄임.
 */
export async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('병합할 PDF가 없습니다.');
  if (buffers.length === 1) return buffers[0]!;
  if (buffers.length <= MERGE_BATCH_SIZE) return mergePdfBuffersFlat(buffers);

  const mid: Buffer[] = [];
  for (let i = 0; i < buffers.length; i += MERGE_BATCH_SIZE) {
    mid.push(await mergePdfBuffersFlat(buffers.slice(i, i + MERGE_BATCH_SIZE)));
  }
  return mergePdfBuffers(mid);
}

/** Content-Disposition 용 파일명 (확장자 유지: .pdf / .zip) */
export function pdfContentDispositionFileName(name: string): string {
  const base = String(name ?? '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const lower = base.toLowerCase();
  if (lower.endsWith('.pdf') || lower.endsWith('.zip')) return base || 'document.pdf';
  return `${base || 'document'}.pdf`;
}

export function pdfContentDispositionHeader(fileName: string): string {
  const raw = pdfContentDispositionFileName(fileName);
  const asciiFallback = raw.toLowerCase().endsWith('.zip') ? 'document.zip' : 'document.pdf';
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_') || asciiFallback;
  const encoded = encodeURIComponent(raw);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 실행 파일 경로 확인용 (디버그) */
export function chromePdfResolvedPathHint(): string {
  const p = resolveChromeExecutable();
  return p ? path.normalize(p) : '(not found)';
}
