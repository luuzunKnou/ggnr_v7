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
import { isSuperUser } from '@/lib/auth/superUser';
import {
  aerialWorkUnitRelativeDir,
  isAerialUploadKind,
  sanitizeAerialFolderName,
} from '@/lib/aerialUploadPaths';
import { detectTifSourceCrs, runAerialOrthoTifToXyz, runAerialSatelliteTifToXyz } from '@/service/orthophotoService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

/** 드론영상 표시 줌 제한 설정 파일 (DB 없이 공통 반영) */
const ORTHO_ZOOM_LIMIT_REL = path.join('config', 'aerial_ortho_zoom_limit.json');
const ORTHO_ZOOM_LIMIT_DEFAULT_MAX = 16;
const ORTHO_ZOOM_FULL_MAX = 19;

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

/** 폴더명에서 CRS 추출 — …_드론영상_5181_… / …_항공영상_5181_… */
export function sourceCrsFromOrthoFolderName(folderName: string): string {
  const parts = folderName.split('_');
  for (const p of parts) {
    if (/^\d{4,5}$/.test(p)) return `EPSG:${p}`;
  }
  return 'EPSG:5181';
}

/**
 * 자체항공영상 배경지도 id (= tiles_jpg 폴더명)
 * satellite_YYYY_CRS_slug  — slug 는 영문·숫자만 (한글 작업명은 wu키로 대체)
 */
export function satelliteGroupNameFromWorkUnit(params: {
  folderName: string;
  wuKey: number;
  fileName?: string;
}): string {
  const parts = params.folderName.split('_');
  const dateRaw = parts[0] ?? '';
  const year = /^\d{8}$/.test(dateRaw) ? dateRaw.slice(0, 4) : String(new Date().getFullYear());
  const crsPart = parts.find((p) => /^\d{4,5}$/.test(p)) ?? '5181';
  const stem = params.fileName
    ? path.basename(params.fileName).replace(/\.(tiff|tif)$/i, '')
    : parts.slice(3).join('_');
  let slug = stem
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  if (!slug) slug = `wu${params.wuKey}`;
  if (/^\d+$/.test(slug)) slug = `t${slug}`;
  return `satellite_${year}_${crsPart}_${slug}`;
}

type TifWorkKind = 'ortho' | 'satellite';

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

export async function listOrthoWorkUnits(
  kind: TifWorkKind = 'ortho'
): Promise<{
  units: Array<{
    wuKey: number;
    kind: string;
    folderName: string;
    workName: string;
    workDate: string | null;
    fileCount: number;
    srKey: number | null;
    workPurpose: string | null;
    author: string | null;
    memo: string | null;
    items: OrthoTifItem[];
  }>;
}> {
  await requireSession();
  const unitsRows = await db
    .select()
    .from(workUnit)
    .where(and(eq(workUnit.kind, kind), eq(workUnit.wuIsDel, false)))
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
      workDate: wu.workDate ?? (wu.wuCreateDate ? String(wu.wuCreateDate).slice(0, 10) : null),
      fileCount: files.length,
      srKey: wu.srKey,
      workPurpose: wu.workPurpose,
      author: wu.author,
      memo: wu.memo,
      items: files.map(toOrthoItem),
    });
  }
  return { units };
}

export async function listOrthoWorkUnitTifs(params: {
  wuKey?: number;
  folderName?: string;
  kind?: TifWorkKind;
} = {}): Promise<{ wuKey: number; folderName: string; items: OrthoTifItem[] }> {
  await requireSession();
  const expectedKind = params.kind ?? 'ortho';
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
            eq(workUnit.kind, expectedKind),
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

/**
 * 항공영상 작업단위 TIF → 자체항공영상(tiles_jpg) 등록.
 * 드론영상 변환과 같은 큐·상태 흐름, 산출만 배경지도용.
 */
export async function convertSatelliteWorkUnit(params: {
  wuKey?: number;
  folderName?: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
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
            eq(workUnit.kind, 'satellite'),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu || wu.kind !== 'satellite') throwHttp(404, '항공영상 작업단위를 찾을 수 없습니다.');
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

    const detected = await detectTifSourceCrs(srcResolved.abs);
    const sourceCrs = detected || row.sourceCrs || defaultCrs;
    const shouldConvert =
      row.convertStatus === 'pending' ||
      row.convertStatus === 'failed' ||
      params.force === true;

    if (!shouldConvert) continue;

    const groupName = satelliteGroupNameFromWorkUnit({
      folderName: wu.folderName,
      wuKey,
      fileName: row.fileName,
    });
    const tilesRel = `tiles_jpg/${groupName}`;

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

    const result = await runAerialSatelliteTifToXyz({
      absSource: srcResolved.abs,
      sourceRelativePath: srcRel,
      sourceCrs,
      groupName,
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

function tileXyToLonLat(z: number, x: number, y: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lon, lat: (latRad * 180) / Math.PI };
}

type Wgs84Extent = {
  minLon: number | null;
  minLat: number | null;
  maxLon: number | null;
  maxLat: number | null;
};

const EMPTY_EXTENT: Wgs84Extent = {
  minLon: null,
  minLat: null,
  maxLon: null,
  maxLat: null,
};

/** 프로세스 메모리 캐시 — 동일 타일 폴더 재스캔 방지 */
const extentMemCache = new Map<string, Wgs84Extent>();

/**
 * XYZ 타일 폴더에서 WGS84 범위 산출.
 * 최고줌의 x 폴더명만으로 min/max X, y는 양끝·중앙 열만 샘플링(전체 열 readdir 방지).
 * 결과는 extent_wgs84.json + 메모리에 캐시.
 */
async function readXyzPyramidWgs84(groupDir: string): Promise<Wgs84Extent> {
  const cacheKey = path.resolve(groupDir);
  const mem = extentMemCache.get(cacheKey);
  if (mem) return mem;

  const diskCachePath = path.join(groupDir, 'extent_wgs84.json');
  try {
    const raw = await fs.readFile(diskCachePath, 'utf8');
    const parsed = JSON.parse(raw) as Wgs84Extent;
    if (
      parsed &&
      typeof parsed.minLon === 'number' &&
      typeof parsed.minLat === 'number' &&
      typeof parsed.maxLon === 'number' &&
      typeof parsed.maxLat === 'number'
    ) {
      extentMemCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    /* compute below */
  }

  let zoomNames: string[] = [];
  try {
    const entries = await fs.readdir(groupDir, { withFileTypes: true });
    zoomNames = entries.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);
  } catch {
    extentMemCache.set(cacheKey, EMPTY_EXTENT);
    return EMPTY_EXTENT;
  }
  const zooms = zoomNames.map(Number);
  if (zooms.length === 0) {
    extentMemCache.set(cacheKey, EMPTY_EXTENT);
    return EMPTY_EXTENT;
  }
  /** 최저줌 타일 1장이 수 km를 덮어 fit 시 영상이 점으로 안 보임 → 최고줌으로 범위 산출 */
  const z = Math.max(...zooms);
  const zDir = path.join(groupDir, String(z));
  let xs: number[] = [];
  try {
    const xDirs = await fs.readdir(zDir, { withFileTypes: true });
    xs = xDirs
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => Number(e.name))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  } catch {
    extentMemCache.set(cacheKey, EMPTY_EXTENT);
    return EMPTY_EXTENT;
  }
  if (xs.length === 0) {
    extentMemCache.set(cacheKey, EMPTY_EXTENT);
    return EMPTY_EXTENT;
  }
  const minX = xs[0]!;
  const maxX = xs[xs.length - 1]!;
  const sampleXs = [...new Set([minX, maxX, xs[Math.floor(xs.length / 2)]!])];
  const ys: number[] = [];
  await Promise.all(
    sampleXs.map(async (x) => {
      try {
        const yFiles = await fs.readdir(path.join(zDir, String(x)));
        for (const yf of yFiles) {
          const m = /^(\d+)\./.exec(yf);
          if (m) ys.push(Number(m[1]));
        }
      } catch {
        /* ignore */
      }
    })
  );
  if (ys.length === 0) {
    extentMemCache.set(cacheKey, EMPTY_EXTENT);
    return EMPTY_EXTENT;
  }
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const nw = tileXyToLonLat(z, minX, minY);
  const se = tileXyToLonLat(z, maxX + 1, maxY + 1);
  const extent: Wgs84Extent = {
    minLon: Math.min(nw.lon, se.lon),
    maxLon: Math.max(nw.lon, se.lon),
    minLat: Math.min(nw.lat, se.lat),
    maxLat: Math.max(nw.lat, se.lat),
  };
  extentMemCache.set(cacheKey, extent);
  void fs.writeFile(diskCachePath, JSON.stringify(extent), 'utf8').catch(() => undefined);
  return extent;
}

async function extentFromTilesRelative(tilesRelativePath: string): Promise<Wgs84Extent> {
  const tilesRel = tilesRelativePath.replace(/\\/g, '/');
  const resolved = resolveWithinBase(tilesRel);
  if (!resolved) return EMPTY_EXTENT;
  return readXyzPyramidWgs84(resolved.abs);
}

/** 세션 없이 범위 산출 (WMS·내부용) */
export async function getOrthoTifExtentWgs84Internal(params: { tuKey?: number } = {}): Promise<{
  tuKey: number;
  minLon: number | null;
  minLat: number | null;
  maxLon: number | null;
  maxLat: number | null;
}> {
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

  const extent = await extentFromTilesRelative(row.tilesRelativePath);
  return { tuKey, ...extent };
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
  return getOrthoTifExtentWgs84Internal(params);
}

export const ORTHO_WMS_LAYER_PREFIX = 'ortho_tu_';

export function orthoWmsLayerName(tuKey: number): string {
  return `${ORTHO_WMS_LAYER_PREFIX}${tuKey}`;
}

export function parseOrthoWmsTuKey(layerName: string): number | null {
  const local = String(layerName ?? '')
    .trim()
    .replace(/^[^:]+:/, '');
  const m = new RegExp(`^${ORTHO_WMS_LAYER_PREFIX}(\\d+)$`, 'i').exec(local);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type OrthoExtentItem = {
  tuKey: number;
  wuKey: number;
  workName: string;
  fileName: string;
  title: string;
  wmsLayerName: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

const LIST_EXTENT_CONCURRENCY = 12;
const LIST_EXTENT_TTL_MS = 60_000;
let listExtentCache: { at: number; items: OrthoExtentItem[] } | null = null;

function invalidateOrthoExtentListCache() {
  listExtentCache = null;
}

/** 변환완료·범위 있는 드론영상 목록 (데이터조회 bbox / 권한 카탈로그) */
export async function listCompletedOrthoExtents(params?: {
  requireSession?: boolean;
}): Promise<{ items: OrthoExtentItem[] }> {
  if (params?.requireSession !== false) await requireSession();

  const now = Date.now();
  if (listExtentCache && now - listExtentCache.at < LIST_EXTENT_TTL_MS) {
    return { items: listExtentCache.items };
  }

  const rows = await db
    .select({
      tuKey: tifUnit.tuKey,
      wuKey: tifUnit.wuKey,
      fileName: tifUnit.fileName,
      workName: workUnit.workName,
      tilesRelativePath: tifUnit.tilesRelativePath,
      convertStatus: tifUnit.convertStatus,
    })
    .from(tifUnit)
    .innerJoin(workUnit, eq(tifUnit.wuKey, workUnit.wuKey))
    .where(
      and(
        eq(tifUnit.tuIsDel, false),
        eq(workUnit.wuIsDel, false),
        eq(workUnit.kind, 'ortho'),
        eq(tifUnit.convertStatus, 'done')
      )
    )
    .orderBy(desc(tifUnit.tuKey))
    .limit(300);

  const items: OrthoExtentItem[] = [];
  for (let i = 0; i < rows.length; i += LIST_EXTENT_CONCURRENCY) {
    const chunk = rows.slice(i, i + LIST_EXTENT_CONCURRENCY);
    const part = await Promise.all(
      chunk.map(async (row) => {
        if (!row.tilesRelativePath) return null;
        const ext = await extentFromTilesRelative(row.tilesRelativePath);
        if (
          ext.minLon == null ||
          ext.minLat == null ||
          ext.maxLon == null ||
          ext.maxLat == null
        ) {
          return null;
        }
        const workName = String(row.workName ?? '').trim() || `작업${row.wuKey}`;
        const fileName = String(row.fileName ?? '').trim() || `tif_${row.tuKey}`;
        return {
          tuKey: row.tuKey,
          wuKey: row.wuKey,
          workName,
          fileName,
          title: `${workName} · ${fileName}`,
          wmsLayerName: orthoWmsLayerName(row.tuKey),
          minLon: ext.minLon,
          minLat: ext.minLat,
          maxLon: ext.maxLon,
          maxLat: ext.maxLat,
        } satisfies OrthoExtentItem;
      })
    );
    for (const it of part) {
      if (it) items.push(it);
    }
  }
  listExtentCache = { at: now, items };
  return { items };
}

/** 원본 TIF 절대경로 (WMS GetMap) */
export async function resolveOrthoTifAbsPath(tuKey: number): Promise<{
  absSource: string;
  sourceCrs: string;
  fileName: string;
} | null> {
  const row = (
    await db
      .select()
      .from(tifUnit)
      .where(and(eq(tifUnit.tuKey, tuKey), eq(tifUnit.tuIsDel, false)))
      .limit(1)
  )[0];
  if (!row || row.convertStatus !== 'done') return null;
  const rel = String(row.relativePath ?? '').replace(/\\/g, '/');
  const resolved = resolveWithinBase(rel);
  if (!resolved) return null;
  try {
    await fs.access(resolved.abs);
  } catch {
    return null;
  }
  return {
    absSource: resolved.abs,
    sourceCrs: String(row.sourceCrs ?? 'EPSG:5181'),
    fileName: row.fileName,
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
  invalidateOrthoExtentListCache();

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
      extentMemCache.delete(path.resolve(tilesResolved.abs));
      await fs.rm(tilesResolved.abs, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { tuKey, wuKey: row.wuKey, fileName: row.fileName, diskRemoved };
}

/**
 * 작업단위 삭제 시 tif_unit·원본 TIF·변환 타일 일괄 제거.
 * 호출측에서 작업단위 폴더 rm 을 추가로 수행한다.
 */
export async function deleteTifUnitsForWorkUnit(wuKey: number): Promise<number> {
  const rows = await db.select().from(tifUnit).where(eq(tifUnit.wuKey, wuKey));
  for (const row of rows) {
    const srcResolved = resolveWithinBase(String(row.relativePath ?? '').replace(/\\/g, '/'));
    if (srcResolved) {
      await fs.rm(srcResolved.abs, { force: true }).catch(() => undefined);
    }
    if (row.tilesRelativePath) {
      const tilesResolved = resolveWithinBase(row.tilesRelativePath.replace(/\\/g, '/'));
      if (tilesResolved) {
        extentMemCache.delete(path.resolve(tilesResolved.abs));
        await fs.rm(tilesResolved.abs, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
  await db.delete(tifUnit).where(eq(tifUnit.wuKey, wuKey));
  invalidateOrthoExtentListCache();
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

type OrthoZoomLimitFile = {
  enabled: boolean;
  maxZoom: number;
};

function orthoZoomLimitAbsPath(): string {
  return path.join(getBaseDir(), ORTHO_ZOOM_LIMIT_REL);
}

function normalizeOrthoZoomLimit(raw: Partial<OrthoZoomLimitFile> | null): OrthoZoomLimitFile {
  const enabled = Boolean(raw?.enabled);
  const z = Number(raw?.maxZoom);
  const maxZoom =
    Number.isFinite(z) && z >= 0 && z <= ORTHO_ZOOM_FULL_MAX
      ? Math.floor(z)
      : ORTHO_ZOOM_LIMIT_DEFAULT_MAX;
  return { enabled, maxZoom };
}

async function readOrthoZoomLimitFile(): Promise<OrthoZoomLimitFile> {
  try {
    const abs = orthoZoomLimitAbsPath();
    const text = await fs.readFile(abs, 'utf8');
    return normalizeOrthoZoomLimit(JSON.parse(text) as Partial<OrthoZoomLimitFile>);
  } catch {
    return { enabled: false, maxZoom: ORTHO_ZOOM_LIMIT_DEFAULT_MAX };
  }
}

async function writeOrthoZoomLimitFile(next: OrthoZoomLimitFile): Promise<void> {
  const abs = orthoZoomLimitAbsPath();
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function canManageOrthoZoomLimit(usrId: string): Promise<boolean> {
  return isSuperUser(usrId);
}

/** 드론영상 고화질(줌) 제한 — 조회 (로그인 사용자) */
export async function getOrthoZoomLimitSetting(): Promise<{
  enabled: boolean;
  maxZoom: number;
  displayMaxZoom: number;
  canManage: boolean;
}> {
  const usrId = await requireSession();
  const file = await readOrthoZoomLimitFile();
  const canManage = await canManageOrthoZoomLimit(usrId);
  return {
    enabled: file.enabled,
    maxZoom: file.maxZoom,
    displayMaxZoom: file.enabled ? file.maxZoom : ORTHO_ZOOM_FULL_MAX,
    canManage,
  };
}

/** 드론영상 고화질(줌) 제한 — 관리자만 저장 */
export async function setOrthoZoomLimitSetting(params: {
  enabled?: boolean;
  maxZoom?: number;
} = {}): Promise<{
  enabled: boolean;
  maxZoom: number;
  displayMaxZoom: number;
  canManage: boolean;
}> {
  const usrId = await requireSession();
  if (!(await canManageOrthoZoomLimit(usrId))) {
    throwHttp(403, '슈퍼계정만 변경할 수 있습니다.');
  }
  const cur = await readOrthoZoomLimitFile();
  const next = normalizeOrthoZoomLimit({
    enabled: params.enabled !== undefined ? Boolean(params.enabled) : cur.enabled,
    maxZoom: params.maxZoom !== undefined ? Number(params.maxZoom) : cur.maxZoom,
  });
  await writeOrthoZoomLimitFile(next);
  return {
    enabled: next.enabled,
    maxZoom: next.maxZoom,
    displayMaxZoom: next.enabled ? next.maxZoom : ORTHO_ZOOM_FULL_MAX,
    canManage: true,
  };
}

/** 경로 검증용 re-export */
export { aerialWorkUnitRelativeDir, isAerialUploadKind, sanitizeAerialFolderName };
