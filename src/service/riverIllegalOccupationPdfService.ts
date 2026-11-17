/**
 * 불법점용 관리카드 PDF — Chromium 인쇄 품질
 * - 저장/사진 변경 시 단건 PDF 캐시
 * - 워밍 끝·단건 갱신 후 «전체 병합본»을 디스크에 미리 둠
 * - 전체 PDF 저장: 병합본이 유효하면 파일만 읽어 응답 (pdf-lib 재병합 생략)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import {
  htmlPagesToPdfBuffersWithChrome,
  htmlToPdfWithChrome,
  mergePdfBuffers,
  pdfContentDispositionFileName,
} from '@/lib/chromeHtmlToPdf';
import {
  isServiceFileDataSystemJunkFileName,
  isServiceFileDataTmpMarkedFileName,
} from '@/lib/serviceFileData';
import {
  RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
  type RiverIllegalPhotoField,
} from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationConfig';
import {
  findRiverIllegalPhotoFile,
  riverIllegalFileKey,
  riverIllegalFileKeyLegacy,
  type RiverIllegalAttachFileRow,
} from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationPhotoMatch';
import type { RiverIllegalOccupationCard } from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationModel';
import { riverIllegalMgmtNoRank } from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationModel';
import {
  riverIllegalOccupationPrintHtml,
  riverIllegalPrintAllCardsDocTitle,
  riverIllegalPrintDocTitle,
} from '@/app/(pages)/map/_mapContents/river/riverIllegalOccupation/riverIllegalOccupationPrintLayout';
import { get, list } from '@/service/riverIllegalOccupationService';

const PHOTO_FIELDS: RiverIllegalPhotoField[] = [
  'locationMapUrl',
  'photo1Url',
  'photo2Url',
  'completePhotoUrl',
];

const PDF_CACHE_DIR_NAME = 'pdf_cache';
const PDF_CACHE_LAYER = RIVER_ILLEGAL_OCCUPATION_FILE_LAYER;

/** 캐시 미스 시 Chrome 동시 수 (브라우저 재사용) */
const MISS_CHROME_CONCURRENCY = 4;
/** 목록 진입 백그라운드 워밍 — 상세 사진 등 다른 요청이 밀리지 않게 낮춤 */
const WARM_CHROME_CONCURRENCY = 2;
const WARM_HYDRATE_CONCURRENCY = 2;

/** 무거운 반복 사이에 다른 요청(사진 다운로드 등)이 처리되도록 이벤트 루프 양보 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
/** 캐시 파일 병렬 읽기 */
const CACHE_READ_CONCURRENCY = 32;

export type RiverIllegalOccupationPdfResult = {
  body: Buffer;
  fileName: string;
  contentType: 'application/pdf';
};

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function pdfCacheDir(): string {
  return path.join(resolveGgnrDataDir(), PDF_CACHE_DIR_NAME, PDF_CACHE_LAYER);
}

function pdfCachePath(mgmtNo: string): string | null {
  const key = riverIllegalFileKey(mgmtNo);
  if (!key) return null;
  return path.join(pdfCacheDir(), `${key}.pdf`);
}

/** 전체 목록용 미리 병합된 PDF (다운로드 시 재병합 비용 제거) */
const BULK_MERGED_PDF = '_ALL_MERGED.pdf';
const BULK_MERGED_META = '_ALL_MERGED.meta.json';

function bulkMergedPdfPath(): string {
  return path.join(pdfCacheDir(), BULK_MERGED_PDF);
}
function bulkMergedMetaPath(): string {
  return path.join(pdfCacheDir(), BULK_MERGED_META);
}

type BulkMeta = { mgmtNos: string[]; updatedAt: string };

/** 목록 UI 기본 정렬(관리번호 최신순)과 동일하게 맞춤 — 합본 히트율 */
function sortCardsLikeList(cards: RiverIllegalOccupationCard[]): RiverIllegalOccupationCard[] {
  return [...cards].sort(
    (a, b) => riverIllegalMgmtNoRank(b.mgmtNo) - riverIllegalMgmtNoRank(a.mgmtNo)
  );
}

function mgmtNosKey(cards: RiverIllegalOccupationCard[]): string[] {
  return sortCardsLikeList(cards)
    .map((c) => String(c.mgmtNo ?? '').trim())
    .filter(Boolean);
}

async function readBulkMeta(): Promise<BulkMeta | null> {
  try {
    const raw = await fs.readFile(bulkMergedMetaPath(), 'utf8');
    const j = JSON.parse(raw) as BulkMeta;
    if (!Array.isArray(j?.mgmtNos)) return null;
    return j;
  } catch {
    return null;
  }
}

async function bulkSnapshotMatches(cards: RiverIllegalOccupationCard[]): Promise<boolean> {
  const meta = await readBulkMeta();
  if (!meta) return false;
  const want = mgmtNosKey(cards);
  if (want.length === 0 || want.length !== meta.mgmtNos.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== meta.mgmtNos[i]) return false;
  }
  try {
    const st = await fs.stat(bulkMergedPdfPath());
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function invalidateBulkSnapshot(): Promise<void> {
  await fs.unlink(bulkMergedPdfPath()).catch(() => undefined);
  await fs.unlink(bulkMergedMetaPath()).catch(() => undefined);
}

/** 단건 캐시가 모두 있을 때 전체 병합본 작성 */
async function writeBulkSnapshotFromCardCaches(
  cards: RiverIllegalOccupationCard[]
): Promise<void> {
  if (cards.length === 0) {
    await invalidateBulkSnapshot();
    return;
  }
  const ordered = sortCardsLikeList(cards);
  // 백그라운드 병합 — 파일 읽기 슬롯을 다 차지하면 사진 다운로드가 밀림
  const parts = await mapPool(ordered, WARM_HYDRATE_CONCURRENCY * 2, async (c) => {
    const buf = await readRiverIllegalOccupationPdfCache(c.mgmtNo);
    if (!buf) throw new Error(`단건 캐시 없음: ${c.mgmtNo}`);
    return buf;
  });
  const merged = await mergePdfBuffers(parts);
  await fs.mkdir(pdfCacheDir(), { recursive: true });
  const pdfPath = bulkMergedPdfPath();
  const tmp = `${pdfPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, merged);
  await fs.rename(tmp, pdfPath);
  const meta: BulkMeta = {
    mgmtNos: mgmtNosKey(ordered),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(bulkMergedMetaPath(), JSON.stringify(meta), 'utf8');
}

async function listAttachDir(key: string): Promise<{ key: string; files: RiverIllegalAttachFileRow[] }> {
  const root = resolveGgnrDataDir();
  const dir = path.join(root, 'file_data', RIVER_ILLEGAL_OCCUPATION_FILE_LAYER, key);
  try {
    const names = await fs.readdir(dir);
    const files: RiverIllegalAttachFileRow[] = [];
    for (const name of names) {
      if (isServiceFileDataTmpMarkedFileName(name) || isServiceFileDataSystemJunkFileName(name)) continue;
      const st = await fs.stat(path.join(dir, name)).catch(() => null);
      if (!st?.isFile()) continue;
      files.push({ name, size: st.size });
    }
    return { key, files };
  } catch {
    return { key, files: [] };
  }
}

async function fileDataUrl(folderKey: string, fileName: string): Promise<string> {
  const root = resolveGgnrDataDir();
  const full = path.join(root, 'file_data', RIVER_ILLEGAL_OCCUPATION_FILE_LAYER, folderKey, fileName);
  const buf = await fs.readFile(full);
  return `data:${mimeFromName(fileName)};base64,${buf.toString('base64')}`;
}

async function hydrateCardPhotosFromDisk(
  card: RiverIllegalOccupationCard
): Promise<RiverIllegalOccupationCard> {
  const key = riverIllegalFileKey(card.mgmtNo);
  if (!key) return card;
  const legacy = riverIllegalFileKeyLegacy(card.mgmtNo);
  const primary = await listAttachDir(key);
  const legacyListed =
    legacy && legacy !== key
      ? await listAttachDir(legacy)
      : { key: legacy, files: [] as RiverIllegalAttachFileRow[] };

  const next = { ...card };
  for (const field of PHOTO_FIELDS) {
    const hitPrimary = findRiverIllegalPhotoFile(primary.files, key, field);
    if (hitPrimary) {
      try {
        next[field] = await fileDataUrl(primary.key, hitPrimary.name);
        continue;
      } catch {
        /* fall through */
      }
    }
    if (legacyListed.files.length) {
      const hitLegacy = findRiverIllegalPhotoFile(legacyListed.files, legacy, field);
      if (hitLegacy) {
        try {
          next[field] = await fileDataUrl(legacyListed.key, hitLegacy.name);
          continue;
        } catch {
          /* empty */
        }
      }
    }
    next[field] = '';
  }
  return next;
}

async function resolveCardsByIds(ids: string[]): Promise<RiverIllegalOccupationCard[]> {
  const uniq = [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (uniq.length === 0) return [];

  if (uniq.length > 1) {
    const { items } = await list();
    const map = new Map(items.map((c) => [c.id, c]));
    return uniq.map((id) => map.get(id)).filter((c): c is RiverIllegalOccupationCard => Boolean(c));
  }

  const one = await get({ id: uniq[0]! });
  return one.item ? [one.item] : [];
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function renderSingleCardPdf(card: RiverIllegalOccupationCard): Promise<Buffer> {
  const hydrated = await hydrateCardPhotosFromDisk(card);
  const title = riverIllegalPrintDocTitle(hydrated);
  return htmlToPdfWithChrome(riverIllegalOccupationPrintHtml(hydrated, title));
}

export async function readRiverIllegalOccupationPdfCache(mgmtNo: string): Promise<Buffer | null> {
  const full = pdfCachePath(mgmtNo);
  if (!full) return null;
  try {
    const buf = await fs.readFile(full);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export async function writeRiverIllegalOccupationPdfCache(
  mgmtNo: string,
  pdf: Buffer
): Promise<void> {
  const full = pdfCachePath(mgmtNo);
  if (!full) return;
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, pdf);
  await fs.rename(tmp, full);
  // 워밍 중에는 끝에서 한 번만 전체 병합 — 중간 무효화 생략
  if (!warmAllRunning) {
    await invalidateBulkSnapshot();
    scheduleRebuildBulkSnapshotOnly();
  }
}

export async function removeRiverIllegalOccupationPdfCache(mgmtNo: string): Promise<void> {
  const full = pdfCachePath(mgmtNo);
  if (!full) return;
  await fs.unlink(full).catch(() => undefined);
  await invalidateBulkSnapshot();
}

/** 저장·사진 변경 후 — 해당 카드 PDF를 Chrome으로 만들어 캐시 */
export async function refreshRiverIllegalOccupationPdfCacheById(id: string): Promise<void> {
  const key = String(id ?? '').trim();
  if (!key) return;
  const got = await get({ id: key });
  if (!got.item) return;
  const pdf = await renderSingleCardPdf(got.item);
  await writeRiverIllegalOccupationPdfCache(got.item.mgmtNo, pdf);
}

export function scheduleRiverIllegalOccupationPdfCacheRefresh(id: string): void {
  const key = String(id ?? '').trim();
  if (!key) return;
  void refreshRiverIllegalOccupationPdfCacheById(key).catch((e: unknown) => {
    console.error('[river-illegal-pdf-cache] refresh failed', key, e);
  });
}

export function scheduleRiverIllegalOccupationPdfCacheRemove(mgmtNo: string): void {
  const key = String(mgmtNo ?? '').trim();
  if (!key) return;
  void removeRiverIllegalOccupationPdfCache(key).catch(() => undefined);
}

/** 전체 워밍이 동시에 여러 번 돌지 않게 */
let warmAllRunning = false;
/** 전체 병합본 작성 중 — 버튼은 아직 비활성 */
let bulkBuilding = false;
let warmLastError: string | null = null;
/** UI 폴링용 — 진행 중에도 숫자 갱신 */
let warmProgress = { total: 0, cached: 0, missing: 0 };

export type RiverIllegalPdfCacheWarmStatus = {
  running: boolean;
  /** 전체 PDF 버튼 활성화 가능 (단건 캐시 + 전체 병합본 준비) */
  ready: boolean;
  total: number;
  cached: number;
  missing: number;
  error: string | null;
  /** 전체 병합본 준비 여부 */
  bulkReady: boolean;
};

async function countCacheCoverage(items: RiverIllegalOccupationCard[]): Promise<{
  total: number;
  cached: number;
  missing: number;
}> {
  const total = items.length;
  if (total === 0) return { total: 0, cached: 0, missing: 0 };
  const flags = await mapPool(items, CACHE_READ_CONCURRENCY, async (c) => {
    const buf = await readRiverIllegalOccupationPdfCache(c.mgmtNo);
    return Boolean(buf);
  });
  const cached = flags.filter(Boolean).length;
  return { total, cached, missing: total - cached };
}

/** 목록 버튼 활성/준비중 표시용 */
export async function getRiverIllegalOccupationPdfCacheWarmStatus(): Promise<RiverIllegalPdfCacheWarmStatus> {
  if (warmAllRunning || bulkBuilding) {
    return {
      running: true,
      ready: false,
      total: warmProgress.total,
      cached: warmProgress.cached,
      missing: warmProgress.missing,
      error: warmLastError,
      bulkReady: false,
    };
  }
  try {
    const { items } = await list();
    const cov = await countCacheCoverage(items);
    warmProgress = cov;
    const bulkReady = cov.missing === 0 && (await bulkSnapshotMatches(items));
    return {
      running: false,
      ready: bulkReady,
      ...cov,
      error: warmLastError,
      bulkReady,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      running: false,
      ready: true, // 상태 조회 실패 시에도 저장은 시도 가능
      total: warmProgress.total,
      cached: warmProgress.cached,
      missing: warmProgress.missing,
      error: msg,
      bulkReady: false,
    };
  }
}

/**
 * 목록의 카드 중 캐시 없는 것만 Chrome으로 미리 생성 (디스크 유지 — 새로고침과 무관).
 * 다운로드 전에 호출해 두면 전체 PDF는 병합만 하면 됨.
 */
export async function warmRiverIllegalOccupationPdfCacheAll(): Promise<{
  total: number;
  missing: number;
  filled: number;
}> {
  warmLastError = null;
  const { items } = await list();
  const total = items.length;
  if (total === 0) {
    warmProgress = { total: 0, cached: 0, missing: 0 };
    return { total: 0, missing: 0, filled: 0 };
  }

  const flags = await mapPool(items, CACHE_READ_CONCURRENCY, async (c) => {
    const buf = await readRiverIllegalOccupationPdfCache(c.mgmtNo);
    return Boolean(buf);
  });
  const missCards = items.filter((_, i) => !flags[i]);
  const cached0 = total - missCards.length;
  warmProgress = { total, cached: cached0, missing: missCards.length };

  let filled = 0;
  if (missCards.length > 0) {
    // 한 번에 너무 많이 올리면 메모리 부담 — 청크로 나눠 채움
    const WARM_CHUNK = 20;
    for (let i = 0; i < missCards.length; i += WARM_CHUNK) {
      const chunk = missCards.slice(i, i + WARM_CHUNK);
      await fillMissingCaches(chunk, { background: true });
      await yieldToEventLoop();
      filled += chunk.length;
      warmProgress = {
        total,
        cached: total - missCards.length + filled,
        missing: missCards.length - filled,
      };
    }
  }

  // 단건이 모두 있으면 전체 병합본을 미리 만들어 다운로드는 파일 전송만
  bulkBuilding = true;
  try {
    if (!(await bulkSnapshotMatches(items))) {
      console.info(`[river-illegal-pdf-cache] building bulk merge for ${items.length} cards…`);
      await writeBulkSnapshotFromCardCaches(items);
      console.info('[river-illegal-pdf-cache] bulk merge ready');
    }
  } finally {
    bulkBuilding = false;
  }

  return { total, missing: missCards.length, filled };
}

/** 단건 캐시만 바뀐 뒤 — Chrome 없이 전체 병합본만 다시 만듦 */
function scheduleRebuildBulkSnapshotOnly(): void {
  if (warmAllRunning || bulkBuilding) return;
  bulkBuilding = true;
  void (async () => {
    const { items } = await list();
    const cov = await countCacheCoverage(items);
    warmProgress = cov;
    if (cov.missing > 0) return;
    console.info(`[river-illegal-pdf-cache] rebuild bulk merge for ${items.length} cards…`);
    await writeBulkSnapshotFromCardCaches(items);
    console.info('[river-illegal-pdf-cache] bulk merge ready');
  })()
    .catch((e: unknown) => {
      warmLastError = e instanceof Error ? e.message : String(e);
      console.error('[river-illegal-pdf-cache] bulk rebuild failed', e);
    })
    .finally(() => {
      bulkBuilding = false;
    });
}

/** 목록 패널 진입 등 — 응답을 막지 않고 백그라운드 워밍 */
export function scheduleWarmRiverIllegalOccupationPdfCacheAll(): void {
  if (warmAllRunning) return;
  warmAllRunning = true;
  warmLastError = null;
  void warmRiverIllegalOccupationPdfCacheAll()
    .then((r) => {
      console.info(
        `[river-illegal-pdf-cache] warm done total=${r.total} filled=${r.filled}`
      );
    })
    .catch((e: unknown) => {
      warmLastError = e instanceof Error ? e.message : String(e);
      console.error('[river-illegal-pdf-cache] warm failed', e);
    })
    .finally(() => {
      warmAllRunning = false;
      bulkBuilding = false;
    });
}

async function ensureCardPdfBuffer(card: RiverIllegalOccupationCard): Promise<Buffer> {
  const cached = await readRiverIllegalOccupationPdfCache(card.mgmtNo);
  if (cached) return cached;
  const pdf = await renderSingleCardPdf(card);
  await writeRiverIllegalOccupationPdfCache(card.mgmtNo, pdf).catch((e: unknown) => {
    console.error('[river-illegal-pdf-cache] write failed', e);
  });
  return pdf;
}

/**
 * 미스 카드들 — 사진 hydrate 후 Chrome 병렬 렌더 → 캐시 기록.
 * background: 목록 진입 워밍. 동시 수를 낮춰 상세 사진 등 다른 요청이 밀리지 않게 함
 */
async function fillMissingCaches(
  cards: RiverIllegalOccupationCard[],
  opts?: { background?: boolean }
): Promise<Buffer[]> {
  if (cards.length === 0) return [];
  if (cards.length === 1) {
    const pdf = await renderSingleCardPdf(cards[0]!);
    await writeRiverIllegalOccupationPdfCache(cards[0]!.mgmtNo, pdf).catch(() => undefined);
    return [pdf];
  }

  const background = opts?.background === true;
  const hydrated = await mapPool(cards, background ? WARM_HYDRATE_CONCURRENCY : 8, async (c) => {
    const h = await hydrateCardPhotosFromDisk(c);
    if (background) await yieldToEventLoop();
    return h;
  });
  const htmlPages = hydrated.map((c) =>
    riverIllegalOccupationPrintHtml(c, riverIllegalPrintDocTitle(c))
  );
  const pdfs = await htmlPagesToPdfBuffersWithChrome(htmlPages, {
    concurrency: background ? WARM_CHROME_CONCURRENCY : MISS_CHROME_CONCURRENCY,
  });
  await Promise.all(
    cards.map((c, i) =>
      writeRiverIllegalOccupationPdfCache(c.mgmtNo, pdfs[i]!).catch((e: unknown) => {
        console.error('[river-illegal-pdf-cache] write failed', c.mgmtNo, e);
      })
    )
  );
  return pdfs;
}

/**
 * ids → 인쇄와 동일 품질 PDF 1개
 * - 전체 목록이고 미리 병합본이 있으면 파일만 읽어 반환
 * - 아니면 단건 캐시 병합 (미스만 Chrome)
 */
export async function buildRiverIllegalOccupationPdf(params: {
  ids: string[];
}): Promise<RiverIllegalOccupationPdfResult> {
  const cards = await resolveCardsByIds(params.ids);
  if (cards.length === 0) {
    throw new Error('PDF로 만들 관리카드가 없습니다.');
  }

  const title =
    cards.length === 1 ? riverIllegalPrintDocTitle(cards[0]!) : riverIllegalPrintAllCardsDocTitle();
  const fileName = pdfContentDispositionFileName(
    title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`
  );

  if (cards.length === 1) {
    const pdf = await ensureCardPdfBuffer(cards[0]!);
    return { body: pdf, fileName, contentType: 'application/pdf' };
  }

  // 전체(또는 동일 순서 집합)이고 병합본이 있으면 재병합 없이 전송
  if (await bulkSnapshotMatches(cards)) {
    const body = await fs.readFile(bulkMergedPdfPath());
    return { body, fileName, contentType: 'application/pdf' };
  }

  const cachedOrNull = await mapPool(cards, CACHE_READ_CONCURRENCY, (c) =>
    readRiverIllegalOccupationPdfCache(c.mgmtNo)
  );

  const missCards: RiverIllegalOccupationCard[] = [];
  const missIdx: number[] = [];
  for (let i = 0; i < cards.length; i++) {
    if (!cachedOrNull[i]) {
      missCards.push(cards[i]!);
      missIdx.push(i);
    }
  }

  if (missCards.length > 0) {
    const filled = await fillMissingCaches(missCards);
    for (let j = 0; j < missIdx.length; j++) {
      cachedOrNull[missIdx[j]!] = filled[j]!;
    }
  }

  const parts = cachedOrNull.map((b, i) => {
    if (!b) throw new Error(`관리카드 PDF를 만들지 못했습니다. (${cards[i]?.mgmtNo ?? i})`);
    return b;
  });

  const merged = await mergePdfBuffers(parts);

  // 전체 목록이면 다음에 쓰도록 병합본 저장
  try {
    const { items } = await list();
    const allIds = new Set(items.map((c) => c.id));
    if (cards.length === items.length && cards.every((c) => allIds.has(c.id))) {
      await fs.mkdir(pdfCacheDir(), { recursive: true });
      const pdfPath = bulkMergedPdfPath();
      const tmp = `${pdfPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, merged);
      await fs.rename(tmp, pdfPath);
      await fs.writeFile(
        bulkMergedMetaPath(),
        JSON.stringify({
          mgmtNos: mgmtNosKey(cards),
          updatedAt: new Date().toISOString(),
        } satisfies BulkMeta),
        'utf8'
      );
    }
  } catch (e: unknown) {
    console.error('[river-illegal-pdf-cache] bulk save after merge failed', e);
  }

  return { body: merged, fileName, contentType: 'application/pdf' };
}
