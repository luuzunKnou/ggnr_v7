import * as XLSX from 'xlsx';
import {
  EXCEL_EXTS,
  SHP_PART_EXTS,
  type ExcelLocationMode,
  type ShpPartExt,
  type UploadCrsCode,
  type UploadEncoding,
  UPLOAD_CRS_OPTIONS,
} from './userDataUploadConfig';

/** 개별 파일과 zip 내부 항목을 같은 방식으로 읽기 위한 래퍼 */
export type UploadSource = {
  path: string;
  name: string;
  ext: string;
  size: number;
  read: (maxBytes?: number) => Promise<Uint8Array>;
};

export type ShpDataset = {
  key: string;
  name: string;
  parts: Partial<Record<ShpPartExt, UploadSource>>;
};

export type UploadDetectResult =
  | { kind: 'shp'; datasets: ShpDataset[]; ignored: string[] }
  | { kind: 'excel'; file: UploadSource; ignored: string[] }
  | { kind: 'none'; message: string; ignored: string[] };

function splitExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

function decodeText(bytes: Uint8Array, encoding: UploadEncoding): string {
  return new TextDecoder(encoding).decode(bytes);
}

// ── zip ──────────────────────────────────────────────

type ZipEntry = {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
  encrypted: boolean;
};

async function listZipEntries(file: File): Promise<ZipEntry[]> {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`«${file.name}»은(는) 올바른 zip 파일이 아닙니다.`);
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    throw new Error(`«${file.name}»은(는) 4GB 이상 zip 형식이라 미리보기를 지원하지 않습니다.`);
  }
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    const name = decodeText(nameBytes, flags & 0x800 ? 'utf-8' : 'euc-kr');
    if (!name.endsWith('/')) {
      out.push({
        name,
        method: cd.getUint16(p + 10, true),
        compSize: cd.getUint32(p + 20, true),
        size: cd.getUint32(p + 24, true),
        localOffset: cd.getUint32(p + 42, true),
        encrypted: (flags & 0x1) !== 0,
      });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readStreamUpTo(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= maxBytes) await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}

async function readZipEntry(file: File, entry: ZipEntry, maxBytes?: number): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error(`암호가 걸린 zip 항목은 읽을 수 없습니다: ${entry.name}`);
  const local = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (local.getUint32(0, true) !== 0x04034b50) throw new Error(`zip 항목을 읽지 못했습니다: ${entry.name}`);
  const start = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const blob = file.slice(start, start + entry.compSize);
  const limit = maxBytes ?? entry.size;
  if (entry.method === 0) return new Uint8Array(await blob.slice(0, limit).arrayBuffer());
  if (entry.method === 8) {
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return readStreamUpTo(stream, limit);
  }
  throw new Error(`지원하지 않는 zip 압축 방식입니다: ${entry.name}`);
}

function sourceFromFile(file: File): UploadSource {
  const { ext } = splitExt(file.name);
  return {
    path: file.webkitRelativePath?.trim() || file.name,
    name: file.name,
    ext,
    size: file.size,
    read: async (maxBytes) =>
      new Uint8Array(await (maxBytes == null ? file : file.slice(0, maxBytes)).arrayBuffer()),
  };
}

/** 선택한 파일 목록을 읽기 단위로 펼친다 (zip 은 내부 항목으로) */
export async function collectUploadSources(files: File[]): Promise<UploadSource[]> {
  const out: UploadSource[] = [];
  for (const file of files) {
    if (splitExt(file.name).ext !== 'zip') {
      out.push(sourceFromFile(file));
      continue;
    }
    const entries = await listZipEntries(file);
    for (const entry of entries) {
      if (entry.name.startsWith('__MACOSX/')) continue;
      const name = entry.name.split('/').pop() ?? entry.name;
      out.push({
        path: `${file.name}/${entry.name}`,
        name,
        ext: splitExt(name).ext,
        size: entry.size,
        read: (maxBytes) => readZipEntry(file, entry, maxBytes),
      });
    }
  }
  return out;
}

export function detectUploadKind(sources: UploadSource[]): UploadDetectResult {
  const shpParts = new Set<string>(SHP_PART_EXTS);
  const excelExts = new Set<string>(EXCEL_EXTS);
  const groups = new Map<string, ShpDataset>();
  const excels: UploadSource[] = [];
  const ignored: string[] = [];

  for (const src of sources) {
    if (shpParts.has(src.ext)) {
      const { base } = splitExt(src.path);
      const key = base.toLowerCase();
      const group = groups.get(key) ?? { key, name: splitExt(src.name).base, parts: {} };
      group.parts[src.ext as ShpPartExt] = src;
      groups.set(key, group);
    } else if (excelExts.has(src.ext)) {
      excels.push(src);
    } else {
      ignored.push(src.name);
    }
  }

  if (groups.size > 0) {
    for (const ex of excels) ignored.push(ex.name);
    const datasets = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { kind: 'shp', datasets, ignored };
  }
  if (excels.length > 0) {
    for (const ex of excels.slice(1)) ignored.push(ex.name);
    return { kind: 'excel', file: excels[0]!, ignored };
  }
  return {
    kind: 'none',
    message: 'SHP(zip·개별 파일) 또는 엑셀·CSV 파일을 올려 주세요.',
    ignored,
  };
}

// ── 좌표계 ───────────────────────────────────────────

const CRS_CODES = new Set<string>(UPLOAD_CRS_OPTIONS.map((o) => o.code));

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function prjParam(text: string, name: string): number | null {
  const m = new RegExp(`PARAMETER\\[\\s*"${name}"\\s*,\\s*(-?[\\d.]+)`, 'i').exec(text);
  return m ? Number(m[1]) : null;
}

/** .prj WKT 에서 좌표계 코드를 찾는다. 못 찾으면 null */
export function detectCrsFromPrj(text: string): UploadCrsCode | null {
  const authorities = [...text.matchAll(/AUTHORITY\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi)];
  const outer = authorities.at(-1)?.[1];
  if (outer && /^\s*PROJCS/i.test(text) && CRS_CODES.has(outer)) return outer as UploadCrsCode;

  if (!/PROJCS/i.test(text)) return /GEOGCS/i.test(text) ? '4326' : null;
  if (/Mercator_Auxiliary_Sphere|Pseudo.?Mercator|Popular_Visuali[sz]ation/i.test(text)) return '3857';

  const cm = prjParam(text, 'central_meridian');
  const fn = prjParam(text, 'false_northing');
  if (cm == null || fn == null) return null;

  if (near(cm, 127.5, 0.01) && near(fn, 2000000, 1)) return '5179';
  if (/bessel/i.test(text)) {
    if (!near(fn, 500000, 1)) return null;
    if (near(cm, 127.0029, 0.01)) return '5174';
    if (near(cm, 129.0029, 0.01)) return '5176';
    return null;
  }

  const byMeridian = (table: Record<number, UploadCrsCode>) => {
    for (const [meridian, code] of Object.entries(table)) {
      if (near(cm, Number(meridian), 0.01)) return code;
    }
    return null;
  };
  if (near(fn, 500000, 1)) return byMeridian({ 125: '5180', 127: '5181', 129: '5183', 131: '5184' });
  if (near(fn, 550000, 1)) return byMeridian({ 127: '5182' });
  if (near(fn, 600000, 1)) return byMeridian({ 125: '5185', 127: '5186', 129: '5187', 131: '5188' });
  return null;
}

/** 좌표 범위 크기로 좌표계를 추정. 평면 좌표는 구분이 어려워 중부원점 2010 을 기본으로 둔다 */
export function guessCrsFromExtent(minX: number, minY: number, maxX: number, maxY: number): UploadCrsCode | null {
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90) return '4326';
  if (minX > 1.2e7 && maxX < 1.6e7 && minY > 3.5e6 && maxY < 5.5e6) return '3857';
  if (minX > 6e5 && maxX < 1.5e6 && minY > 1.3e6 && maxY < 2.3e6) return '5179';
  if (minX > -1e5 && maxX < 8e5 && minY > 0 && maxY < 1e6) return '5186';
  return null;
}

export function detectEncodingFromCpg(text: string): UploadEncoding | null {
  const t = text.trim().toUpperCase();
  if (!t) return null;
  if (t.includes('UTF') || t === '65001') return 'utf-8';
  if (/949|EUC|KS_?C|KSC|ANSI|KOREAN/.test(t)) return 'euc-kr';
  return null;
}

// ── SHP ──────────────────────────────────────────────

const SHAPE_TYPE_LABELS: Record<number, string> = {
  0: '없음',
  1: '점',
  3: '선',
  5: '면',
  8: '다중점',
  11: '점(Z)',
  13: '선(Z)',
  15: '면(Z)',
  18: '다중점(Z)',
  21: '점(M)',
  23: '선(M)',
  25: '면(M)',
  28: '다중점(M)',
};

export type ShpMeta = {
  shapeTypeLabel: string;
  extent: RawExtent | null;
  prjText: string | null;
  crs: UploadCrsCode | null;
  crsSource: 'prj' | 'extent' | null;
  encoding: UploadEncoding | null;
};

export async function readShpMeta(dataset: ShpDataset): Promise<ShpMeta> {
  let shapeTypeLabel = '알 수 없음';
  let extent: ShpMeta['extent'] = null;
  if (dataset.parts.shp) {
    const head = await dataset.parts.shp.read(100);
    if (head.byteLength >= 100) {
      const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      if (dv.getInt32(0, false) !== 9994) throw new Error('도형(.shp) 파일 형식이 올바르지 않습니다.');
      const type = dv.getInt32(32, true);
      shapeTypeLabel = SHAPE_TYPE_LABELS[type] ?? `유형 ${type}`;
      extent = [dv.getFloat64(36, true), dv.getFloat64(44, true), dv.getFloat64(52, true), dv.getFloat64(60, true)];
    }
  }

  const prjText = dataset.parts.prj ? decodeText(await dataset.parts.prj.read(), 'utf-8') : null;
  let crs = prjText ? detectCrsFromPrj(prjText) : null;
  let crsSource: ShpMeta['crsSource'] = crs ? 'prj' : null;
  if (!crs && extent) {
    crs = guessCrsFromExtent(...extent);
    crsSource = crs ? 'extent' : null;
  }

  const encoding = dataset.parts.cpg
    ? detectEncodingFromCpg(decodeText(await dataset.parts.cpg.read(), 'utf-8'))
    : null;

  return { shapeTypeLabel, extent, prjText, crs, crsSource, encoding };
}

type XY = [number, number];

/** 원본 좌표 그대로의 도형 — 좌표계 변환은 지도 쪽에서 */
export type RawPreviewGeometry =
  | { type: 'Point'; coordinates: XY }
  | { type: 'MultiPoint'; coordinates: XY[] }
  | { type: 'MultiLineString'; coordinates: XY[][] }
  | { type: 'MultiPolygon'; coordinates: XY[][][] }
  | { type: 'WKT'; text: string };

/** 링 방향 — SHP 는 외곽 링이 시계 방향, 구멍이 반시계 방향 */
function isClockwise(ring: XY[]): boolean {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += (ring[i + 1]![0] - ring[i]![0]) * (ring[i + 1]![1] + ring[i]![1]);
  }
  return sum > 0;
}

function parseShpRecord(dv: DataView, start: number): RawPreviewGeometry | null {
  const type = dv.getInt32(start, true);
  const readXY = (p: number): XY => [dv.getFloat64(p, true), dv.getFloat64(p + 8, true)];
  const base = type % 10;
  if (type === 0) return null;
  if (base === 1) return { type: 'Point', coordinates: readXY(start + 4) };
  if (base === 8) {
    const n = dv.getInt32(start + 36, true);
    return { type: 'MultiPoint', coordinates: Array.from({ length: n }, (_, i) => readXY(start + 40 + i * 16)) };
  }
  if (base !== 3 && base !== 5) return null;

  const numParts = dv.getInt32(start + 36, true);
  const numPoints = dv.getInt32(start + 40, true);
  const partsAt = start + 44;
  const pointsAt = partsAt + numParts * 4;
  const parts: XY[][] = [];
  for (let i = 0; i < numParts; i++) {
    const from = dv.getInt32(partsAt + i * 4, true);
    const to = i + 1 < numParts ? dv.getInt32(partsAt + (i + 1) * 4, true) : numPoints;
    const part: XY[] = [];
    for (let k = from; k < to; k++) part.push(readXY(pointsAt + k * 16));
    parts.push(part);
  }
  if (base === 3) return { type: 'MultiLineString', coordinates: parts };

  const polygons: XY[][][] = [];
  for (const ring of parts) {
    if (isClockwise(ring) || polygons.length === 0) polygons.push([ring]);
    else polygons[polygons.length - 1]!.push(ring);
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

/** 색인(.shx)으로 앞 limit 건의 위치를 찾아 도형(.shp)은 그 범위까지만 읽는다 */
export async function readShpPreviewGeometries(dataset: ShpDataset, limit: number): Promise<RawPreviewGeometry[]> {
  const { shp, shx } = dataset.parts;
  if (!shp || !shx) return [];
  const index = await shx.read(100 + limit * 8);
  const idx = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const records: Array<{ offset: number; length: number }> = [];
  for (let p = 100; p + 8 <= index.byteLength && records.length < limit; p += 8) {
    records.push({ offset: idx.getInt32(p, false) * 2, length: idx.getInt32(p + 4, false) * 2 });
  }
  if (!records.length) return [];
  const last = records[records.length - 1]!;
  const body = await shp.read(last.offset + 8 + last.length);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out: RawPreviewGeometry[] = [];
  for (const rec of records) {
    if (rec.offset + 8 + rec.length > body.byteLength) break;
    try {
      const geom = parseShpRecord(dv, rec.offset + 8);
      if (geom) out.push(geom);
    } catch {
      // 손상된 레코드는 미리보기에서만 건너뛴다
    }
  }
  return out;
}

export type TablePreview = {
  columns: string[];
  rows: string[][];
  totalCount: number;
};

/** .dbf 헤더·앞부분 레코드만 읽어 속성 미리보기를 만든다 */
export async function readDbfPreview(src: UploadSource, encoding: UploadEncoding, limit: number): Promise<TablePreview> {
  const head = await src.read(64 * 1024);
  if (head.byteLength < 32) throw new Error('속성(.dbf) 파일이 비어 있습니다.');
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const totalCount = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recordLen = dv.getUint16(10, true);

  const fields: Array<{ name: string; length: number }> = [];
  for (let p = 32; p + 32 <= Math.min(headerLen, head.byteLength) && head[p] !== 0x0d; p += 32) {
    const nameBytes = head.subarray(p, p + 11);
    const end = nameBytes.indexOf(0);
    fields.push({
      name: decodeText(end >= 0 ? nameBytes.subarray(0, end) : nameBytes, encoding).trim(),
      length: head[p + 16]!,
    });
  }

  const take = Math.min(totalCount, limit);
  const body = await src.read(headerLen + recordLen * take);
  const decoder = new TextDecoder(encoding);
  const rows: string[][] = [];
  for (let i = 0; i < take; i++) {
    const start = headerLen + i * recordLen;
    if (start + recordLen > body.byteLength) break;
    let offset = start + 1;
    const row: string[] = [];
    for (const field of fields) {
      row.push(decoder.decode(body.subarray(offset, offset + field.length)).replace(/\0/g, '').trim());
      offset += field.length;
    }
    rows.push(row);
  }
  return { columns: fields.map((f) => f.name), rows, totalCount };
}

// ── 엑셀 ─────────────────────────────────────────────

export async function readExcelWorkbook(src: UploadSource): Promise<XLSX.WorkBook> {
  const bytes = await src.read();
  if (src.ext !== 'csv') return XLSX.read(bytes, { type: 'array' });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = decodeText(bytes, 'euc-kr');
  }
  return XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string' });
}

export function readSheetMatrix(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false }) as unknown[][];
  return raw.map((row) => row.map((v) => String(v ?? '').trim()));
}

/** headerRow 는 1부터. 빈 머리글은 «열N», 중복은 «_2» 를 붙인다 */
export function buildExcelTable(matrix: string[][], headerRow: number): TablePreview {
  const header = matrix[headerRow - 1] ?? [];
  const width = Math.max(header.length, ...matrix.slice(headerRow).map((r) => r.length), 0);
  const seen = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, i) => {
    const base = header[i]?.trim() || `열${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  const rows = matrix
    .slice(headerRow)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return { columns, rows, totalCount: rows.length };
}

export type ExcelColumnPick = { x: number; y: number; address: number; wkt: number };

export function autoPickExcelColumns(columns: string[]): ExcelColumnPick {
  const norm = columns.map((c) => c.replace(/\s+/g, '').toLowerCase());
  const find = (test: (c: string) => boolean) => norm.findIndex(test);
  return {
    x: find((c) => /^(x|lon|lng|long|longitude|xcoord|x_coord|x좌표|좌표x)$/.test(c) || c.includes('경도')),
    y: find((c) => /^(y|lat|latitude|ycoord|y_coord|y좌표|좌표y)$/.test(c) || c.includes('위도')),
    address: find((c) => c.includes('주소') || c.includes('소재지') || c.includes('지번')),
    wkt: find((c) => /wkt|geom/.test(c) || c.includes('도형')),
  };
}

export function parseCoordNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/,/g, '').trim());
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

const WKT_RE = /^\s*(?:SRID=\d+;)?\s*(MULTI)?(POINT|LINESTRING|POLYGON)\b/i;
const WKT_GEOM_LABELS: Record<string, string> = { POINT: '점', LINESTRING: '선', POLYGON: '면' };

export type RawExtent = [number, number, number, number];

export type ExcelLocationStats = {
  valid: number;
  invalid: number;
  geomLabel: string;
  crsGuess: UploadCrsCode | null;
  swapped: boolean;
  /** 앞쪽 표본 좌표의 원시 범위 */
  extent: RawExtent | null;
};

/** 위치 지정 방식별로 위치를 만들 수 있는 행 수와 좌표계 추정을 계산한다 */
export function analyzeExcelLocation(
  rows: string[][],
  mode: ExcelLocationMode,
  pick: ExcelColumnPick
): ExcelLocationStats {
  let valid = 0;
  let geomLabel = '—';
  const xs: number[] = [];
  const ys: number[] = [];

  for (const row of rows) {
    if (mode === 'coords') {
      const x = parseCoordNumber(row[pick.x]);
      const y = parseCoordNumber(row[pick.y]);
      if (x == null || y == null) continue;
      valid++;
      if (xs.length < 500) {
        xs.push(x);
        ys.push(y);
      }
    } else if (mode === 'address') {
      if ((row[pick.address] ?? '').trim()) valid++;
    } else {
      const m = WKT_RE.exec(row[pick.wkt] ?? '');
      if (!m) continue;
      valid++;
      if (geomLabel === '—') geomLabel = WKT_GEOM_LABELS[m[2]!.toUpperCase()] ?? '—';
      const nums = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(row[pick.wkt]!.slice(m[0].length));
      if (nums && xs.length < 500) {
        xs.push(Number(nums[1]));
        ys.push(Number(nums[2]));
      }
    }
  }

  if (mode === 'coords' && valid > 0) geomLabel = '점';
  if (mode === 'address' && valid > 0) geomLabel = '면 (필지)';

  let crsGuess: UploadCrsCode | null = null;
  let swapped = false;
  let extent: RawExtent | null = null;
  if (xs.length) {
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    swapped = minX >= 30 && maxX <= 45 && minY >= 120 && maxY <= 135;
    crsGuess = swapped ? '4326' : guessCrsFromExtent(minX, minY, maxX, maxY);
    extent = [minX, minY, maxX, maxY];
  }

  return { valid, invalid: rows.length - valid, geomLabel, crsGuess, swapped, extent };
}

/** 엑셀 앞쪽 행에서 지도 미리보기용 도형을 만든다. 주소 방식은 서버 조회가 필요해 제외 */
export function buildExcelPreviewGeometries(
  rows: string[][],
  mode: ExcelLocationMode,
  pick: ExcelColumnPick,
  limit: number
): RawPreviewGeometry[] {
  const out: RawPreviewGeometry[] = [];
  if (mode === 'address') return out;
  for (const row of rows) {
    if (out.length >= limit) break;
    if (mode === 'coords') {
      const x = parseCoordNumber(row[pick.x]);
      const y = parseCoordNumber(row[pick.y]);
      if (x != null && y != null) out.push({ type: 'Point', coordinates: [x, y] });
    } else {
      const text = row[pick.wkt] ?? '';
      if (WKT_RE.test(text)) out.push({ type: 'WKT', text: text.replace(/^\s*SRID=\d+;/i, '') });
    }
  }
  return out;
}
