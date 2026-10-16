/**
 * 지적 세부원도 — 원도 JPG + .fitimage(네 모서리 좌표, Bessel 동부원점 50만) 목록
 *
 * 원본 폴더: GGNR_DETAIL_WONDO_DIR (없으면 GGNR_DATA_DIR/detail_wondo)
 * 목록은 폴더를 한 번 읽어 메모리와 .meta JSON에 보관하고, refresh 시 다시 읽는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionUsrId } from '@/lib/auth/guard';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir, resolveGgnrDataPath } from '@/lib/turbopackFsPath';

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
};

export type DetailWondoIndex = {
  version: number;
  srs: 'EPSG:5176';
  scannedAt: string;
  items: DetailWondoItem[];
};

const INDEX_FILE = 'detail_wondo_index.json';
/** 항목 형식이 바뀌면 올려서 보관 목록을 다시 만든다 */
const INDEX_VERSION = 2;

let memoryIndex: DetailWondoIndex | null = null;
let scanning: Promise<DetailWondoIndex> | null = null;

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
  const key = ['GGNR', 'DETAIL', 'WONDO', 'DIR'].join('_');
  const fromEnv = (process.env[key] ?? '').trim();
  if (fromEnv) return resolveGgnrDataPath(fromEnv);
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.detailWondo);
}

function indexFilePath(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.meta, INDEX_FILE);
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
  const parts = title.split(/\s+/).filter(Boolean);
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

async function walk(rootDir: string, relDir: string, out: DetailWondoItem[]): Promise<void> {
  const absDir = relDir ? path.join(rootDir, ...relDir.split('/')) : rootDir;
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const decoder = new TextDecoder('euc-kr');

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.fitimage')) continue;
    const base = entry.name.slice(0, -'.fitimage'.length);
    const jpgName = [`${base}.jpg`, `${base}.JPG`, `${base}.jpeg`].find((n) => fileNames.has(n));
    if (!jpgName) continue;
    try {
      const xml = decoder.decode(await fs.readFile(path.join(absDir, entry.name)));
      const parsed = parseFitimage(xml);
      if (!parsed) continue;
      const pnu = /^(\d{19})_/.exec(base)?.[1] ?? '';
      out.push({
        ...parsed,
        name: parsed.name || base,
        eupmyeon: parsed.eupmyeon || eupmyeonOfDir(relDir),
        id: relDir ? `${relDir}/${jpgName}` : jpgName,
        category: categoryOf(relDir),
        pnu,
      });
    } catch {
      /* 좌표 파일이 깨진 원도는 목록에서 제외 */
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.toLowerCase().endsWith('.tile')) continue;
    await walk(rootDir, relDir ? `${relDir}/${entry.name}` : entry.name, out);
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

async function scanIndex(): Promise<DetailWondoIndex> {
  const rootDir = detailWondoRootDir();
  try {
    await fs.access(rootDir);
  } catch {
    throwHttp(404, `세부원도 폴더를 찾을 수 없습니다: ${rootDir}`);
  }
  const items: DetailWondoItem[] = [];
  await walk(rootDir, '', items);
  items.sort(compareItems);
  const index: DetailWondoIndex = {
    version: INDEX_VERSION,
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
    return parsed?.version === INDEX_VERSION && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadIndex(refresh: boolean): Promise<DetailWondoIndex> {
  if (!refresh && memoryIndex?.version === INDEX_VERSION) return memoryIndex;
  if (!refresh) {
    const saved = await readSavedIndex();
    if (saved) {
      memoryIndex = saved;
      return saved;
    }
  }
  if (!scanning) {
    scanning = scanIndex().finally(() => {
      scanning = null;
    });
  }
  memoryIndex = await scanning;
  return memoryIndex;
}

/** 원도 폴더가 있는 프로젝트에서만 지도 «세부원도» 버튼을 보인다. */
export async function available(): Promise<{ available: boolean }> {
  await requireUsr();
  if (memoryIndex) return { available: true };
  try {
    await fs.access(detailWondoRootDir());
    return { available: true };
  } catch {
    return { available: false };
  }
}

/** 원도 목록. params.refresh=true 이면 폴더를 다시 읽는다. */
export async function list(params: Params = {}): Promise<DetailWondoIndex> {
  await requireUsr();
  return loadIndex(params.refresh === true);
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
