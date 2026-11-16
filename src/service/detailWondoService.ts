/**
 * 지적 세부원도 — 원도 JPG + .fitimage(네 모서리 좌표, Bessel 동부원점 50만) 목록
 *
 * 원본 폴더: GGNR_DATA_DIR/file_data/detail_wondo
 * 목록은 폴더를 한 번 읽어 메모리와 .meta JSON에 보관하고, refresh 시 다시 읽는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionUsrId } from '@/lib/auth/guard';
import { parseDetailWondoFolderName } from '@/app/(pages)/map/_mapContents/detailWondo/detailWondoConfig';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';

type Params = Record<string, unknown>;

/** [x(동), y(북)] — EPSG:5176 */
export type DetailWondoCoord = [number, number];

export type DetailWondoCategory = '지적' | '임야' | '';

export type DetailWondoItem = {
  id: string;
  name: string;
  title: string;
  /** 읍·면 (시내 동 지역은 빈 문자열) */
  eupmyeon: string;
  dong: string;
  sheetNo: string;
  area: string;
  category: DetailWondoCategory;
  /** 파일명 앞 19자리 PNU (있을 때만) */
  pnu: string;
  topLeft: DetailWondoCoord;
  topRight: DetailWondoCoord;
  bottomRight: DetailWondoCoord;
  bottomLeft: DetailWondoCoord;
  /** 월드파일 A,D,B,E,C,F — 이미지 실제 크기로 다시 맞출 때 사용 */
  world?: [number, number, number, number, number, number];
};

export type DetailWondoIndex = {
  version: number;
  /** 읽은 원도 폴더. 경로가 바뀌면 보관 목록을 버린다 */
  rootDir: string;
  srs: 'EPSG:5176';
  scannedAt: string;
  items: DetailWondoItem[];
};

const INDEX_FILE = 'detail_wondo_index.json';
/** 항목 형식이 바뀌면 올려서 보관 목록을 다시 만든다 */
const INDEX_VERSION = 5;
/** 월드파일 병렬 읽기. 한 장씩 읽으면 네트워크 폴더에서 수 분이 걸린다 */
const WORLD_READ_CONCURRENCY = 32;

export type DetailWondoScanPhase = 'idle' | 'load' | 'walk' | 'read' | 'save';

export type DetailWondoScanProgress = {
  scanning: boolean;
  phase: DetailWondoScanPhase;
  current: number;
  total: number;
  found: number;
  pct: number;
};

let memoryIndex: DetailWondoIndex | null = null;
let scanning: Promise<DetailWondoIndex> | null = null;
let scanPhase: DetailWondoScanPhase = 'idle';
let scanCurrent = 0;
let scanTotal = 0;
let scanFound = 0;

function scanPct(): number {
  if (scanPhase === 'load') return 3;
  if (scanPhase === 'walk') return 5;
  if (scanPhase === 'read') {
    if (scanTotal <= 0) return 6;
    return Math.min(96, 6 + Math.round((scanCurrent / scanTotal) * 90));
  }
  if (scanPhase === 'save') return 98;
  return 0;
}

function snapshotProgress(): DetailWondoScanProgress {
  return {
    scanning: scanPhase !== 'idle',
    phase: scanPhase,
    current: scanCurrent,
    total: scanTotal,
    found: scanFound,
    pct: scanPct(),
  };
}

function resetScanProgress(): void {
  scanPhase = 'idle';
  scanCurrent = 0;
  scanTotal = 0;
  scanFound = 0;
}

function throwHttp(status: number, message: string): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

function detailWondoRootDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.detailWondo);
}

function indexFilePath(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.meta, INDEX_FILE);
}

function isUsableIndex(index: DetailWondoIndex | null): index is DetailWondoIndex {
  return (
    index?.version === INDEX_VERSION &&
    Array.isArray(index.items) &&
    index.rootDir === detailWondoRootDir()
  );
}

function parseCoord(text: string | undefined): DetailWondoCoord | null {
  if (!text) return null;
  const [x, y] = text.split(',').map((v) => Number(v.trim()));
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return (m?.[1] ?? '').trim();
}

/** 상위 폴더 이름(01_지적 / 02_임야)으로 구분 */
function categoryOf(relDir: string): DetailWondoCategory {
  const top = relDir.split('/')[0] ?? '';
  if (top.includes('임야')) return '임야';
  if (top.includes('지적')) return '지적';
  return '';
}

const EUPMYEON_RE = /(읍|면)$/;

/** «경상북도 안동군 길안면 고란동 1» → 읍면 «길안면», 동 «고란동», 번호 «1» */
function splitTitle(title: string): { eupmyeon: string; dong: string; sheetNo: string } {
  const parts = title.replace(/_/g, ' ').split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const hasNo = /^\d+$/.test(last);
  const dongIdx = parts.length - (hasNo ? 2 : 1);
  const before = parts[dongIdx - 1] ?? '';
  return {
    eupmyeon: EUPMYEON_RE.test(before) ? before : '',
    dong: parts[dongIdx] ?? '',
    sheetNo: hasNo ? last : '',
  };
}

/** 설명에 읍·면이 없으면 폴더 경로(01_지적/길안면/…)에서 찾는다 */
function eupmyeonOfDir(relDir: string): string {
  return relDir.split('/').find((seg) => EUPMYEON_RE.test(seg)) ?? '';
}

function findIgnoreCase(fileNames: Set<string>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (fileNames.has(c)) return c;
    const lower = c.toLowerCase();
    for (const n of fileNames) {
      if (n.toLowerCase() === lower) return n;
    }
  }
  return undefined;
}

function folderPartsOf(relDir: string): { eupmyeon: string; dong: string; sheetNo: string } {
  const last = relDir.split('/').filter(Boolean).pop() ?? '';
  const parsed = parseDetailWondoFolderName(last);
  return {
    eupmyeon: parsed.eupmyeon || eupmyeonOfDir(relDir),
    dong: parsed.dong,
    sheetNo: '',
  };
}

function parseWorldFile(text: string): [number, number, number, number, number, number] | null {
  const nums = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.startsWith('['))
    .slice(0, 6)
    .map(Number);
  if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) return null;
  if (nums[0] === 0 && nums[3] === 0) return null;
  return nums as [number, number, number, number, number, number];
}

function cornersFromWorld(
  A: number,
  D: number,
  B: number,
  E: number,
  C: number,
  F: number,
  width: number,
  height: number
): Pick<DetailWondoItem, 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'> {
  const at = (col: number, row: number): DetailWondoCoord => [A * col + B * row + C, D * col + E * row + F];
  return {
    topLeft: at(-0.5, -0.5),
    topRight: at(width - 0.5, -0.5),
    bottomRight: at(width - 0.5, height - 0.5),
    bottomLeft: at(-0.5, height - 0.5),
  };
}

/** JPEG SOF만 읽어 픽셀 크기. 본문은 읽지 않는다 */
async function jpegPixelSize(absPath: string): Promise<{ width: number; height: number } | null> {
  const fh = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const read = async (position: number, n: number) => {
      const { bytesRead } = await fh.read(buf, 0, n, position);
      return bytesRead;
    };
    if ((await read(0, 2)) < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let pos = 2;
    for (let i = 0; i < 80; i++) {
      if ((await read(pos, 2)) < 2) return null;
      // SOI 검사로 buf[0]/[1]이 리터럴로 좁혀지므로, 이후 read 갱신 값은 number로 읽는다
      const b0: number = buf[0];
      const marker: number = buf[1];
      if (b0 !== 0xff) return null;
      pos += 2;
      if (marker === 0xff) {
        pos -= 1;
        continue;
      }
      if (marker === 0xd9) return null;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if ((await read(pos, 2)) < 2) return null;
      const len = buf.readUInt16BE(0);
      if (len < 2) return null;
      const sof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3;
      if (sof) {
        if ((await read(pos + 2, 5)) < 5) return null;
        const height = buf.readUInt16BE(1);
        const width = buf.readUInt16BE(3);
        if (width < 1 || height < 1) return null;
        return { width, height };
      }
      pos += len;
    }
    return null;
  } finally {
    await fh.close();
  }
}

function parseFitimage(xml: string): Omit<DetailWondoItem, 'id' | 'category' | 'pnu'> | null {
  const topLeft = parseCoord(tagText(xml, 'topleft'));
  const topRight = parseCoord(tagText(xml, 'topright'));
  const bottomRight = parseCoord(tagText(xml, 'bottomright'));
  const bottomLeft = parseCoord(tagText(xml, 'bottomleft'));
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
  const title = tagText(xml, 'desc');
  const area = tagText(xml, 'areaname');
  return {
    name: tagText(xml, 'name'),
    title,
    area,
    ...splitTitle(title),
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  };
}

type WorldPending = {
  absDir: string;
  relDir: string;
  jpgName: string;
  worldName: string;
  folderTitle: string;
  folderParts: { eupmyeon: string; dong: string; sheetNo: string };
};

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** 폴더만 먼저 훑고, 월드파일·JPEG는 scanIndex에서 한꺼번에 읽는다 */
async function collect(
  rootDir: string,
  relDir: string,
  fitOut: DetailWondoItem[],
  pending: WorldPending[]
): Promise<void> {
  const absDir = relDir ? path.join(rootDir, ...relDir.split('/')) : rootDir;
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const decoder = new TextDecoder('euc-kr');
  const usedJpg = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.fitimage')) continue;
    const base = entry.name.slice(0, -'.fitimage'.length);
    const jpgName = findIgnoreCase(fileNames, [`${base}.jpg`, `${base}.JPG`, `${base}.jpeg`]);
    if (!jpgName) continue;
    try {
      const xml = decoder.decode(await fs.readFile(path.join(absDir, entry.name)));
      const parsed = parseFitimage(xml);
      if (!parsed) continue;
      const pnu = /^(\d{19})_/.exec(base)?.[1] ?? '';
      fitOut.push({
        ...parsed,
        name: parsed.name || base,
        eupmyeon: parsed.eupmyeon || eupmyeonOfDir(relDir),
        id: relDir ? `${relDir}/${jpgName}` : jpgName,
        category: categoryOf(relDir),
        pnu,
      });
      usedJpg.add(jpgName.toLowerCase());
    } catch {
      /* 좌표 파일이 깨진 원도는 목록에서 제외 */
    }
  }

  const folderParts = folderPartsOf(relDir);
  const folderTitle = [folderParts.eupmyeon, folderParts.dong].filter(Boolean).join(' ');
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) continue;
    if (usedJpg.has(lower)) continue;
    const base = entry.name.replace(/\.(jpg|jpeg)$/i, '');
    const worldName = findIgnoreCase(fileNames, [`${base}.jgwx`, `${base}.jgw`, `${base}.jpgw`, `${base}.wld`]);
    if (!worldName) continue;
    pending.push({
      absDir,
      relDir,
      jpgName: entry.name,
      worldName,
      folderTitle,
      folderParts,
    });
  }

  scanFound = fitOut.length + pending.length;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.toLowerCase().endsWith('.tile')) continue;
    await collect(rootDir, relDir ? `${relDir}/${entry.name}` : entry.name, fitOut, pending);
  }
}

function compareItems(a: DetailWondoItem, b: DetailWondoItem): number {
  return (
    a.category.localeCompare(b.category, 'ko') ||
    a.eupmyeon.localeCompare(b.eupmyeon, 'ko') ||
    a.dong.localeCompare(b.dong, 'ko') ||
    a.sheetNo.localeCompare(b.sheetNo, 'ko', { numeric: true }) ||
    a.id.localeCompare(b.id, 'ko')
  );
}

/** 같은 동(지적/임야 구분) 안에서 파일 이름 순으로 1, 2, 3… — 목록은 «고란동 1»만 쓴다 */
function assignSheetNumbers(items: DetailWondoItem[]): void {
  items.sort(
    (a, b) =>
      a.category.localeCompare(b.category, 'ko') ||
      a.eupmyeon.localeCompare(b.eupmyeon, 'ko') ||
      a.dong.localeCompare(b.dong, 'ko') ||
      a.id.localeCompare(b.id, 'ko')
  );
  let key = '\0';
  let n = 0;
  for (const it of items) {
    const k = `${it.category}\0${it.eupmyeon}\0${it.dong}`;
    if (k !== key) {
      key = k;
      n = 0;
    }
    n += 1;
    it.sheetNo = String(n);
    it.title = it.dong ? `${it.dong} ${n}` : String(n);
  }
}

async function scanIndex(): Promise<DetailWondoIndex> {
  const rootDir = detailWondoRootDir();
  try {
    await fs.access(rootDir);
  } catch {
    throwHttp(404, `세부원도 폴더를 찾을 수 없습니다: ${rootDir}`);
  }
  const fitOut: DetailWondoItem[] = [];
  const pending: WorldPending[] = [];
  scanPhase = 'walk';
  scanCurrent = 0;
  scanTotal = 0;
  scanFound = 0;
  await collect(rootDir, '', fitOut, pending);
  scanFound = fitOut.length + pending.length;

  const sizeByDir = new Map<string, Promise<{ width: number; height: number } | null>>();
  const dirSize = (absDir: string, jpgName: string) => {
    let p = sizeByDir.get(absDir);
    if (!p) {
      p = jpegPixelSize(path.join(absDir, jpgName));
      sizeByDir.set(absDir, p);
    }
    return p;
  };

  if (pending.length > 0) {
    scanPhase = 'read';
    scanCurrent = 0;
    scanTotal = pending.length;
  }
  const worldItems = await mapPool(pending, WORLD_READ_CONCURRENCY, async (p) => {
    try {
      const world = parseWorldFile(await fs.readFile(path.join(p.absDir, p.worldName), 'utf-8'));
      if (!world) return null;
      const size = await dirSize(p.absDir, p.jpgName);
      if (!size) return null;
      const [A, D, B, E, C, F] = world;
      const base = p.jpgName.replace(/\.(jpg|jpeg)$/i, '');
      const item: DetailWondoItem = {
        name: base,
        title: p.folderParts.dong,
        area: p.folderTitle,
        eupmyeon: p.folderParts.eupmyeon || eupmyeonOfDir(p.relDir),
        dong: p.folderParts.dong,
        sheetNo: '',
        ...cornersFromWorld(A, D, B, E, C, F, size.width, size.height),
        id: p.relDir ? `${p.relDir}/${p.jpgName}` : p.jpgName,
        category: categoryOf(p.relDir),
        pnu: /^(\d{19})_/.exec(base)?.[1] ?? '',
        world,
      };
      return item;
    } catch {
      return null;
    } finally {
      scanCurrent += 1;
    }
  });

  const items = [...fitOut, ...worldItems.filter((it): it is DetailWondoItem => it != null)];
  assignSheetNumbers(items);
  items.sort(compareItems);
  scanPhase = 'save';
  scanFound = items.length;
  const index: DetailWondoIndex = {
    version: INDEX_VERSION,
    rootDir,
    srs: 'EPSG:5176',
    scannedAt: new Date().toISOString(),
    items,
  };
  try {
    const file = indexFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(index), 'utf-8');
  } catch {
    /* 보관 실패해도 메모리 목록으로 동작 */
  }
  return index;
}

async function readSavedIndex(): Promise<DetailWondoIndex | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(indexFilePath(), 'utf-8')) as DetailWondoIndex;
    return isUsableIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadIndex(refresh: boolean): Promise<DetailWondoIndex> {
  if (!refresh && isUsableIndex(memoryIndex)) return memoryIndex;
  if (!refresh) {
    scanPhase = 'load';
    const saved = await readSavedIndex();
    if (saved) {
      memoryIndex = saved;
      resetScanProgress();
      return saved;
    }
  }
  if (!scanning) {
    scanning = scanIndex()
      .then((index) => {
        resetScanProgress();
        return index;
      })
      .catch((e) => {
        resetScanProgress();
        throw e;
      })
      .finally(() => {
        scanning = null;
      });
  }
  memoryIndex = await scanning;
  return memoryIndex;
}

/** 원도 데이터가 있는 프로젝트에서만 지도 «세부원도» 버튼을 보인다. (빈 기본 폴더는 제외) */
export async function available(): Promise<{ available: boolean }> {
  await requireUsr();
  if (isUsableIndex(memoryIndex) && memoryIndex.items.length > 0) {
    return { available: true };
  }
  const saved = await readSavedIndex();
  if (saved && saved.items.length > 0) return { available: true };
  try {
    const entries = await fs.readdir(detailWondoRootDir());
    return { available: entries.length > 0 };
  } catch {
    return { available: false };
  }
}

/** 원도 목록. params.refresh=true 이면 폴더를 다시 읽는다. */
export async function list(params: Params = {}): Promise<DetailWondoIndex> {
  await requireUsr();
  return loadIndex(params.refresh === true);
}

/** 목록을 폴더에서 읽는 동안의 진행. 보관 목록이 있으면 바로 idle. */
export async function scanProgress(): Promise<DetailWondoScanProgress> {
  await requireUsr();
  return snapshotProgress();
}

/**
 * 이미지 라우트 전용 — 목록에 있는 id만 실제 파일 경로로 바꾼다.
 * 공용 서비스 호출(/api)은 객체 인자로 들어오므로 경로를 돌려주지 않는다.
 */
export async function resolveImagePath(id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  await requireUsr();
  const index = await loadIndex(false);
  const item = index.items.find((it) => it.id === id);
  if (!item) return null;
  return path.join(detailWondoRootDir(), ...item.id.split('/'));
}
