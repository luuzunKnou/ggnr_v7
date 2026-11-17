/**
 * 수치지형도 PMTiles(v3) 읽기 — 서버 전용.
 * 데이터 폴더 `GGNR_DATA_DIR/digital_map/` 안의 `수치지형도(축척).pmtiles` 파일이 곧 서비스 단위다.
 * (확장자 대소문자 무관 — `.PMTiles` 도 인식). DB·DXF·색인 없이 이 파일만으로 서비스한다.
 * 파일은 요청마다 열고 닫는다 (재생성 시 교체가 잠기지 않도록).
 * 생성은 scripts/build-digital-map-pmtiles.ts (digitalMapPmtilesBuild.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GGNR_DATA_PATHS } from './ggnrDataPaths';
import { resolveGgnrDataDir } from './turbopackFsPath';

type Entry = { tileId: number; offset: number; length: number; run: number };

type PmFile = {
  mtimeMs: number;
  size: number;
  minZoom: number;
  maxZoom: number;
  /** [minLon, minLat, maxLon, maxLat] */
  bounds: [number, number, number, number];
  internalComp: number;
  tileComp: number;
  leafOffset: number;
  dataOffset: number;
  root: Entry[];
  leaves: Map<number, Entry[]>;
};

export type DigitalMapPmtilesTile = {
  /** 응답 본문 (encoding 이 gzip 이면 압축된 그대로) */
  body: Buffer;
  /** 'gzip' 이면 Content-Encoding 헤더로 그대로 내려준다 */
  encoding: 'gzip' | null;
};

export type DigitalMapPmtilesInfo = {
  /** 폴더 이름처럼 쓰는 파일명(확장자 제외) — 예: 수치지형도(25000) */
  name: string;
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
  sizeMB: number;
};

const HEADER_BYTES = 127;
const DIR_TTL_MS = 5_000;
const LEAF_CACHE_MAX = 400;

const fileCache = new Map<string, PmFile>();
let dirCache: { at: number; files: Map<string, string> } | null = null;

/** 서비스 폴더 (GGNR_DATA_DIR/digital_map) */
export function digitalMapRootDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.digitalMap);
}

/** `digital_map` 안의 *.pmtiles 목록 — 이름(확장자 제외) → 절대 경로 (5초 캐시) */
async function scanFiles(): Promise<Map<string, string>> {
  if (dirCache && Date.now() - dirCache.at < DIR_TTL_MS) return dirCache.files;
  const files = new Map<string, string>();
  try {
    const root = digitalMapRootDir();
    for (const ent of await fs.promises.readdir(root, { withFileTypes: true })) {
      if (!ent.isFile() || !/\.pmtiles$/i.test(ent.name)) continue;
      files.set(ent.name.replace(/\.pmtiles$/i, ''), path.join(root, ent.name));
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('[digitalMap/pmtiles] 폴더 확인 실패', e instanceof Error ? e.message : e);
    }
  }
  dirCache = { at: Date.now(), files };
  return files;
}

function readVarint(buf: Buffer, pos: { p: number }): number {
  let result = 0;
  let mul = 1;
  for (;;) {
    if (pos.p >= buf.length) throw new Error('PMTiles 디렉터리가 손상되었습니다.');
    const b = buf[pos.p++];
    result += (b & 0x7f) * mul;
    if (!(b & 0x80)) return result;
    mul *= 128;
  }
}

function decompress(buf: Buffer, kind: number): Buffer {
  if (kind === 0 || kind === 1) return buf;
  if (kind === 2) return zlib.gunzipSync(buf);
  if (kind === 3) return zlib.brotliDecompressSync(buf);
  throw new Error(`지원하지 않는 PMTiles 압축 방식입니다: ${kind}`);
}

function parseDirectory(raw: Buffer): Entry[] {
  const pos = { p: 0 };
  const n = readVarint(raw, pos);
  const entries: Entry[] = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, run: 0 }));
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += readVarint(raw, pos);
    entries[i].tileId = last;
  }
  for (let i = 0; i < n; i++) entries[i].run = readVarint(raw, pos);
  for (let i = 0; i < n; i++) entries[i].length = readVarint(raw, pos);
  for (let i = 0; i < n; i++) {
    const v = readVarint(raw, pos);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

/** z/x/y → PMTiles 타일 ID (힐베르트 곡선) */
export function pmtilesTileId(z: number, x: number, y: number): number {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0;
  let xx = x;
  let yy = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xx & s) > 0 ? 1 : 0;
    const ry = (yy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        xx = n - 1 - xx;
        yy = n - 1 - yy;
      }
      [xx, yy] = [yy, xx];
    }
  }
  return acc + d;
}

async function readRange(fh: fs.promises.FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  if (bytesRead !== length) throw new Error('PMTiles 파일이 손상되었습니다.');
  return buf;
}

async function loadFile(file: string, fh: fs.promises.FileHandle, st: fs.Stats): Promise<PmFile> {
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;

  const h = await readRange(fh, 0, HEADER_BYTES);
  if (h.toString('latin1', 0, 7) !== 'PMTiles' || h[7] !== 3) {
    throw new Error('PMTiles v3 파일이 아닙니다.');
  }
  const u64 = (o: number) => Number(h.readBigUInt64LE(o));
  const internalComp = h[97];
  const root = parseDirectory(decompress(await readRange(fh, u64(8), u64(16)), internalComp));
  const pm: PmFile = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    minZoom: h[100],
    maxZoom: h[101],
    bounds: [
      h.readInt32LE(102) / 1e7,
      h.readInt32LE(106) / 1e7,
      h.readInt32LE(110) / 1e7,
      h.readInt32LE(114) / 1e7,
    ],
    internalComp,
    tileComp: h[98],
    leafOffset: u64(40),
    dataOffset: u64(56),
    root,
    leaves: new Map(),
  };
  fileCache.set(file, pm);
  return pm;
}

async function infoOf(name: string, file: string): Promise<DigitalMapPmtilesInfo | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size <= HEADER_BYTES) return null;
    fh = await fs.promises.open(file, 'r');
    const pm = await loadFile(file, fh, st);
    return {
      name,
      minZoom: pm.minZoom,
      maxZoom: pm.maxZoom,
      bounds: pm.bounds,
      sizeMB: Math.round((st.size / 1048576) * 10) / 10,
    };
  } catch (e) {
    console.warn(`[digitalMap/pmtiles] ${name} 읽기 실패`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** 서비스 중인 PMTiles 목록 (축척 숫자 순) */
export async function listDigitalMapPmtiles(): Promise<DigitalMapPmtilesInfo[]> {
  const files = await scanFiles();
  const out: DigitalMapPmtilesInfo[] = [];
  for (const [name, file] of files) {
    const info = await infoOf(name, file);
    if (info) out.push(info);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  return out;
}

/** 서비스할 PMTiles 가 하나라도 있는지 (파일 목록만 확인 — 헤더 읽기 없음) */
export async function hasDigitalMapPmtiles(): Promise<boolean> {
  return (await scanFiles()).size > 0;
}

export async function digitalMapPmtilesInfo(name: string): Promise<DigitalMapPmtilesInfo | null> {
  const file = (await scanFiles()).get(name);
  return file ? infoOf(name, file) : null;
}

export function digitalMapPmtilesCacheReset(): void {
  dirCache = null;
  fileCache.clear();
}

/** z/x/y 타일 하나 — 타일이 없으면 body 길이 0 */
export async function readDigitalMapPmtilesTile(
  name: string,
  z: number,
  x: number,
  y: number
): Promise<DigitalMapPmtilesTile> {
  const empty: DigitalMapPmtilesTile = { body: Buffer.alloc(0), encoding: null };
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 26) {
    throw new Error('타일 좌표가 올바르지 않습니다.');
  }
  const maxIdx = 2 ** z;
  if (x < 0 || y < 0 || x >= maxIdx || y >= maxIdx) throw new Error('타일 좌표가 올바르지 않습니다.');

  const file = (await scanFiles()).get(name);
  if (!file) throw new Error('수치지형도 PMTiles 파일이 없습니다.');
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = await fh.stat();
    const pm = await loadFile(file, fh, st);
    if (z < pm.minZoom || z > pm.maxZoom) return empty;

    const id = pmtilesTileId(z, x, y);
    let entries = pm.root;
    for (let depth = 0; depth < 4; depth++) {
      let lo = 0;
      let hi = entries.length - 1;
      let found: Entry | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (entries[mid].tileId <= id) {
          found = entries[mid];
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (!found) return empty;

      if (found.run > 0) {
        if (id >= found.tileId + found.run) return empty;
        const raw = await readRange(fh, pm.dataOffset + found.offset, found.length);
        if (pm.tileComp === 2) return { body: raw, encoding: 'gzip' };
        return { body: decompress(raw, pm.tileComp), encoding: null };
      }

      let leaf = pm.leaves.get(found.offset);
      if (!leaf) {
        leaf = parseDirectory(
          decompress(await readRange(fh, pm.leafOffset + found.offset, found.length), pm.internalComp)
        );
        if (pm.leaves.size >= LEAF_CACHE_MAX) pm.leaves.clear();
        pm.leaves.set(found.offset, leaf);
      }
      entries = leaf;
    }
    return empty;
  } finally {
    await fh.close().catch(() => {});
  }
}
