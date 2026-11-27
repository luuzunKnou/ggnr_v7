/**
 * 나의지도 — 개인 SHP/Excel 레이어 생성·목록·수정·삭제
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getSessionUsrId } from '@/lib/auth/guard';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { safeTableName } from '@/lib/shpTableName';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '@/lib/defineLayerTableRowOrder';
import { db } from '@/database/db';
import {
  createTableFromExcel,
  createDefineTableAndFieldsForExcel,
  getPnuFromAddress,
  getJijukGeomByPnu,
  type ExcelColumnDef,
  type ExcelRowInput,
} from '@/service/excelUploadService';
import {
  createTableFromShp,
  createDefineTableAndFieldsByTableName,
  createGeoServerLayerForTableName,
  createGeoServerStyleForTableName,
  exportLayerTableToShp,
  getShpGeometryType,
  type ShpGeometryType,
} from '@/service/shpUploadService';
import { deletePublishedGeoServerLayer } from '@/service/devTestService';

const DEFINE_LAYER_TABLES_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');
const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

function usrToken(usrId: string): string {
  return safeTableName(usrId).slice(0, 24) || 'user';
}

function buildTableName(usrId: string, layerKey: string): string {
  const key = safeTableName(layerKey);
  if (!key) throwHttp(400, '영문명이 올바르지 않습니다.');
  return `user_${usrToken(usrId)}_${key}`;
}

export type MyMapStyle = {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  pointRadius?: number;
};

export type MyMapLayerRecord = {
  tableName: string;
  usrId: string;
  layerKey: string;
  layerName: string;
  layerGroup: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON' | string;
  source: 'shp' | 'excel';
  coorStand: 'geometry' | 'XY' | 'ADDR';
  style: MyMapStyle;
  createdAt: string;
  updatedAt?: string;
};

type RegistryFile = { layers: MyMapLayerRecord[] };

function registryPath(): string {
  return path.join(resolveGgnrDataDir(), 'my_map', 'registry.json');
}

async function readRegistry(): Promise<RegistryFile> {
  const p = registryPath();
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || !Array.isArray(parsed.layers)) return { layers: [] };
    return { layers: parsed.layers };
  } catch {
    return { layers: [] };
  }
}

async function writeRegistry(data: RegistryFile): Promise<void> {
  const p = registryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ layers: data.layers }, null, 2), 'utf-8');
}

async function assertOwned(tableName: string, usrId: string): Promise<MyMapLayerRecord> {
  const reg = await readRegistry();
  const hit = reg.layers.find((l) => l.tableName === tableName && l.usrId === usrId);
  if (!hit) throwHttp(404, '레이어를 찾을 수 없습니다.');
  return hit;
}

async function patchTablesJsonGroup(tableName: string, korName: string, group: string, geomType: string) {
  let tables: Record<string, unknown>[] = [];
  try {
    const raw = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) tables = parsed;
  } catch {
    /* missing */
  }
  const name = tableName.toLowerCase();
  const existing = tables.find((r) => String(r.define_table_name ?? '').trim().toLowerCase() === name);
  const shpType =
    geomType.toUpperCase().includes('POINT')
      ? 'POINT'
      : geomType.toUpperCase().includes('LINE')
        ? 'LINE'
        : 'POLYGON';
  if (!existing) {
    tables.push(
      reorderDefineLayerTableRow({
        define_table_name: tableName,
        define_table_kor_name: korName,
        define_table_shp_type: shpType,
        define_table_read_share: 'P',
        define_table_write_share: 'P',
        define_table_group: group || '나의지도',
        define_table_idx: '0',
        define_table_etc: 'mymap',
        define_table_schema: 'layer',
        define_table_source: 'mymap',
      })
    );
  } else {
    existing.define_table_kor_name = korName;
    existing.define_table_group = group || '나의지도';
    existing.define_table_read_share = 'P';
    existing.define_table_write_share = 'P';
    existing.define_table_etc = 'mymap';
    existing.define_table_source = 'mymap';
    existing.define_table_shp_type = shpType;
  }
  await fs.mkdir(path.dirname(DEFINE_LAYER_TABLES_PATH), { recursive: true });
  await fs.writeFile(
    DEFINE_LAYER_TABLES_PATH,
    JSON.stringify(reorderDefineLayerTablesArray(tables), null, 2),
    'utf-8'
  );
}

async function removeTablesJsonEntry(tableName: string) {
  let tables: Record<string, unknown>[] = [];
  try {
    const raw = await fs.readFile(DEFINE_LAYER_TABLES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) tables = parsed;
  } catch {
    return;
  }
  const name = tableName.toLowerCase();
  const next = tables.filter((r) => String(r.define_table_name ?? '').trim().toLowerCase() !== name);
  if (next.length === tables.length) return;
  await fs.writeFile(
    DEFINE_LAYER_TABLES_PATH,
    JSON.stringify(reorderDefineLayerTablesArray(next), null, 2),
    'utf-8'
  );
  const fieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName}.json`);
  try {
    await fs.unlink(fieldsPath);
  } catch {
    /* ignore */
  }
}

async function writeFieldsJson(
  tableName: string,
  columns: Array<{
    name: string;
    korName: string;
    isKey?: boolean;
    showList?: boolean;
  }>
) {
  const fieldsPath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName}.json`);
  await fs.mkdir(path.dirname(fieldsPath), { recursive: true });
  let idx = 1;
  const fieldList: Record<string, unknown>[] = [
    {
      define_field_name: 'gid',
      define_field_kor_name: '번호',
      define_field_type: 'NUMBER',
      define_field_idx: idx++,
      define_field_show_list: false,
      define_field_show_detail: true,
      define_field_is_key: false,
    },
    {
      define_field_name: 'geom',
      define_field_kor_name: 'geom',
      define_field_type: 'TEXT',
      define_field_idx: idx++,
      define_field_show_list: false,
      define_field_show_detail: false,
      define_field_is_key: false,
    },
  ];
  for (const col of columns) {
    const n = safeTableName(col.name);
    if (!n || n === 'gid' || n === 'geom' || n === 'id') continue;
    fieldList.push({
      define_field_name: n,
      define_field_kor_name: col.korName || n,
      define_field_type: 'TEXT',
      define_field_idx: idx++,
      define_field_show_list: !!col.showList,
      define_field_show_search: !!col.showList,
      define_field_show_detail: true,
      define_field_is_key: !!col.isKey,
    });
  }
  await fs.writeFile(fieldsPath, JSON.stringify(fieldList, null, 2), 'utf-8');
}

async function readFieldsJson(tableName: string): Promise<
  Array<{
    defineFieldName: string;
    defineFieldKorName: string;
    defineFieldIsKey: boolean;
    defineFieldShowList: boolean;
  }>
> {
  const candidates = [
    path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName}.json`),
    path.join(DEFINE_LAYER_FIELDS_DIR, `table_${tableName.toLowerCase()}.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      return arr
        .map((r: Record<string, unknown>) => ({
          defineFieldName: String(r.define_field_name ?? ''),
          defineFieldKorName: String(r.define_field_kor_name ?? r.define_field_name ?? ''),
          defineFieldIsKey: !!r.define_field_is_key,
          defineFieldShowList: !!r.define_field_show_list,
        }))
        .filter((f) => f.defineFieldName && f.defineFieldName !== 'geom');
    } catch {
      /* try next */
    }
  }
  return [];
}

async function centroidPointWktFromPolygon(wkt: string): Promise<string | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_Centroid(ST_SetSRID(ST_GeomFromText('${wkt.replace(/'/g, "''")}'), 5181))) AS wkt`
      )
    );
    const out = String((res.rows as { wkt?: string }[])[0]?.wkt ?? '').trim();
    return out || null;
  } catch {
    return null;
  }
}

async function transformPointTo5181(
  x: number,
  y: number,
  sourceEpsg: number
): Promise<string | null> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (sourceEpsg === 5181) return `POINT(${x} ${y})`;
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), ${sourceEpsg}), 5181)) AS wkt`
      )
    );
    const out = String((res.rows as { wkt?: string }[])[0]?.wkt ?? '').trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function listMyLayers(params?: { q?: string }) {
  const usrId = await requireUsr();
  const q = String(params?.q ?? '')
    .trim()
    .toLowerCase();
  const reg = await readRegistry();
  let layers = reg.layers.filter((l) => l.usrId === usrId);
  if (q) {
    layers = layers.filter(
      (l) =>
        l.layerName.toLowerCase().includes(q) ||
        l.layerGroup.toLowerCase().includes(q) ||
        l.layerKey.toLowerCase().includes(q) ||
        l.tableName.toLowerCase().includes(q)
    );
  }
  layers.sort((a, b) => {
    const g = a.layerGroup.localeCompare(b.layerGroup, 'ko');
    if (g !== 0) return g;
    return a.layerName.localeCompare(b.layerName, 'ko');
  });
  const groups: Record<string, MyMapLayerRecord[]> = {};
  for (const layer of layers) {
    const g = layer.layerGroup || '나의지도';
    if (!groups[g]) groups[g] = [];
    groups[g].push(layer);
  }
  return { layers, groups };
}

export async function getMyLayer(params: { tableName: string }) {
  const usrId = await requireUsr();
  const tableName = safeTableName(params.tableName);
  const layer = await assertOwned(tableName, usrId);
  const fields = await readFieldsJson(tableName);
  return { layer, fields };
}

export async function createFromExcel(params: {
  layerKey: string;
  layerName: string;
  layerGroup?: string;
  keyField: string;
  columns: ExcelColumnDef[];
  rows: Array<Record<string, unknown>>;
  coorStand: 'XY' | 'ADDR';
  coorX?: string;
  coorY?: string;
  coorAddr?: string;
  sourceEpsg?: number;
  geomType?: 'POINT' | 'POLYGON';
  style?: MyMapStyle;
}) {
  const usrId = await requireUsr();
  const layerKey = String(params.layerKey ?? '').trim();
  const layerName = String(params.layerName ?? '').trim();
  const layerGroup = String(params.layerGroup ?? '').trim() || '나의지도';
  const keyField = safeTableName(params.keyField);
  const coorStand = params.coorStand;
  const geomType = params.geomType === 'POLYGON' ? 'POLYGON' : 'POINT';
  const sourceEpsg = Number(params.sourceEpsg) || 5181;

  if (!layerKey || !layerName) throwHttp(400, '영문명·한글명이 필요합니다.');
  if (!keyField) throwHttp(400, '고유값 필드가 필요합니다.');
  if (!Array.isArray(params.columns) || params.columns.length === 0) {
    throwHttp(400, '컬럼이 필요합니다.');
  }
  if (coorStand === 'XY' && (!params.coorX || !params.coorY)) {
    throwHttp(400, 'X·Y 컬럼을 지정하세요.');
  }
  if (coorStand === 'ADDR' && !params.coorAddr) {
    throwHttp(400, '주소 컬럼을 지정하세요.');
  }

  const tableName = buildTableName(usrId, layerKey);
  const reg = await readRegistry();
  if (reg.layers.some((l) => l.tableName === tableName)) {
    throwHttp(409, '이미 존재하는 레이어입니다.');
  }

  const columns = params.columns.map((c) => ({
    ...c,
    define_field_name: safeTableName(c.define_field_name),
    define_field_kor_name: String(c.define_field_kor_name || c.define_field_name),
  }));

  const excelRows: ExcelRowInput[] = [];
  for (const raw of params.rows ?? []) {
    const attrs: Record<string, unknown> = {};
    for (const col of columns) {
      const n = col.define_field_name;
      attrs[n] = raw[n] ?? raw[col.define_field_name] ?? '';
    }
    if (coorStand === 'XY') {
      const xRaw = raw[params.coorX!];
      const yRaw = raw[params.coorY!];
      const x = Number(xRaw);
      const y = Number(yRaw);
      const geom = await transformPointTo5181(x, y, sourceEpsg);
      excelRows.push({
        attrs,
        parcels: geom
          ? [{ geom, address: '' }]
          : Number.isFinite(x) && Number.isFinite(y)
            ? [{ x, y }]
            : [{}],
      });
    } else {
      const address = String(raw[params.coorAddr!] ?? '').trim();
      let geom: string | null = null;
      if (address) {
        const pnu = await getPnuFromAddress(address);
        if (pnu) {
          const poly = await getJijukGeomByPnu(pnu, 5181);
          if (poly) {
            geom = geomType === 'POLYGON' ? poly : await centroidPointWktFromPolygon(poly);
          }
        }
      }
      excelRows.push({
        attrs,
        parcels: geom ? [{ geom, address }] : address ? [{ address }] : [{}],
      });
    }
  }

  const created = await createTableFromExcel({
    tableName,
    tableKorName: layerName,
    keyField,
    columns,
    geometryType: geomType === 'POLYGON' ? 'Polygon' : 'Point',
    rows: excelRows,
    geomInputSrid: 5181,
  });
  if (!created.success) throwHttp(500, created.error ?? 'Excel 레이어 생성 실패');

  await createDefineTableAndFieldsForExcel({
    tableName,
    tableKorName: layerName,
    geometryType: geomType === 'POLYGON' ? 'Polygon' : 'Point',
    columns,
    group: layerGroup,
  });
  await patchTablesJsonGroup(tableName, layerName, layerGroup, geomType);

  const gs = await createGeoServerLayerForTableName({
    tableName,
    geometryType: geomType === 'POLYGON' ? 'POLYGON' : 'POINT',
    group: layerGroup,
  });
  if (!gs.success) {
    console.warn('[myMapService] GeoServer layer:', gs.error);
  } else {
    await createGeoServerStyleForTableName({
      tableName,
      geometryType: geomType === 'POLYGON' ? 'POLYGON' : 'POINT',
      group: layerGroup,
    });
  }

  const now = new Date().toISOString();
  const record: MyMapLayerRecord = {
    tableName,
    usrId,
    layerKey: safeTableName(layerKey),
    layerName,
    layerGroup,
    geomType,
    source: 'excel',
    coorStand,
    style: params.style ?? {},
    createdAt: now,
    updatedAt: now,
  };
  reg.layers.push(record);
  await writeRegistry(reg);
  return { success: true as const, layer: record, rowCount: created.rowCount };
}

export async function saveShpBundle(params: {
  layerKey: string;
  files: Array<{ fileName: string; bytes: Buffer }>;
}): Promise<{ pathOrResult: string; absDir: string }> {
  const usrId = await requireUsr();
  const layerKey = safeTableName(params.layerKey);
  if (!layerKey) throwHttp(400, '영문명이 필요합니다.');
  const tableName = buildTableName(usrId, layerKey);
  const relDir = path.posix.join('shp_data', 'mymap', usrToken(usrId), tableName);
  const absDir = path.join(resolveGgnrDataDir(), ...relDir.split('/'));
  await fs.mkdir(absDir, { recursive: true });

  let shpBase = tableName;
  for (const f of params.files) {
    const name = path.basename(f.fileName);
    const lower = name.toLowerCase();
    const dest = path.join(absDir, name);
    await fs.writeFile(dest, f.bytes);
    if (lower.endsWith('.shp')) shpBase = name.replace(/\.shp$/i, '');
  }
  const pathOrResult = path.posix.join(relDir, `${shpBase}.shp`);
  return { pathOrResult, absDir };
}

export async function createFromShp(params: {
  layerKey: string;
  layerName: string;
  layerGroup?: string;
  pathOrResult: string;
  sourceSrsOverride?: string;
  keyField?: string;
  columns?: Array<{ name: string; korName: string; isKey?: boolean; showList?: boolean }>;
  style?: MyMapStyle;
}) {
  const usrId = await requireUsr();
  const layerKey = String(params.layerKey ?? '').trim();
  const layerName = String(params.layerName ?? '').trim();
  const layerGroup = String(params.layerGroup ?? '').trim() || '나의지도';
  if (!layerKey || !layerName) throwHttp(400, '영문명·한글명이 필요합니다.');
  if (!params.pathOrResult?.trim()) throwHttp(400, 'SHP 경로가 필요합니다.');

  const tableName = buildTableName(usrId, layerKey);
  const reg = await readRegistry();
  if (reg.layers.some((l) => l.tableName === tableName)) {
    throwHttp(409, '이미 존재하는 레이어입니다.');
  }

  const created = await createTableFromShp({
    pathOrResult: params.pathOrResult,
    sourceSrsOverride: params.sourceSrsOverride,
    dbSchema: 'layer',
    tableNameOverride: tableName,
  });
  if (!created.success) throwHttp(500, created.error ?? 'SHP 레이어 생성 실패');

  const absShp = path.join(resolveGgnrDataDir(), params.pathOrResult.replace(/\//g, path.sep));
  let geomType: ShpGeometryType = 'POLYGON';
  try {
    geomType = await getShpGeometryType(absShp);
  } catch {
    /* default */
  }

  await createDefineTableAndFieldsByTableName({
    tableName,
    geometryType: geomType,
    group: layerGroup,
  });
  await patchTablesJsonGroup(tableName, layerName, layerGroup, geomType);

  if (params.columns?.length) {
    await writeFieldsJson(tableName, params.columns);
  }

  const gs = await createGeoServerLayerForTableName({
    tableName,
    geometryType: geomType,
    group: layerGroup,
  });
  if (!gs.success) {
    console.warn('[myMapService] GeoServer layer:', gs.error);
  } else {
    await createGeoServerStyleForTableName({
      tableName,
      geometryType: geomType,
      group: layerGroup,
    });
  }

  const now = new Date().toISOString();
  const record: MyMapLayerRecord = {
    tableName,
    usrId,
    layerKey: safeTableName(layerKey),
    layerName,
    layerGroup,
    geomType,
    source: 'shp',
    coorStand: 'geometry',
    style: params.style ?? {},
    createdAt: now,
    updatedAt: now,
  };
  reg.layers.push(record);
  await writeRegistry(reg);
  return { success: true as const, layer: record };
}

export async function updateMyLayer(params: {
  tableName: string;
  layerName?: string;
  layerGroup?: string;
  fields?: Array<{
    defineFieldName: string;
    defineFieldKorName: string;
    defineFieldIsKey: boolean;
    defineFieldShowList: boolean;
  }>;
  style?: MyMapStyle;
}) {
  const usrId = await requireUsr();
  const tableName = safeTableName(params.tableName);
  const reg = await readRegistry();
  const idx = reg.layers.findIndex((l) => l.tableName === tableName && l.usrId === usrId);
  if (idx < 0) throwHttp(404, '레이어를 찾을 수 없습니다.');
  const prev = reg.layers[idx]!;
  const layerName = String(params.layerName ?? prev.layerName).trim() || prev.layerName;
  const layerGroup = String(params.layerGroup ?? prev.layerGroup).trim() || prev.layerGroup;

  if (params.fields?.length) {
    await writeFieldsJson(
      tableName,
      params.fields
        .filter((f) => f.defineFieldName && f.defineFieldName !== 'gid' && f.defineFieldName !== 'id')
        .map((f) => ({
          name: f.defineFieldName,
          korName: f.defineFieldKorName,
          isKey: f.defineFieldIsKey,
          showList: f.defineFieldShowList,
        }))
    );
  }

  await patchTablesJsonGroup(tableName, layerName, layerGroup, prev.geomType);

  const next: MyMapLayerRecord = {
    ...prev,
    layerName,
    layerGroup,
    style: params.style ?? prev.style,
    updatedAt: new Date().toISOString(),
  };
  reg.layers[idx] = next;
  await writeRegistry(reg);
  return { success: true as const, layer: next };
}

export async function deleteMyLayer(params: { tableName: string }) {
  const usrId = await requireUsr();
  const tableName = safeTableName(params.tableName);
  await assertOwned(tableName, usrId);

  try {
    await deletePublishedGeoServerLayer({ layerName: tableName });
  } catch (e) {
    console.warn('[myMapService] GeoServer delete:', e);
  }

  try {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS layer."${tableName.replace(/"/g, '""')}" CASCADE`));
  } catch (e) {
    console.warn('[myMapService] DROP TABLE:', e);
  }

  await removeTablesJsonEntry(tableName);

  const reg = await readRegistry();
  reg.layers = reg.layers.filter((l) => !(l.tableName === tableName && l.usrId === usrId));
  await writeRegistry(reg);
  return { success: true as const };
}

export async function downloadMyLayerShp(params: { tableName: string }) {
  const usrId = await requireUsr();
  const tableName = safeTableName(params.tableName);
  await assertOwned(tableName, usrId);
  const result = await exportLayerTableToShp({
    tableName,
    layerName: tableName,
    targetSrs: 'EPSG:5181',
  });
  if (!result.success) throwHttp(500, result.error ?? 'SHP 내보내기 실패');
  return result;
}

/** multipart 업로드용 — route에서 Buffer 전달 */
export async function createFromShpUpload(params: {
  layerKey: string;
  layerName: string;
  layerGroup?: string;
  sourceSrsOverride?: string;
  keyField?: string;
  columnsJson?: string;
  styleJson?: string;
  files: Array<{ fileName: string; bytes: Buffer }>;
}) {
  const { pathOrResult } = await saveShpBundle({
    layerKey: params.layerKey,
    files: params.files,
  });
  let columns: Array<{ name: string; korName: string; isKey?: boolean; showList?: boolean }> | undefined;
  let style: MyMapStyle | undefined;
  try {
    if (params.columnsJson) columns = JSON.parse(params.columnsJson);
  } catch {
    /* ignore */
  }
  try {
    if (params.styleJson) style = JSON.parse(params.styleJson);
  } catch {
    /* ignore */
  }
  return createFromShp({
    layerKey: params.layerKey,
    layerName: params.layerName,
    layerGroup: params.layerGroup,
    pathOrResult,
    sourceSrsOverride: params.sourceSrsOverride,
    keyField: params.keyField,
    columns,
    style,
  });
}

/** 개발·점검용: 레지스트리 파일 존재 여부 */
export async function getRegistryStatus() {
  await requireUsr();
  const p = registryPath();
  return { path: p, exists: fsSync.existsSync(p) };
}
