/**
 * 촬영(영상) 작업단위 폴더·파일 API
 * — GGNR_DATA_DIR/aerial/{kind}/{folderName}/
 * — layer.work_unit(작업단위) + layer.file_unit(파일)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import exifr from 'exifr';
import proj4 from 'proj4';
import { db } from '@/database/db';
import { fileUnit } from '@/database/schema/file_unit';
import { workUnit } from '@/database/schema/work_unit';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import {
  aerialWorkUnitRelativeDir,
  isAerialUploadKind,
  sanitizeAerialFolderName,
  type AerialUploadKind,
} from '@/lib/aerialUploadPaths';
import { fetchParcelJibunFromCoord } from '@/lib/vworldAddressServer';
import {
  deleteTifUnitsForWorkUnit,
  insertOrthoTifUnit,
  isOrthoTifFileName,
  listOrthoWorkUnitTifs,
  listOrthoWorkUnits,
  sourceCrsFromOrthoFolderName,
} from '@/service/aerialOrthoService';
import { detectTifSourceCrs, isOrthoConvertBusy } from '@/service/orthophotoService';

/** exifr가 Next 번들에서 fs/zlib require 실패 시 찍는 안내 — EXIF 실패 아님 */
console.info(
  "[exifr] Couldn't load fs / Couldn't load zlib = Next 번들에서 exifr가 Node 모듈(fs·zlib)을 못 찾을 때 나는 안내. EXIF·GPS 오류가 아님. (이후 next.config serverExternalPackages에 exifr 추가 시 완화 가능)"
);
import { completeChunkedUpload, initAerialMediaUpload } from '@/service/uploadService';
import { endAerialWork, isAerialWorkBusy, tryBeginAerialWork, waitAerialWorkTurn } from '@/lib/aerialWorkGate';
import { getProjectEnvVars } from '../../scripts/load-project-env';

const APPROVAL_SER = 'shootingApproval';

/** 프로젝트 env의 현재 구역 GGNR_DATA_DIR. 드라이브는 설정값 그대로 쓴다. */
function dataDirFromProjectEnv(): string {
  const project = (process.env.GGNR_PROJECT ?? '').trim();
  const section = (process.env.GGNR_ENV ?? '').trim();
  if (project && section) {
    try {
      const fromFile = getProjectEnvVars(project, section).GGNR_DATA_DIR?.trim();
      if (fromFile) return fromFile;
    } catch {
      /* env 파일이 없으면 process.env */
    }
  }
  const fromEnv = (process.env.GGNR_DATA_DIR ?? '').trim();
  if (fromEnv) return fromEnv;
  return path.join('d:', 'ggnr_data_dir');
}

/** 파일 업로드 허용 종류 — drone=사진·동영상, panorama=항공뷰, ortho=드론영상 TIF, satellite=항공영상 TIF */
const MEDIA_FILE_KINDS = new Set<AerialUploadKind>(['drone', 'panorama', 'ortho', 'satellite']);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);

let projReady = false;
function ensureProj(): void {
  if (projReady) return;
  proj4.defs(
    'EPSG:4326',
    '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees'
  );
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  projReady = true;
}

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireSession(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

async function requireUploader(srKey?: number | null): Promise<string> {
  const usrId = await requireSession();
  if (srKey != null && Number.isFinite(srKey)) {
    const ok = await userHasSerAccess(usrId, APPROVAL_SER, 'write');
    if (!ok) throwHttp(403, '자료 등록 권한이 없습니다.');
  }
  return usrId;
}

function getBaseDir(): string {
  return dataDirFromProjectEnv();
}

function resolveWithinBase(relativeDir: string): { abs: string; rel: string } | null {
  const baseResolved = path.resolve(getBaseDir());
  const segments = relativeDir.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '.' || seg === '..')) return null;
  const abs = path.resolve(baseResolved, ...segments);
  if (abs !== baseResolved && !abs.startsWith(baseResolved + path.sep)) return null;
  return { abs, rel: segments.join('/') };
}

function nowIso(): string {
  return new Date().toISOString();
}

function renamedMediaFolderName(currentFolderName: string, workName: string): string | null {
  const parts = currentFolderName.split('_');
  if (parts.length < 4) return null;
  const normalizedName = workName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedName) return null;
  return sanitizeAerialFolderName(`${parts.slice(0, 3).join('_')}_${normalizedName}`);
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  return text || null;
}

function mediaTypeFromName(fileName: string): 'image' | 'video' | null {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

function formatSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function readGps5181(absPath: string): Promise<{ x: number; y: number } | null> {
  try {
    const gps = await exifr.gps(absPath);
    if (!gps) return null;
    const lat = Number(gps.latitude);
    const lon = Number(gps.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    ensureProj();
    const [x, y] = proj4('EPSG:4326', 'EPSG:5181', [lon, lat]) as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  } catch {
    return null;
  }
}

export type CreateWorkUnitFolderResult = {
  wuKey: number;
  kind: AerialUploadKind;
  folderName: string;
  workName: string;
  relativeDir: string;
  absoluteDir: string;
  created: boolean;
  /** DB 작업단위 행이 새로 만들어졌는지 */
  wuCreated: boolean;
};

/**
 * 작업단위 폴더 생성 + work_unit insert.
 * 같은 folder_name 이 있으면 폴더·행 재사용.
 */
export async function createWorkUnitFolder(params: {
  kind?: string;
  folderName?: string;
  workName?: string;
  srKey?: number;
} = {}): Promise<CreateWorkUnitFolderResult> {
  const srKey =
    params.srKey != null && Number.isFinite(Number(params.srKey)) ? Number(params.srKey) : null;
  const usrId = await requireUploader(srKey);

  if (!isAerialUploadKind(params.kind)) {
    throwHttp(400, '촬영형태(kind)가 올바르지 않습니다.');
  }
  const kind = params.kind;

  const workNameRaw = sanitizeAerialFolderName(params.workName ?? '');
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '') ?? workNameRaw;
  if (!folderRaw) {
    throwHttp(400, '작업단위명이 필요합니다.');
  }
  const workName = workNameRaw ?? folderRaw;

  const relativeDir = aerialWorkUnitRelativeDir(kind, folderRaw);
  if (!relativeDir) throwHttp(400, '폴더명이 올바르지 않습니다.');

  const resolved = resolveWithinBase(relativeDir);
  if (!resolved) throwHttp(400, '경로가 올바르지 않습니다.');

  let created = false;
  try {
    await fs.access(resolved.abs);
  } catch {
    await fs.mkdir(resolved.abs, { recursive: true });
    created = true;
  }

  const st = await fs.stat(resolved.abs);
  if (!st.isDirectory()) {
    throwHttp(400, '같은 이름의 파일이 이미 있습니다.');
  }

  const now = nowIso();
  const existing = await db
    .select()
    .from(workUnit)
    .where(
      and(
        eq(workUnit.kind, kind),
        eq(workUnit.folderName, folderRaw),
        eq(workUnit.wuIsDel, false)
      )
    )
    .limit(1);

  let wuRow = existing[0];
  let wuCreated = false;
  if (!wuRow) {
    const [ins] = await db
      .insert(workUnit)
      .values({
        workName,
        kind,
        folderName: folderRaw,
        srKey,
        wuIsDel: false,
        wuCreateDate: now,
        wuCreateUser: usrId,
        wuUpdateDate: now,
        wuUpdateUser: usrId,
      })
      .returning();
    if (!ins) throwHttp(500, '작업단위 등록에 실패했습니다.');
    wuRow = ins;
    wuCreated = true;
  } else if (srKey != null && wuRow.srKey == null) {
    const [upd] = await db
      .update(workUnit)
      .set({
        srKey,
        workName,
        wuUpdateDate: now,
        wuUpdateUser: usrId,
      })
      .where(eq(workUnit.wuKey, wuRow.wuKey))
      .returning();
    if (upd) wuRow = upd;
  }

  return {
    wuKey: wuRow.wuKey,
    kind,
    folderName: folderRaw,
    workName: wuRow.workName || workName,
    relativeDir: resolved.rel,
    absoluteDir: resolved.abs,
    created,
    wuCreated,
  };
}

type MediaFolderKind = 'drone' | 'panorama';

async function updateMediaFolderWorkUnit(
  expectedKind: MediaFolderKind,
  params: {
    wuKey?: number;
    workName?: string;
    workPurpose?: string;
    author?: string;
    photographer?: string;
    memo?: string;
  } = {}
): Promise<{
  wuKey: number;
  workName: string;
  folderName: string;
  workPurpose: string | null;
  author: string | null;
  photographer: string | null;
  memo: string | null;
}> {
  const usrId = await requireSession();
  const wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  if (wuKey == null) throwHttp(400, '작업단위 키가 필요합니다.');

  const current = (
    await db
      .select()
      .from(workUnit)
      .where(and(eq(workUnit.wuKey, wuKey), eq(workUnit.wuIsDel, false)))
      .limit(1)
  )[0];
  if (!current || current.kind !== expectedKind) {
    throwHttp(
      404,
      expectedKind === 'drone'
        ? '사진·동영상 작업단위를 찾을 수 없습니다.'
        : '항공뷰 작업단위를 찾을 수 없습니다.'
    );
  }

  const workName = String(params.workName ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!workName) throwHttp(400, '작업단위명이 필요합니다.');
  const workPurpose = optionalText(params.workPurpose, 1000);
  const author = optionalText(params.author, 200);
  const photographer = optionalText(params.photographer, 200);
  const memo = optionalText(params.memo, 4000);

  const nextFolderName = renamedMediaFolderName(current.folderName, workName);
  if (!nextFolderName) throwHttp(400, '작업단위 폴더명을 변경할 수 없습니다.');

  const oldRelativeDir = aerialWorkUnitRelativeDir(expectedKind, current.folderName);
  const nextRelativeDir = aerialWorkUnitRelativeDir(expectedKind, nextFolderName);
  if (!oldRelativeDir || !nextRelativeDir) throwHttp(400, '작업단위 경로가 올바르지 않습니다.');

  const oldResolved = resolveWithinBase(oldRelativeDir);
  const nextResolved = resolveWithinBase(nextRelativeDir);
  if (!oldResolved || !nextResolved) throwHttp(400, '작업단위 경로가 올바르지 않습니다.');

  const files = await db.select().from(fileUnit).where(eq(fileUnit.wuKey, wuKey));
  const oldPrefix = `${oldResolved.rel}/`;
  const nextPaths = files.map((file) => {
    const currentPath = file.relativePath.replace(/\\/g, '/');
    if (!currentPath.startsWith(oldPrefix)) {
      throwHttp(409, `파일 경로를 변경할 수 없습니다: ${file.fileName}`);
    }
    return {
      fuKey: file.fuKey,
      relativePath: `${nextResolved.rel}/${currentPath.slice(oldPrefix.length)}`,
    };
  });

  const renameFolder = current.folderName !== nextFolderName;
  let diskRenamed = false;
  if (renameFolder) {
    try {
      await fs.access(nextResolved.abs);
      throwHttp(409, '같은 이름의 작업단위 폴더가 이미 있습니다.');
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
    }
    await fs.rename(oldResolved.abs, nextResolved.abs);
    diskRenamed = true;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      for (const file of nextPaths) {
        await tx
          .update(fileUnit)
          .set({
            relativePath: file.relativePath,
            fuUpdateDate: nowIso(),
            fuUpdateUser: usrId,
          })
          .where(eq(fileUnit.fuKey, file.fuKey));
      }

      const [row] = await tx
        .update(workUnit)
        .set({
          workName,
          folderName: nextFolderName,
          workPurpose,
          author,
          photographer,
          memo,
          wuUpdateDate: nowIso(),
          wuUpdateUser: usrId,
        })
        .where(eq(workUnit.wuKey, wuKey))
        .returning({
          wuKey: workUnit.wuKey,
          workName: workUnit.workName,
          folderName: workUnit.folderName,
          workPurpose: workUnit.workPurpose,
          author: workUnit.author,
          photographer: workUnit.photographer,
          memo: workUnit.memo,
        });
      return row;
    });
    if (!updated) throwHttp(500, '작업단위 수정에 실패했습니다.');
    return updated;
  } catch (error) {
    if (diskRenamed) {
      await fs.rename(nextResolved.abs, oldResolved.abs).catch(() => undefined);
    }
    throw error;
  }
}

/** 사진·동영상 작업단위명·폴더·경로·업무 속성 수정 */
export async function updateDroneWorkUnit(params: {
  wuKey?: number;
  workName?: string;
  workPurpose?: string;
  author?: string;
  photographer?: string;
  memo?: string;
} = {}) {
  return updateMediaFolderWorkUnit('drone', params);
}

/** 항공뷰 작업단위명·폴더·경로·업무 속성 수정 */
export async function updatePanoramaWorkUnit(params: {
  wuKey?: number;
  workName?: string;
  workPurpose?: string;
  author?: string;
  photographer?: string;
  memo?: string;
} = {}) {
  return updateMediaFolderWorkUnit('panorama', params);
}

export async function updateOrthoWorkUnitAttrs(params: {
  wuKey?: number;
  workDate?: string;
  workPurpose?: string;
  author?: string;
  memo?: string;
} = {}): Promise<{
  wuKey: number;
  workDate: string;
  workPurpose: string | null;
  author: string | null;
  memo: string | null;
}> {
  const usrId = await requireSession();
  const wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  if (wuKey == null) throwHttp(400, '작업단위 키가 필요합니다.');

  const current = (
    await db
      .select()
      .from(workUnit)
      .where(and(eq(workUnit.wuKey, wuKey), eq(workUnit.wuIsDel, false)))
      .limit(1)
  )[0];
  if (!current || (current.kind !== 'ortho' && current.kind !== 'satellite')) {
    throwHttp(404, '영상 작업단위를 찾을 수 없습니다.');
  }

  const workDate = String(params.workDate ?? '').trim();
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(workDate)
    ? new Date(`${workDate}T00:00:00Z`)
    : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== workDate) {
    throwHttp(400, '작업일은 올바른 날짜여야 합니다.');
  }

  const [updated] = await db
    .update(workUnit)
    .set({
      workDate,
      workPurpose: optionalText(params.workPurpose, 1000),
      author: optionalText(params.author, 200),
      memo: optionalText(params.memo, 4000),
      wuUpdateDate: nowIso(),
      wuUpdateUser: usrId,
    })
    .where(eq(workUnit.wuKey, wuKey))
    .returning({
      wuKey: workUnit.wuKey,
      workDate: workUnit.workDate,
      workPurpose: workUnit.workPurpose,
      author: workUnit.author,
      memo: workUnit.memo,
    });
  if (!updated || !updated.workDate) throwHttp(500, '드론영상 속성 수정에 실패했습니다.');
  return { ...updated, workDate: updated.workDate };
}

export type InitMediaUploadResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
  relativeDir: string;
  fileName: string;
  wuKey: number;
};

/** 사진·동영상 청크 업로드 세션 시작 */
export async function initMediaUpload(params: {
  kind?: string;
  folderName?: string;
  wuKey?: number;
  fileName?: string;
  totalSize?: number;
  srKey?: number;
} = {}): Promise<InitMediaUploadResult> {
  const srKey =
    params.srKey != null && Number.isFinite(Number(params.srKey)) ? Number(params.srKey) : null;
  await requireUploader(srKey);

  if (!isAerialUploadKind(params.kind) || !MEDIA_FILE_KINDS.has(params.kind)) {
    throwHttp(400, '사진·동영상·항공뷰 또는 드론영상 작업단위만 파일 업로드할 수 있습니다.');
  }

  let wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '');

  let wu = wuKey != null
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
            eq(workUnit.kind, params.kind),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu) throwHttp(400, '작업단위를 찾을 수 없습니다. 폴더를 먼저 생성하세요.');
  wuKey = wu.wuKey;

  const fileName = path.basename(String(params.fileName ?? '').replace(/\\/g, '/'));
  if (params.kind === 'ortho' || params.kind === 'satellite') {
    if (!isOrthoTifFileName(fileName)) {
      throwHttp(
        400,
        params.kind === 'ortho'
          ? '드론영상은 TIF(TIFF) 파일만 업로드할 수 있습니다.'
          : '항공영상은 TIF(TIFF) 파일만 업로드할 수 있습니다.'
      );
    }
  } else if (params.kind === 'panorama') {
    const mediaType = mediaTypeFromName(fileName);
    if (mediaType !== 'image') throwHttp(400, '항공뷰는 이미지 파일만 업로드할 수 있습니다.');
  } else {
    const mediaType = mediaTypeFromName(fileName);
    if (!mediaType) throwHttp(400, '지원하지 않는 파일 형식입니다.');
  }

  const totalSize = Number(params.totalSize);
  if (!Number.isFinite(totalSize) || totalSize < 0) throwHttp(400, '파일 크기가 올바르지 않습니다.');

  const relativeDir = aerialWorkUnitRelativeDir(params.kind, wu.folderName);
  if (!relativeDir) throwHttp(400, '폴더명이 올바르지 않습니다.');

  const resolved = resolveWithinBase(relativeDir);
  if (!resolved) throwHttp(400, '경로가 올바르지 않습니다.');
  await fs.mkdir(resolved.abs, { recursive: true });

  const init = await initAerialMediaUpload({
    fileName,
    totalSize,
    relativeDir: resolved.rel,
  });

  return {
    ...init,
    relativeDir: resolved.rel,
    fileName,
    wuKey,
  };
}

export type WorkUnitMediaItem = {
  fuKey?: number;
  tuKey?: number;
  wuKey: number;
  fileName: string;
  relativePath: string;
  mediaType: string;
  fileSize: number | null;
  x5181: number | null;
  y5181: number | null;
  /** 한 점 또는 여러 점. 없으면 x5181/y5181 */
  points5181?: [number, number][] | null;
  locationLabel: string | null;
  sizeLabel: string;
  format: string;
  previewKind: 'image' | 'video' | 'tif' | 'panorama';
  convertStatus?: string;
  tilesRelativePath?: string | null;
};

function resultRows<T>(res: unknown): T[] {
  if (res && typeof res === 'object' && 'rows' in res && Array.isArray((res as { rows: unknown }).rows)) {
    return (res as { rows: T[] }).rows;
  }
  if (Array.isArray(res)) return res as T[];
  return [];
}

function geoJsonToPoints(raw: string | null | undefined): [number, number][] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw) as { type?: string; coordinates?: unknown };
    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      const pair = g.coordinates as number[];
      const x = Number(pair[0]);
      const y = Number(pair[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
    }
    if (g.type === 'MultiPoint' && Array.isArray(g.coordinates)) {
      const out: [number, number][] = [];
      for (const pair of g.coordinates as number[][]) {
        const x = Number(pair?.[0]);
        const y = Number(pair?.[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
      }
      return out;
    }
  } catch {
    return [];
  }
  return [];
}

async function geomPointsByFuKey(wuKey: number): Promise<Map<number, [number, number][]>> {
  const res = await db.execute(sql`
    SELECT fu_key, ST_AsGeoJSON(geom) AS geojson
    FROM layer.file_unit
    WHERE wu_key = ${wuKey}
      AND COALESCE(fu_is_del, false) = false
      AND geom IS NOT NULL
  `);
  const map = new Map<number, [number, number][]>();
  for (const row of resultRows<{ fu_key?: number; geojson?: string }>(res)) {
    const key = Number(row.fu_key);
    const pts = geoJsonToPoints(row.geojson);
    if (Number.isFinite(key) && pts.length > 0) map.set(key, pts);
  }
  return map;
}

function attachGeomPoints(
  items: WorkUnitMediaItem[],
  points: Map<number, [number, number][]>
): WorkUnitMediaItem[] {
  return items.map((item) => {
    if (item.fuKey == null) return item;
    const pts = points.get(item.fuKey);
    if (!pts || pts.length === 0) return item;
    return { ...item, points5181: pts };
  });
}

/** 점만 담던 컬럼을 여러 점도 저장할 수 있게 넓힌다. */
async function widenFileUnitGeom(): Promise<void> {
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM geometry_columns
        WHERE f_table_schema = 'layer'
          AND f_table_name = 'file_unit'
          AND f_geometry_column = 'geom'
          AND upper(type) = 'POINT'
      ) THEN
        EXECUTE 'DROP INDEX IF EXISTS layer.file_unit_geom_gix';
        EXECUTE 'DROP INDEX IF EXISTS public.file_unit_geom_gix';
        EXECUTE 'ALTER TABLE layer.file_unit ALTER COLUMN geom TYPE geometry(Geometry, 5181) USING geom::geometry(Geometry, 5181)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS file_unit_geom_gix ON layer.file_unit USING GIST (geom)';
      END IF;
    END $$;
  `));
}

function toMediaItem(
  row: typeof fileUnit.$inferSelect,
  kind?: string
): WorkUnitMediaItem {
  const previewKind: WorkUnitMediaItem['previewKind'] =
    kind === 'panorama'
      ? 'panorama'
      : row.mediaType === 'video'
        ? 'video'
        : 'image';
  return {
    fuKey: row.fuKey,
    wuKey: row.wuKey,
    fileName: row.fileName,
    relativePath: row.relativePath,
    mediaType: row.mediaType,
    fileSize: row.fileSize,
    x5181: row.x5181,
    y5181: row.y5181,
    /** 지번 주소 — enrichMediaItemsWithJibun 에서 채움 */
    locationLabel: null,
    sizeLabel: formatSizeLabel(row.fileSize),
    format: path.extname(row.fileName).replace(/^\./, '').toLowerCase() || 'bin',
    previewKind,
  };
}

/** 5181 → WGS84 (lon, lat) */
function toLonLat5181(x: number, y: number): { lon: number; lat: number } | null {
  try {
    ensureProj();
    const [lon, lat] = proj4('EPSG:5181', 'EPSG:4326', [x, y]) as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
  } catch {
    return null;
  }
}

const jibunCache = new Map<string, string | null>();

function jibunCacheKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/** 좌표 있는 항목의 locationLabel 을 지번으로 채움 (좌표 문자열은 UI에 쓰지 않음) */
async function enrichMediaItemsWithJibun(items: WorkUnitMediaItem[]): Promise<WorkUnitMediaItem[]> {
  const out = items.map((item) => ({ ...item }));
  const pending = out
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        item.x5181 != null &&
        item.y5181 != null &&
        Number.isFinite(item.x5181) &&
        Number.isFinite(item.y5181)
    );

  const concurrency = 4;
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ item, index }) => {
        const ll = toLonLat5181(item.x5181!, item.y5181!);
        if (!ll) return;
        const key = jibunCacheKey(ll.lon, ll.lat);
        if (!jibunCache.has(key)) {
          jibunCache.set(key, await fetchParcelJibunFromCoord(ll.lon, ll.lat));
        }
        out[index] = { ...item, locationLabel: jibunCache.get(key) ?? null };
      })
    );
  }
  return out;
}

export type CompleteMediaUploadResult = {
  savedPath: string;
  size: number;
  item: WorkUnitMediaItem;
};

/** 청크 병합·디스크 저장 후 EXIF→5181·file_unit insert */
export async function completeMediaUpload(params: {
  uploadId?: string;
  kind?: string;
  folderName?: string;
  workName?: string;
  wuKey?: number;
  srKey?: number;
} = {}): Promise<CompleteMediaUploadResult> {
  const srKey =
    params.srKey != null && Number.isFinite(Number(params.srKey)) ? Number(params.srKey) : null;
  const usrId = await requireUploader(srKey);

  if (!params.uploadId?.trim()) throwHttp(400, 'uploadId가 필요합니다.');
  if (!isAerialUploadKind(params.kind) || !MEDIA_FILE_KINDS.has(params.kind)) {
    throwHttp(400, '사진·동영상·항공뷰 또는 드론영상 작업단위만 파일 업로드할 수 있습니다.');
  }

  await waitAerialWorkTurn();
  try {
  let wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '');

  let wu = wuKey != null
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
            eq(workUnit.kind, params.kind),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu) throwHttp(400, '작업단위를 찾을 수 없습니다.');
  wuKey = wu.wuKey;

  const saved = await completeChunkedUpload({ uploadId: params.uploadId.trim() });
  const relativePath = String(saved.savedPath ?? '').replace(/\\/g, '/');
  const fileName = path.basename(relativePath);

  /** 드론영상·항공영상 TIF → tif_unit */
  if (params.kind === 'ortho' || params.kind === 'satellite') {
    if (!isOrthoTifFileName(fileName)) {
      throwHttp(
        400,
        params.kind === 'ortho'
          ? '드론영상은 TIF(TIFF) 파일만 업로드할 수 있습니다.'
          : '항공영상은 TIF(TIFF) 파일만 업로드할 수 있습니다.'
      );
    }
    const absSaved = path.isAbsolute(String(saved.savedPath ?? ''))
      ? String(saved.savedPath)
      : path.join(getBaseDir(), ...relativePath.split('/').filter(Boolean));
    const detectedCrs = await detectTifSourceCrs(absSaved).catch(() => null);
    const orthoItem = await insertOrthoTifUnit({
      wuKey,
      fileName,
      relativePath,
      fileSize: saved.size,
      sourceCrs: detectedCrs || sourceCrsFromOrthoFolderName(wu.folderName),
      usrId,
    });
    const item: WorkUnitMediaItem = {
      tuKey: orthoItem.tuKey,
      wuKey: orthoItem.wuKey,
      fileName: orthoItem.fileName,
      relativePath: orthoItem.relativePath,
      mediaType: 'tif',
      fileSize: orthoItem.fileSize,
      x5181: null,
      y5181: null,
      locationLabel: null,
      sizeLabel: orthoItem.sizeLabel,
      format: orthoItem.format,
      previewKind: 'tif',
      convertStatus: orthoItem.convertStatus,
      tilesRelativePath: orthoItem.tilesRelativePath,
    };
    return { savedPath: relativePath, size: saved.size, item };
  }

  const mediaType = mediaTypeFromName(fileName);
  if (!mediaType) throwHttp(400, '지원하지 않는 파일 형식입니다.');
  if (params.kind === 'panorama' && mediaType !== 'image') {
    throwHttp(400, '항공뷰는 이미지 파일만 업로드할 수 있습니다.');
  }

  const abs = path.join(getBaseDir(), ...relativePath.split('/').filter(Boolean));
  let x5181: number | null = null;
  let y5181: number | null = null;
  if (mediaType === 'image') {
    const gps = await readGps5181(abs);
    if (gps) {
      x5181 = gps.x;
      y5181 = gps.y;
    }
  }

  const now = nowIso();
  const [row] = await db
    .insert(fileUnit)
    .values({
      wuKey,
      fileName,
      relativePath,
      mediaType,
      fileSize: saved.size,
      x5181,
      y5181,
      fuIsDel: false,
      fuCreateDate: now,
      fuCreateUser: usrId,
      fuUpdateDate: now,
      fuUpdateUser: usrId,
    })
    .returning();

  if (!row) throwHttp(500, '파일 메타 저장에 실패했습니다.');

  if (x5181 != null && y5181 != null) {
    await db.execute(
      sql.raw(
        `UPDATE layer.file_unit
         SET geom = ST_SetSRID(ST_MakePoint(${Number(x5181)}, ${Number(y5181)}), 5181)
         WHERE fu_key = ${Number(row.fuKey)}`
      )
    );
  }

  const [item] = await enrichMediaItemsWithJibun([toMediaItem(row, params.kind)]);
  return {
    savedPath: relativePath,
    size: saved.size,
    item,
  };
  } finally {
    endAerialWork();
  }
}

export type ListWorkUnitMediaResult = {
  wuKey: number;
  kind: string;
  folderName: string;
  items: WorkUnitMediaItem[];
};

/** 작업단위 파일 목록 */
export async function listWorkUnitMedia(params: {
  kind?: string;
  folderName?: string;
  wuKey?: number;
} = {}): Promise<ListWorkUnitMediaResult> {
  await requireSession();

  let wuKey =
    params.wuKey != null && Number.isFinite(Number(params.wuKey)) ? Number(params.wuKey) : null;
  const folderRaw = sanitizeAerialFolderName(params.folderName ?? '');

  let wu = wuKey != null
    ? (
        await db
          .select()
          .from(workUnit)
          .where(and(eq(workUnit.wuKey, wuKey), eq(workUnit.wuIsDel, false)))
          .limit(1)
      )[0]
    : undefined;

  if (!wu) {
    if (!isAerialUploadKind(params.kind) || !folderRaw) {
      throwHttp(400, '작업단위 키 또는 폴더명이 필요합니다.');
    }
    wu = (
      await db
        .select()
        .from(workUnit)
        .where(
          and(
            eq(workUnit.kind, params.kind),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu) throwHttp(404, '작업단위를 찾을 수 없습니다.');

  if (wu.kind === 'ortho' || wu.kind === 'satellite') {
    const ortho = await listOrthoWorkUnitTifs({
      wuKey: wu.wuKey,
      kind: wu.kind === 'satellite' ? 'satellite' : 'ortho',
    });
    return {
      wuKey: wu.wuKey,
      kind: wu.kind,
      folderName: wu.folderName,
      items: ortho.items.map((o) => ({
        tuKey: o.tuKey,
        wuKey: o.wuKey,
        fileName: o.fileName,
        relativePath: o.relativePath,
        mediaType: 'tif',
        fileSize: o.fileSize,
        x5181: null,
        y5181: null,
        locationLabel: null,
        sizeLabel: o.sizeLabel,
        format: o.format,
        previewKind: 'tif' as const,
        convertStatus: o.convertStatus,
        tilesRelativePath: o.tilesRelativePath,
      })),
    };
  }

  const rows = await db
    .select()
    .from(fileUnit)
    .where(and(eq(fileUnit.wuKey, wu.wuKey), eq(fileUnit.fuIsDel, false)))
    .orderBy(asc(fileUnit.fuKey));

  const items = await enrichMediaItemsWithJibun(rows.map((r) => toMediaItem(r, wu.kind)));
  return {
    wuKey: wu.wuKey,
    kind: wu.kind,
    folderName: wu.folderName,
    items: attachGeomPoints(items, await geomPointsByFuKey(wu.wuKey)),
  };
}

export type WorkUnitListItem = {
  wuKey: number;
  kind: string;
  folderName: string;
  workName: string;
  workDate: string | null;
  fileCount: number;
  srKey: number | null;
  workPurpose: string | null;
  author: string | null;
  photographer: string | null;
  memo: string | null;
  items: WorkUnitMediaItem[];
};

/** 작업단위 목록 (+ 파일) */
export async function listWorkUnits(params: { kind?: string } = {}): Promise<{
  units: WorkUnitListItem[];
}> {
  await requireSession();
  if (!isAerialUploadKind(params.kind)) {
    throwHttp(400, '촬영형태(kind)가 올바르지 않습니다.');
  }
  const kind = params.kind;

  if (kind === 'ortho' || kind === 'satellite') {
    const ortho = await listOrthoWorkUnits(kind);
    return {
      units: ortho.units.map((u) => ({
        wuKey: u.wuKey,
        kind: u.kind,
        folderName: u.folderName,
        workName: u.workName,
        workDate: u.workDate,
        fileCount: u.fileCount,
        srKey: u.srKey,
        workPurpose: u.workPurpose,
        author: u.author,
        photographer: null,
        memo: u.memo,
        items: u.items.map((o) => ({
          tuKey: o.tuKey,
          wuKey: o.wuKey,
          fileName: o.fileName,
          relativePath: o.relativePath,
          mediaType: 'tif',
          fileSize: o.fileSize,
          x5181: null,
          y5181: null,
          locationLabel: null,
          sizeLabel: o.sizeLabel,
          format: o.format,
          previewKind: 'tif' as const,
          convertStatus: o.convertStatus,
          tilesRelativePath: o.tilesRelativePath,
        })),
      })),
    };
  }

  const unitsRows = await db
    .select()
    .from(workUnit)
    .where(and(eq(workUnit.kind, kind), eq(workUnit.wuIsDel, false)))
    .orderBy(desc(workUnit.wuKey));

  const units: WorkUnitListItem[] = [];
  for (const wu of unitsRows) {
    const files = await db
      .select()
      .from(fileUnit)
      .where(and(eq(fileUnit.wuKey, wu.wuKey), eq(fileUnit.fuIsDel, false)))
      .orderBy(asc(fileUnit.fuKey));
    const created = wu.wuCreateDate ? String(wu.wuCreateDate).slice(0, 10) : null;
    units.push({
      wuKey: wu.wuKey,
      kind: wu.kind,
      folderName: wu.folderName,
      workName: wu.workName,
      workDate: created,
      fileCount: files.length,
      srKey: wu.srKey,
      workPurpose: wu.workPurpose,
      author: wu.author,
      photographer: wu.photographer,
      memo: wu.memo,
      items: attachGeomPoints(
        await enrichMediaItemsWithJibun(files.map((r) => toMediaItem(r, kind))),
        await geomPointsByFuKey(wu.wuKey)
      ),
    });
  }

  return { units };
}

export type DeleteWorkUnitResult = {
  wuKey: number;
  kind: string;
  folderName: string;
  deletedFiles: number;
  diskRemoved: boolean;
};

/**
 * 작업단위 삭제 — file_unit 행·work_unit 행·디스크 폴더를 함께 제거.
 */
export async function deleteWorkUnit(params: {
  wuKey?: number;
  kind?: string;
  folderName?: string;
} = {}): Promise<DeleteWorkUnitResult> {
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

  if (!wu && folderRaw && isAerialUploadKind(params.kind)) {
    wu = (
      await db
        .select()
        .from(workUnit)
        .where(
          and(
            eq(workUnit.kind, params.kind),
            eq(workUnit.folderName, folderRaw),
            eq(workUnit.wuIsDel, false)
          )
        )
        .limit(1)
    )[0];
  }
  if (!wu) throwHttp(404, '작업단위를 찾을 수 없습니다.');
  wuKey = wu.wuKey;

  if (!isAerialUploadKind(wu.kind)) {
    throwHttp(400, '촬영형태(kind)가 올바르지 않습니다.');
  }

  const fileRows = await db
    .select({ fuKey: fileUnit.fuKey })
    .from(fileUnit)
    .where(eq(fileUnit.wuKey, wuKey));

  const tifCount =
    wu.kind === 'ortho' || wu.kind === 'satellite' ? await deleteTifUnitsForWorkUnit(wuKey) : 0;
  await db.delete(fileUnit).where(eq(fileUnit.wuKey, wuKey));
  await db.delete(workUnit).where(eq(workUnit.wuKey, wuKey));

  let diskRemoved = false;
  const relativeDir = aerialWorkUnitRelativeDir(wu.kind, wu.folderName);
  if (relativeDir) {
    const resolved = resolveWithinBase(relativeDir);
    if (resolved) {
      try {
        await fs.rm(resolved.abs, { recursive: true, force: true });
        diskRemoved = true;
      } catch {
        /* 폴더가 없어도 DB 삭제는 성공으로 처리 */
        diskRemoved = false;
      }
    }
  }

  return {
    wuKey,
    kind: wu.kind,
    folderName: wu.folderName,
    deletedFiles: fileRows.length + tifCount,
    diskRemoved,
  };
}

export type DeleteFileUnitResult = {
  fuKey: number;
  wuKey: number;
  fileName: string;
  diskRemoved: boolean;
};

/**
 * 파일 1건 삭제 — file_unit 행·디스크 파일 제거. 작업단위는 유지.
 */
export async function deleteFileUnit(params: { fuKey?: number } = {}): Promise<DeleteFileUnitResult> {
  await requireSession();

  const fuKey =
    params.fuKey != null && Number.isFinite(Number(params.fuKey)) ? Number(params.fuKey) : null;
  if (fuKey == null) throwHttp(400, '파일 키가 필요합니다.');

  const row = (
    await db
      .select()
      .from(fileUnit)
      .where(and(eq(fileUnit.fuKey, fuKey), eq(fileUnit.fuIsDel, false)))
      .limit(1)
  )[0];
  if (!row) throwHttp(404, '파일을 찾을 수 없습니다.');

  await db.delete(fileUnit).where(eq(fileUnit.fuKey, fuKey));

  let diskRemoved = false;
  const rel = String(row.relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (rel.startsWith('aerial/') && !rel.includes('..')) {
    const resolved = resolveWithinBase(rel);
    if (resolved) {
      try {
        await fs.unlink(resolved.abs);
        diskRemoved = true;
      } catch {
        diskRemoved = false;
      }
    }
  }

  return {
    fuKey,
    wuKey: row.wuKey,
    fileName: row.fileName,
    diskRemoved,
  };
}

/** 사진·동영상 파일 위치. 없으면 여러 점, 있으면 한 점(또는 기존 여러 점) */
export async function updateFileUnitGeom(params: {
  fuKey?: number;
  wkt?: string;
  x5181?: number;
  y5181?: number;
} = {}): Promise<{ fuKey: number }> {
  const usrId = await requireSession();
  const fuKey =
    params.fuKey != null && Number.isFinite(Number(params.fuKey)) ? Number(params.fuKey) : null;
  if (fuKey == null) throwHttp(400, '파일 키가 필요합니다.');

  const wkt = String(params.wkt ?? '').trim();
  if (!/^(POINT|MULTIPOINT)\s*\(/i.test(wkt) || wkt.length > 20000 || wkt.includes(';')) {
    throwHttp(400, '점 형식만 저장할 수 있습니다.');
  }
  const x = Number(params.x5181);
  const y = Number(params.y5181);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throwHttp(400, '좌표가 올바르지 않습니다.');

  await widenFileUnitGeom();

  const updated = await db.execute(sql`
    UPDATE layer.file_unit
    SET geom = ST_SetSRID(ST_GeomFromText(${wkt}), 5181),
        x_5181 = ${x},
        y_5181 = ${y},
        fu_update_date = now(),
        fu_update_user = ${usrId}
    WHERE fu_key = ${fuKey}
      AND fu_is_del = false
    RETURNING fu_key
  `);
  if (resultRows(updated).length === 0) throwHttp(404, '파일을 찾을 수 없습니다.');
  return { fuKey };
}

const DRONE_DROP_ACTOR = 'scheduler';

/** 직전 확인 때와 크기·수정시각이 같아야 등록. 복사 중 파일은 다음 주기에 넘긴다. */
const droneDropWatch = new Map<string, { size: number; mtimeMs: number }>();

/** 위치 읽기만 동시에. 목록 저장은 한 건씩. */
const DROP_GPS_BATCH = 4;

export type ImportDroppedDroneFoldersResult = {
  unitsCreated: number;
  filesRegistered: number;
  filesWaiting: number;
  /** 화면 업로드·변환이 진행 중이라 나머지를 다음 주기로 넘김 */
  paused: boolean;
};

function droneDropIsStable(relativePath: string, size: number, mtimeMs: number): boolean {
  const prev = droneDropWatch.get(relativePath);
  droneDropWatch.set(relativePath, { size, mtimeMs });
  return prev != null && prev.size === size && prev.mtimeMs === mtimeMs && size > 0;
}

type DropMediaKind = 'drone' | 'panorama';

async function ensureDroppedMediaWorkUnit(
  kind: DropMediaKind,
  folderName: string
): Promise<{ wuKey: number; created: boolean } | null> {
  const relativeDir = aerialWorkUnitRelativeDir(kind, folderName);
  if (!relativeDir) return null;
  const resolved = resolveWithinBase(relativeDir);
  if (!resolved) return null;

  const now = nowIso();
  const existing = await db
    .select()
    .from(workUnit)
    .where(and(eq(workUnit.kind, kind), eq(workUnit.folderName, folderName), eq(workUnit.wuIsDel, false)))
    .limit(1);
  const row = existing[0];
  if (row) return { wuKey: row.wuKey, created: false };

  const [ins] = await db
    .insert(workUnit)
    .values({
      workName: folderName,
      kind,
      folderName,
      wuIsDel: false,
      wuCreateDate: now,
      wuCreateUser: DRONE_DROP_ACTOR,
      wuUpdateDate: now,
      wuUpdateUser: DRONE_DROP_ACTOR,
    })
    .returning();
  if (!ins) return null;
  return { wuKey: ins.wuKey, created: true };
}

async function insertDroppedDroneFile(params: {
  wuKey: number;
  fileName: string;
  relativePath: string;
  mediaType: 'image' | 'video';
  fileSize: number;
  x5181: number | null;
  y5181: number | null;
}): Promise<boolean> {
  const x5181 = params.x5181;
  const y5181 = params.y5181;

  const now = nowIso();
  const [row] = await db
    .insert(fileUnit)
    .values({
      wuKey: params.wuKey,
      fileName: params.fileName,
      relativePath: params.relativePath,
      mediaType: params.mediaType,
      fileSize: params.fileSize,
      x5181,
      y5181,
      fuIsDel: false,
      fuCreateDate: now,
      fuCreateUser: DRONE_DROP_ACTOR,
      fuUpdateDate: now,
      fuUpdateUser: DRONE_DROP_ACTOR,
    })
    .returning();
  if (!row) return false;

  if (x5181 != null && y5181 != null) {
    await db.execute(sql`
      UPDATE layer.file_unit
      SET geom = ST_SetSRID(ST_MakePoint(${x5181}, ${y5181}), 5181)
      WHERE fu_key = ${row.fuKey}
    `);
  }
  return true;
}

async function dropFolderAbsoluteDir(kind: DropMediaKind): Promise<string> {
  await requireSession();
  const root = resolveWithinBase(kind === 'drone' ? 'aerial/drone' : 'aerial/panorama');
  if (!root) {
    throwHttp(500, kind === 'drone' ? '사진·동영상 자료 경로를 확인할 수 없습니다.' : '항공뷰 자료 경로를 확인할 수 없습니다.');
  }
  return root.abs.endsWith(path.sep) ? root.abs : `${root.abs}${path.sep}`;
}

/** 사진·동영상 자료 폴더. 화면 안내용 */
export async function getDroneDropFolderPath(): Promise<{ absoluteDir: string }> {
  return { absoluteDir: await dropFolderAbsoluteDir('drone') };
}

/** 항공뷰 자료 폴더. 화면 안내용 */
export async function getPanoramaDropFolderPath(): Promise<{ absoluteDir: string }> {
  return { absoluteDir: await dropFolderAbsoluteDir('panorama') };
}

/**
 * aerial/{drone|panorama} 바로 아래 폴더를 작업단위로 본다.
 * 항공뷰는 사진만. 하위 폴더의 파일은 읽지 않는다. 이미 같은 경로로 등록된 파일은 건너뛴다.
 */
async function importDroppedMediaFolders(kind: DropMediaKind): Promise<ImportDroppedDroneFoldersResult> {
  const result: ImportDroppedDroneFoldersResult = {
    unitsCreated: 0,
    filesRegistered: 0,
    filesWaiting: 0,
    paused: false,
  };
  const root = resolveWithinBase(kind === 'drone' ? 'aerial/drone' : 'aerial/panorama');
  if (!root) return result;

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(root.abs, { withFileTypes: true });
  } catch {
    return result;
  }

  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const folderName = sanitizeAerialFolderName(entry.name);
    if (!folderName || folderName !== entry.name) continue;

    const relativeDir = aerialWorkUnitRelativeDir(kind, folderName);
    const resolved = relativeDir ? resolveWithinBase(relativeDir) : null;
    if (!resolved) continue;

    let children: { name: string; isFile: () => boolean }[];
    try {
      children = await fs.readdir(resolved.abs, { withFileTypes: true });
    } catch {
      continue;
    }

    const existingWu = (
      await db
        .select({ wuKey: workUnit.wuKey })
        .from(workUnit)
        .where(
          and(eq(workUnit.kind, kind), eq(workUnit.folderName, folderName), eq(workUnit.wuIsDel, false))
        )
        .limit(1)
    )[0];
    const known = new Set<string>();
    if (existingWu) {
      const rows = await db
        .select({ relativePath: fileUnit.relativePath })
        .from(fileUnit)
        .where(eq(fileUnit.wuKey, existingWu.wuKey));
      for (const row of rows) {
        known.add(String(row.relativePath ?? '').replace(/\\/g, '/'));
      }
    }

    const ready: {
      fileName: string;
      relativePath: string;
      absPath: string;
      mediaType: 'image' | 'video';
      fileSize: number;
    }[] = [];

    for (const child of children) {
      if (!child.isFile()) continue;
      if (child.name.startsWith('.')) continue;
      const mediaType = mediaTypeFromName(child.name);
      if (!mediaType) continue;
      if (kind === 'panorama' && mediaType !== 'image') continue;
      const relativePath = `${resolved.rel}/${child.name}`;
      const absPath = path.join(resolved.abs, child.name);
      seen.add(relativePath);
      if (known.has(relativePath)) {
        droneDropWatch.delete(relativePath);
        continue;
      }
      let st: { size: number; mtimeMs: number; isFile: () => boolean };
      try {
        st = await fs.stat(absPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (!droneDropIsStable(relativePath, st.size, st.mtimeMs)) {
        result.filesWaiting += 1;
        continue;
      }
      ready.push({
        fileName: child.name,
        relativePath,
        absPath,
        mediaType,
        fileSize: st.size,
      });
    }

    if (ready.length === 0) continue;

    let wu: { wuKey: number; created: boolean } | null = existingWu
      ? { wuKey: existingWu.wuKey, created: false }
      : null;
    let folderFailed = false;

    for (let offset = 0; offset < ready.length && !folderFailed; offset += DROP_GPS_BATCH) {
      if (isOrthoConvertBusy() || isAerialWorkBusy()) {
        result.paused = true;
        return result;
      }
      const batch = await Promise.all(
        ready.slice(offset, offset + DROP_GPS_BATCH).map(async (file) => {
          const gps = file.mediaType === 'image' ? await readGps5181(file.absPath) : null;
          return { ...file, x5181: gps?.x ?? null, y5181: gps?.y ?? null };
        })
      );
      for (const file of batch) {
        if (isOrthoConvertBusy() || !tryBeginAerialWork()) {
          result.paused = true;
          return result;
        }
        try {
          if (!wu) {
            wu = await ensureDroppedMediaWorkUnit(kind, folderName);
            if (!wu) {
              folderFailed = true;
              break;
            }
            if (wu.created) result.unitsCreated += 1;
          }
          const dup = (
            await db
              .select({ fuKey: fileUnit.fuKey })
              .from(fileUnit)
              .where(and(eq(fileUnit.wuKey, wu.wuKey), eq(fileUnit.relativePath, file.relativePath)))
              .limit(1)
          )[0];
          if (dup) {
            droneDropWatch.delete(file.relativePath);
            continue;
          }
          const ok = await insertDroppedDroneFile({
            wuKey: wu.wuKey,
            fileName: file.fileName,
            relativePath: file.relativePath,
            mediaType: file.mediaType,
            fileSize: file.fileSize,
            x5181: file.x5181,
            y5181: file.y5181,
          });
          if (ok) {
            result.filesRegistered += 1;
            droneDropWatch.delete(file.relativePath);
          }
        } catch (error) {
          console.warn(
            `[aerial-${kind}-folder] file skip:`,
            file.relativePath,
            error instanceof Error ? error.message : error
          );
        } finally {
          endAerialWork();
        }
      }
    }
  }

  const prefix = `${root.rel}/`;
  for (const key of droneDropWatch.keys()) {
    if (key.startsWith(prefix) && !seen.has(key)) droneDropWatch.delete(key);
  }

  return result;
}

/** aerial/drone 바로 아래 폴더의 사진·동영상을 등록한다. */
export async function importDroppedDroneFolders(): Promise<ImportDroppedDroneFoldersResult> {
  return importDroppedMediaFolders('drone');
}

/** aerial/panorama 바로 아래 폴더의 사진을 등록한다. */
export async function importDroppedPanoramaFolders(): Promise<ImportDroppedDroneFoldersResult> {
  return importDroppedMediaFolders('panorama');
}
