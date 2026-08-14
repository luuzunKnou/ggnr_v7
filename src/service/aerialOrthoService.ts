/**
 * 드론영상(TIF) 변환·목록 보조 — aerial/ortho/{folder}/ + layer.tif_unit
 * 자체항공(tiles_jpg)과 분리. 변환 엔진은 orthophotoService 재사용.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/database/db';
import { tifUnit } from '@/database/schema/tif_unit';
import { workUnit } from '@/database/schema/work_unit';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  aerialWorkUnitRelativeDir,
  isAerialUploadKind,
  sanitizeAerialFolderName,
} from '@/lib/aerialUploadPaths';
import { detectTifSourceCrs, runAerialOrthoTifToXyz } from '@/service/orthophotoService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireSession(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getBaseDir(): string {
  return GGNR_DATA_DIR;
}

function resolveWithinBase(relativeDir: string): { abs: string; rel: string } | null {
  const baseResolved = path.resolve(getBaseDir());
  const segments = relativeDir.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '.' || seg === '..')) return null;
  const abs = path.resolve(baseResolved, ...segments);
  if (abs !== baseResolved && !abs.startsWith(baseResolved + path.sep)) return null;
  return { abs, rel: segments.join('/') };
}

/** 파일명 → xyz 하위 폴더명 (영문·숫자·_- 만) */
export function sanitizeTifOutputSlug(fileName: string): string {
  const stem = path.basename(fileName).replace(/\.(tiff|tif)$/i, '');
  const s = stem
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  if (!s) return 'ortho_tif';
  if (/^\d+$/.test(s)) return `tif_${s}`;
  return s;
}

/** 폴더명에서 CRS 추출 — …_드론영상_5181_… */
export function sourceCrsFromOrthoFolderName(folderName: string): string {
  const parts = folderName.split('_');
  for (const p of parts) {
    if (/^\d{4,5}$/.test(p)) return `EPSG:${p}`;
  }
  return 'EPSG:5181';
}

function formatSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export type OrthoTifItem = {
  tuKey: number;
  wuKey: number;
  fileName: string;
  relativePath: string;
  fileSize: number | null;
  sizeLabel: string;
  format: string;
  convertStatus: string;
  tilesRelativePath: string | null;
  sourceCrs: string | null;
  previewKind: 'tif';
};

function toOrthoItem(row: typeof tifUnit.$inferSelect): OrthoTifItem {
  return {
    tuKey: row.tuKey,
    wuKey: row.wuKey,
    fileName: row.fileName,
    relativePath: row.relativePath,
    fileSize: row.fileSize,
    sizeLabel: formatSizeLabel(row.fileSize),
    format: path.extname(row.fileName).replace(/^\./, '').toLowerCase() || 'tif',
    convertStatus: row.convertStatus,
    tilesRelativePath: row.tilesRelativePath,
    sourceCrs: row.sourceCrs,
    previewKind: 'tif',
  };
}

export async function listOrthoWorkUnits(): Promise<{
  units: Array<{
    wuKey: number;
    kind: string;
    folderName: string;
    workName: string;
    workDate: string | null;
    fileCount: number;
    srKey: number | null;
    items: OrthoTifItem[];
  }>;
}> {
  await requireSession();
  const unitsRows = await db
    .select()
    .from(workUnit)
    .where(and(eq(workUnit.kind, 'ortho'), eq(workUnit.wuIsDel, false)))
    .orderBy(desc(workUnit.wuKey));

  const units = [];
  for (const wu of unitsRows) {
    const files = await db
      .select()
      .from(tifUnit)
      .where(and(eq(tifUnit.wuKey, wu.wuKey), eq(tifUnit.tuIsDel, false)))
      .orderBy(asc(tifUnit.tuKey));
    units.push({
      wuKey: wu.wuKey,
      kind: wu.kind,
      folderName: wu.folderName,
      workName: wu.workName,
      workDate: wu.wuCreateDate ? String(wu.wuCreateDate).slice(0, 10) : null,
      fileCount: files.length,
      srKey: wu.srKey,
      items: files.map(toOrthoItem),
    });
  }
  return { units };
}

export async function listOrthoWorkUnitTifs(params: {
  wuKey?: number;
  folderName?: string;
} = {}): Promise<{ wuKey: number; folderName: string; items: OrthoTifItem[] }> {
  await requireSession();
  let wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '');

  let wu =
    wuKey != null
      ? (
          await db
            .select()
            .from(workUnit)
            .where(and(eq(workUnit.wuKey, wuKey), eq(workUnit.wuIsDel, false)))
            .limit(1)
        )[0]
      : undefined;

  if (!wu && folderRaw) {
    wu = (
      await db
        .select()
        .from(workUnit)
        .where(
          and(
            eq(workUnit.kind, 'ortho'),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu) throwHttp(404, '작업단위를 찾을 수 없습니다.');

  const files = await db
    .select()
    .from(tifUnit)
    .where(and(eq(tifUnit.wuKey, wu.wuKey), eq(tifUnit.tuIsDel, false)))
    .orderBy(asc(tifUnit.tuKey));

  return { wuKey: wu.wuKey, folderName: wu.folderName, items: files.map(toOrthoItem) };
}

/**
 * 작업단위의 pending/failed TIF를 순차 변환.
 * 업로드 직후 큐에서 호출.
 */
export async function convertOrthoWorkUnit(params: {
  wuKey?: number;
  folderName?: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
  /** true면 변환완료 건도 다시 변환 */
  force?: boolean;
} = {}): Promise<{
  wuKey: number;
  folderName: string;
  converted: number;
  failed: number;
  items: OrthoTifItem[];
}> {
  const usrId = await requireSession();
  let wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '');

  let wu =
    wuKey != null
      ? (
          await db
            .select()
            .from(workUnit)
            .where(and(eq(workUnit.wuKey, wuKey), eq(workUnit.wuIsDel, false)))
            .limit(1)
        )[0]
      : undefined;

  if (!wu && folderRaw) {
    wu = (
      await db
        .select()
        .from(workUnit)
        .where(
          and(
            eq(workUnit.kind, 'ortho'),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu || wu.kind !== 'ortho') throwHttp(404, '드론영상 작업단위를 찾을 수 없습니다.');
  wuKey = wu.wuKey;

  const rows = await db
    .select()
    .from(tifUnit)
    .where(and(eq(tifUnit.wuKey, wuKey), eq(tifUnit.tuIsDel, false)))
    .orderBy(asc(tifUnit.tuKey));

  let converted = 0;
  let failed = 0;
  const defaultCrs = sourceCrsFromOrthoFolderName(wu.folderName);

  for (const row of rows) {
    if (row.convertStatus === 'converting') continue;

    const srcRel = row.relativePath.replace(/\\/g, '/');
    const srcResolved = resolveWithinBase(srcRel);
    if (!srcResolved) {
      if (row.convertStatus === 'pending' || row.convertStatus === 'failed' || params.force) {
        await db
          .update(tifUnit)
          .set({
            convertStatus: 'failed',
            convertError: '원본 경로가 올바르지 않습니다.',
            convertFinishedAt: nowIso(),
            tuUpdateDate: nowIso(),
            tuUpdateUser: usrId,
          })
          .where(eq(tifUnit.tuKey, row.tuKey));
        failed += 1;
      }
      continue;
    }

    /** 파일 메타 CRS 우선 → DB → 폴더명 */
    const detected = await detectTifSourceCrs(srcResolved.abs);
    const sourceCrs = detected || row.sourceCrs || defaultCrs;
    const crsMismatch =
      row.convertStatus === 'done' &&
      !!detected &&
      !!row.sourceCrs &&
      detected.toUpperCase() !== row.sourceCrs.toUpperCase();
    /** 예전 JPEG 타일(알파→검정)이면 PNG로 재변환 */
    let jpegTilesLegacy = false;
    if (row.convertStatus === 'done' && row.tilesRelativePath) {
      const tilesResolved = resolveWithinBase(row.tilesRelativePath.replace(/\\/g, '/'));
      if (tilesResolved) {
        try {
          const zoomDirs = await fs.readdir(tilesResolved.abs, { withFileTypes: true });
          const zDir = zoomDirs.find((d) => d.isDirectory() && /^\d+$/.test(d.name));
          if (zDir) {
            const xRoot = path.join(tilesResolved.abs, zDir.name);
            const xDirs = await fs.readdir(xRoot, { withFileTypes: true });
            const xDir = xDirs.find((d) => d.isDirectory());
            if (xDir) {
              const yFiles = await fs.readdir(path.join(xRoot, xDir.name));
              jpegTilesLegacy = yFiles.some((n) => /\.jpe?g$/i.test(n));
            }
          }
        } catch {
          jpegTilesLegacy = false;
        }
      }
    }
    const shouldConvert =
      row.convertStatus === 'pending' ||
      row.convertStatus === 'failed' ||
      params.force === true ||
      crsMismatch ||
      jpegTilesLegacy;

    if (!shouldConvert) continue;

    const slug = sanitizeTifOutputSlug(row.fileName);
    const tilesRel = `aerial/ortho/${wu.folderName}/xyz/${slug}`;

    await db
      .update(tifUnit)
      .set({
        convertStatus: 'converting',
        convertError: null,
        convertStartedAt: nowIso(),
        sourceCrs,
        tuUpdateDate: nowIso(),
        tuUpdateUser: usrId,
      })
      .where(eq(tifUnit.tuKey, row.tuKey));

    const result = await runAerialOrthoTifToXyz({
      absSource: srcResolved.abs,
      sourceRelativePath: srcRel,
      sourceCrs,
      outputRelativeDir: tilesRel,
      zoomMin: params.zoomMin,
      zoomMax: params.zoomMax,
      jpegQuality: params.jpegQuality,
    });

    if (result.success) {
      await db
        .update(tifUnit)
        .set({
          convertStatus: 'done',
          tilesRelativePath: tilesRel,
          sourceCrs,
          convertError: null,
          convertFinishedAt: nowIso(),
          tuUpdateDate: nowIso(),
          tuUpdateUser: usrId,
        })
        .where(eq(tifUnit.tuKey, row.tuKey));
      converted += 1;
    } else {
      await db
        .update(tifUnit)
        .set({
          convertStatus: 'failed',
          sourceCrs,
          convertError: (result.error || '변환 실패').slice(0, 2000),
          convertFinishedAt: nowIso(),
          tuUpdateDate: nowIso(),
          tuUpdateUser: usrId,
        })
        .where(eq(tifUnit.tuKey, row.tuKey));
      failed += 1;
    }
  }

  const items = (
    await db
      .select()
      .from(tifUnit)
      .where(and(eq(tifUnit.wuKey, wuKey), eq(tifUnit.tuIsDel, false)))
      .orderBy(asc(tifUnit.tuKey))
  ).map(toOrthoItem);

  return { wuKey, folderName: wu.folderName, converted, failed, items };
}

/** 변환완료 TIF 타일 범위 (WGS84) — 체크 시 지도 fit 용 */
export async function getOrthoTifExtentWgs84(params: { tuKey?: number } = {}): Promise<{
  tuKey: number;
  minLon: number | null;
  minLat: number | null;
  maxLon: number | null;
  maxLat: number | null;
}> {
  await requireSession();
  const tuKey =
    params.tuKey != null && Number.isFinite(Number(params.tuKey)) ? Number(params.tuKey) : null;
  if (tuKey == null) throwHttp(400, 'TIF 키가 필요합니다.');

  const row = (
    await db
      .select()
      .from(tifUnit)
      .where(and(eq(tifUnit.tuKey, tuKey), eq(tifUnit.tuIsDel, false)))
      .limit(1)
  )[0];
  if (!row?.tilesRelativePath || row.convertStatus !== 'done') {
    return { tuKey, minLon: null, minLat: null, maxLon: null, maxLat: null };
  }

  const tilesRel = row.tilesRelativePath.replace(/\\/g, '/');
  const resolved = resolveWithinBase(tilesRel);
  if (!resolved) {
    return { tuKey, minLon: null, minLat: null, maxLon: null, maxLat: null };
  }

  const extent = await readXyzPyramidWgs84(resolved.abs);
  return { tuKey, ...extent };
}

function tileXyToLonLat(z: number, x: number, y: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lon, lat: (latRad * 180) / Math.PI };
}

async function readXyzPyramidWgs84(groupDir: string): Promise<{
  minLon: number | null;
  minLat: number | null;
  maxLon: number | null;
  maxLat: number | null;
}> {
  let zoomNames: string[] = [];
  try {
    const entries = await fs.readdir(groupDir, { withFileTypes: true });
    zoomNames = entries.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);
  } catch {
    return { minLon: null, minLat: null, maxLon: null, maxLat: null };
  }
  const zooms = zoomNames.map(Number);
  if (zooms.length === 0) {
    return { minLon: null, minLat: null, maxLon: null, maxLat: null };
  }
  /** 최저줌 타일 1장이 수 km를 덮어 fit 시 영상이 점으로 안 보임 → 최고줌으로 범위 산출 */
  const z = Math.max(...zooms);
  const zDir = path.join(groupDir, String(z));
  let xNames: string[] = [];
  try {
    const xDirs = await fs.readdir(zDir, { withFileTypes: true });
    xNames = xDirs.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);
  } catch {
    return { minLon: null, minLat: null, maxLon: null, maxLat: null };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const xName of xNames) {
    const x = Number(xName);
    xs.push(x);
    try {
      const yFiles = await fs.readdir(path.join(zDir, xName));
      for (const yf of yFiles) {
        const m = /^(\d+)\./.exec(yf);
        if (m) ys.push(Number(m[1]));
      }
    } catch {
      /* ignore */
    }
  }
  if (xs.length === 0 || ys.length === 0) {
    return { minLon: null, minLat: null, maxLon: null, maxLat: null };
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const nw = tileXyToLonLat(z, minX, minY);
  const se = tileXyToLonLat(z, maxX + 1, maxY + 1);
  return {
    minLon: Math.min(nw.lon, se.lon),
    maxLon: Math.max(nw.lon, se.lon),
    minLat: Math.min(nw.lat, se.lat),
    maxLat: Math.max(nw.lat, se.lat),
  };
}

export async function deleteTifUnit(params: { tuKey?: number } = {}): Promise<{
  tuKey: number;
  wuKey: number;
  fileName: string;
  diskRemoved: boolean;
}> {
  await requireSession();
  const tuKey =
    params.tuKey != null && Number.isFinite(Number(params.tuKey)) ? Number(params.tuKey) : null;
  if (tuKey == null) throwHttp(400, 'TIF 키가 필요합니다.');

  const row = (
    await db.select().from(tifUnit).where(eq(tifUnit.tuKey, tuKey)).limit(1)
  )[0];
  if (!row || row.tuIsDel) throwHttp(404, 'TIF를 찾을 수 없습니다.');

  await db.delete(tifUnit).where(eq(tifUnit.tuKey, tuKey));

  let diskRemoved = false;
  const srcResolved = resolveWithinBase(row.relativePath.replace(/\\/g, '/'));
  if (srcResolved) {
    try {
      await fs.rm(srcResolved.abs, { force: true });
      diskRemoved = true;
    } catch {
      diskRemoved = false;
    }
  }
  if (row.tilesRelativePath) {
    const tilesResolved = resolveWithinBase(row.tilesRelativePath.replace(/\\/g, '/'));
    if (tilesResolved) {
      await fs.rm(tilesResolved.abs, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { tuKey, wuKey: row.wuKey, fileName: row.fileName, diskRemoved };
}

/** 작업단위 삭제 시 tif_unit 일괄 제거 (disk는 호출측에서 폴더 rm) */
export async function deleteTifUnitsForWorkUnit(wuKey: number): Promise<number> {
  const rows = await db.select({ tuKey: tifUnit.tuKey }).from(tifUnit).where(eq(tifUnit.wuKey, wuKey));
  await db.delete(tifUnit).where(eq(tifUnit.wuKey, wuKey));
  return rows.length;
}

export function isOrthoTifFileName(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.tif' || ext === '.tiff';
}

export async function insertOrthoTifUnit(params: {
  wuKey: number;
  fileName: string;
  relativePath: string;
  fileSize: number | null;
  sourceCrs: string;
  usrId: string;
}): Promise<OrthoTifItem> {
  const now = nowIso();
  const [row] = await db
    .insert(tifUnit)
    .values({
      wuKey: params.wuKey,
      fileName: params.fileName,
      relativePath: params.relativePath,
      fileSize: params.fileSize,
      convertStatus: 'pending',
      sourceCrs: params.sourceCrs,
      tuIsDel: false,
      tuCreateDate: now,
      tuCreateUser: params.usrId,
      tuUpdateDate: now,
      tuUpdateUser: params.usrId,
    })
    .returning();
  if (!row) throwHttp(500, 'TIF 등록에 실패했습니다.');
  return toOrthoItem(row);
}

/** 경로 검증용 re-export */
export { aerialWorkUnitRelativeDir, isAerialUploadKind, sanitizeAerialFolderName };
