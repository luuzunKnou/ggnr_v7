/**
 * 데이터요청(보안서약) — SHP 등 요청 접수·목록·승인·다운로드
 */
import fs from 'fs/promises';
import path from 'path';
import { and, asc, desc, eq, or, sql, like, inArray } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  dataRequestFile,
  DRF_ACCEPT_N,
  DRF_ACCEPT_P,
  DRF_ACCEPT_Y,
  DRF_AUTHOR_ADMIN,
  DRF_AUTHOR_TEAM,
} from '@/database/schema/data_request_file';
import {
  LDA_AUTH_ADMIN,
  LDA_AUTH_AUTO,
  LDA_AUTH_NONE,
  LDA_AUTH_TEAM,
  type LayerDownloadAuthValue,
} from '@/database/schema/layer_download_auth';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { fetchFirstPublicLayerSggName } from '@/lib/publicLayerSgg';
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath';
import {
  assertSafeFileDataSegment,
  decodeServiceFileDataPathB64,
  isAllowedServiceFileDataDownloadPath,
} from '@/lib/serviceFileData';
import { userCanAccessServiceFileData } from '@/lib/serviceFileDataAccess';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import { exportLayerTableToShp } from '@/service/shpUploadService';
import { exportWtlNetworkShpZip } from '@/service/wtlNetworkService';
import { exportFacilityShpZip } from '@/service/wtlFacilityService';
import { recordLayerDownloadLog } from '@/service/layerDownloadLog';
import { getFileManagerDownloadTarget } from '@/service/fileManagerService';
import {
  cleanupLayerCadExportJob,
  getLayerCadExportJob,
} from '@/service/layerCadExportService';
import {
  getLayerDownloadAuth,
  normalizeLayerDownloadAuth,
  normalizeLayerSchema,
  resolveStrictestAuthForTables,
} from '@/service/layerDownloadAuthService';
import {
  getRoadCadFileDir,
  getRoadDocFileDir,
  resolveSafeRelativeUnderBase,
} from '@/lib/roadDocServerPaths';
import {
  createServiceFileDataZipBuffer,
  createServiceFileEntriesZipBuffer,
  createZipBufferFromMemoryEntries,
  seoulCompactTimestampForZip,
  type ZipFileEntry,
} from '@/service/serviceFileDataZipService';

export const DATA_REQUEST_FILE_TYPES = [
  'SHP',
  '레이어(SHP)',
  'ZIP',
  'EXCEL',
  '첨부파일',
  '정사영상',
] as const;

export type DataRequestFileType = (typeof DATA_REQUEST_FILE_TYPES)[number];

type SessionUser = {
  usrId: string;
  usrName: string;
  ugName: string;
  isManager: boolean;
  isAdminDept: boolean;
  isSuper: boolean;
};

/** Asia/Seoul 표시용 yyyy-MM-dd HH:mm:ss */
export function formatSeoulDateTime(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function dataRequestRootAbs(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.dataRequest);
}

async function resolveSessionUser(): Promise<SessionUser | null> {
  const usrId = (await getSessionUsrId())?.trim() ?? '';
  if (!usrId) return null;
  if (isSuperUser(usrId) || usrId === 'su') {
    return {
      usrId,
      usrName: '슈퍼관리자',
      ugName: '관리자',
      isManager: true,
      isAdminDept: true,
      isSuper: true,
    };
  }
  try {
    const [row] = await db
      .select({
        usrId: usr.usrId,
        usrName: usr.usrName,
        ugName: usr.ugName,
        usrIsManager: usr.usrIsManager,
      })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    if (!row) return null;
    const ugName = String(row.ugName ?? '').trim();
    return {
      usrId: row.usrId,
      usrName: String(row.usrName ?? '').trim() || row.usrId,
      ugName,
      isManager: Boolean(row.usrIsManager),
      isAdminDept: ugName === '관리자',
      isSuper: false,
    };
  } catch {
    return null;
  }
}

async function nextFileGroupKey(): Promise<number> {
  const res = await db.execute(
    sql.raw(
      `SELECT COALESCE(MAX(file_group_key), 0) + 1 AS next_key FROM data_request_file`
    )
  );
  const row = (res.rows?.[0] ?? {}) as { next_key?: number | string };
  const n = Number(row.next_key);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function acceptLabel(accept: string, author: string): string {
  const a = String(accept ?? '').trim();
  const auth = String(author ?? '').trim();
  if (!auth) return '자동승인';
  if (a === DRF_ACCEPT_P) return '대기중';
  if (a === DRF_ACCEPT_N) return '거부';
  if (a === DRF_ACCEPT_Y) return '승인';
  return a || '-';
}

function authorLabel(author: string): string {
  const a = String(author ?? '').trim();
  if (a === 'team') return '팀장';
  if (a === 'admin') return '관리자';
  return '';
}

/** 서약 모달용 컨텍스트 */
export async function getPledgeContext(_params?: Record<string, unknown>) {
  // 사용자·시군구 병렬 (시군구는 LIMIT 1+캐시, DISTINCT 전체 목록 대기 제거)
  const [user, sggNm] = await Promise.all([
    resolveSessionUser(),
    fetchFirstPublicLayerSggName().catch(() => ''),
  ]);
  if (!user) return { success: false as const, error: 'Unauthorized' };
  return {
    success: true as const,
    data: {
      usrId: user.usrId,
      usrName: user.usrName,
      ugName: user.ugName,
      sggNm,
      today: formatSeoulDateTime().slice(0, 10).replace(/-/g, '.'),
      canApprove: user.isManager || user.isAdminDept || user.isSuper,
      isManager: user.isManager,
      isAdminDept: user.isAdminDept,
    },
  };
}

function assertPledgeName(userName: string, pledgeName: string): string | null {
  const expected = String(userName ?? '').trim();
  const input = String(pledgeName ?? '').trim();
  if (!input) return '서약자 성명을 입력하세요.';
  if (input !== expected) return '서약자 성명이 계정 이름과 다릅니다.';
  return null;
}

/** IPv4-mapped IPv6(::ffff:x.x.x.x) → IPv4 */
export function normalizeClientIp(raw: string | null | undefined): string {
  let ip = String(raw ?? '').trim();
  if (!ip) return '';
  if (ip.includes(',')) ip = ip.split(',')[0]!.trim();
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1]!;
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  return ip;
}

function acceptFieldsFromAuth(auth: LayerDownloadAuthValue): {
  fileAccept: string;
  fileAcceptAuthor: string;
  fileAcceptDate: string | null;
  fileAcceptUser: string | null;
  filePledge: boolean;
} {
  const mode = normalizeLayerDownloadAuth(auth);
  if (mode === LDA_AUTH_NONE) {
    return {
      fileAccept: DRF_ACCEPT_Y,
      fileAcceptAuthor: '',
      fileAcceptDate: formatSeoulDateTime(),
      fileAcceptUser: '서약없음',
      filePledge: false,
    };
  }
  if (mode === LDA_AUTH_ADMIN) {
    return {
      fileAccept: DRF_ACCEPT_P,
      fileAcceptAuthor: DRF_AUTHOR_ADMIN,
      fileAcceptDate: null,
      fileAcceptUser: null,
      filePledge: true,
    };
  }
  if (mode === LDA_AUTH_TEAM) {
    return {
      fileAccept: DRF_ACCEPT_P,
      fileAcceptAuthor: DRF_AUTHOR_TEAM,
      fileAcceptDate: null,
      fileAcceptUser: null,
      filePledge: true,
    };
  }
  return {
    fileAccept: DRF_ACCEPT_Y,
    fileAcceptAuthor: '',
    fileAcceptDate: formatSeoulDateTime(),
    fileAcceptUser: '자동승인',
    filePledge: true,
  };
}

/** file_data/{layer}/{key}/... → 레이어(부모)·폴더 pk */
function parseFileDataLayerAndKey(
  relativePath: string
): { layer: string; key: string } | null {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = 'file_data/';
  if (!norm.startsWith(prefix)) return null;
  const parts = norm.slice(prefix.length).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const layer = assertSafeFileDataSegment(parts[0] ?? '');
  const key = assertSafeFileDataSegment(parts[1] ?? '');
  if (!layer || !key) return null;
  return { layer, key };
}

async function writeZipAndInsert(params: {
  user: SessionUser;
  userIp: string;
  fileType: string;
  layers: { layer: string; layerKor: string; layerKey?: string | null }[];
  zipBuffer: Buffer;
  zipName: string;
  /** 레이어 다운로드 권한 — 기본 auto */
  auth?: LayerDownloadAuthValue;
}): Promise<{ success: true; fileGroupKey: number } | { success: false; error: string }> {
  try {
    const { ensureDataRequestFileTable } = await import('@/service/ensureLayerAppTables');
    await ensureDataRequestFileTable();
  } catch {
    /* best-effort */
  }

  const fileGroupKey = await nextFileGroupKey();
  const folderRel = `${fileGroupKey}_${params.user.usrId}`.replace(/[^\w가-힣._-]+/g, '_');
  const absDir = path.join(dataRequestRootAbs(), folderRel);
  await fs.mkdir(absDir, { recursive: true });
  const safeZip = params.zipName.replace(/[^\w가-힣._-]+/g, '_') || 'download.zip';
  await fs.writeFile(path.join(absDir, safeZip), params.zipBuffer);

  const now = formatSeoulDateTime();
  const accept = acceptFieldsFromAuth(params.auth ?? LDA_AUTH_AUTO);

  const rows = params.layers.map((L) => ({
    fileGroupKey,
    fileUserId: params.user.usrId,
    fileUserName: params.user.usrName,
    fileUgName: params.user.ugName,
    fileAccept: accept.fileAccept,
    fileAcceptAuthor: accept.fileAcceptAuthor,
    fileAcceptDate: accept.fileAcceptDate,
    fileAcceptUser: accept.fileAcceptUser,
    filePath: folderRel,
    fileType: params.fileType,
    fileDate: now,
    filePledge: accept.filePledge,
    fileLayer: L.layer,
    fileLayerKor: L.layerKor,
    fileLayerKey: L.layerKey?.trim() ? L.layerKey.trim() : null,
    fileSuccess: 'Y' as const,
    fileIsDel: false,
    userIp: params.userIp || null,
    fileZipName: safeZip,
  }));

  await db.insert(dataRequestFile).values(rows);
  return { success: true, fileGroupKey };
}

function assertPledgeUnlessNone(
  userName: string,
  pledgeName: string | undefined,
  auth: LayerDownloadAuthValue
): string | null {
  if (normalizeLayerDownloadAuth(auth) === LDA_AUTH_NONE) return null;
  return assertPledgeName(userName, String(pledgeName ?? ''));
}

/** 레이어 테이블 SHP 요청 접수 */
export async function submitLayerShpRequest(params: {
  pledgeName?: string;
  tableName?: string;
  schema?: string;
  tableKorName?: string;
  userIp?: string;
  fileType?: string;
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const tableName = String(params.tableName ?? '').trim();
  if (!tableName) return { success: false as const, error: 'tableName이 필요합니다.' };
  const schema = normalizeLayerSchema(params.schema);
  const authRes = await getLayerDownloadAuth({ schema, tableName });
  const auth = authRes.success ? authRes.shpExcel : LDA_AUTH_AUTO;
  const nameErr = assertPledgeUnlessNone(user.usrName, params.pledgeName, auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const tableKorName =
    String(params.tableKorName ?? '').trim() || tableName;
  const fileType = String(params.fileType ?? '레이어(SHP)').trim() || '레이어(SHP)';

  const result = await exportLayerTableToShp({ tableName, schema });
  if (!result.success || !result.zipBuffer) {
    return { success: false as const, error: result.error ?? 'SHP 생성 실패' };
  }

  try {
    await recordLayerDownloadLog({ tableName, format: 'SHP' });
  } catch {
    /* ignore */
  }

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(params.userIp),
    fileType,
    layers: [{ layer: tableName, layerKor: tableKorName }],
    zipBuffer: Buffer.from(result.zipBuffer),
    zipName: `${tableName}.zip`,
    auth,
  });
  if (!saved.success) return saved;
  return {
    success: true as const,
    fileGroupKey: saved.fileGroupKey,
    auth,
    immediateDownload: auth === LDA_AUTH_NONE,
  };
}

/** 관망조회 SHP 요청 접수 — body는 download API와 동일 */
export async function submitWtlNetworkShpRequest(params: Record<string, unknown>) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const layerKeys = Array.isArray(params.layerKeys)
    ? (params.layerKeys as unknown[]).map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];
  const schema = normalizeLayerSchema(params.schema);
  const auth =
    layerKeys.length > 0
      ? await resolveStrictestAuthForTables({
          tables: layerKeys.map((tableName) => ({ schema, tableName })),
          kind: 'shpExcel',
        })
      : LDA_AUTH_AUTO;
  const nameErr = assertPledgeUnlessNone(user.usrName, String(params.pledgeName ?? ''), auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const result = await exportWtlNetworkShpZip(params as never);
  if (!result.success || !result.zipBuffer) {
    return {
      success: false as const,
      error: result.error ?? 'SHP 생성 실패',
      code: result.errorCode,
    };
  }

  const korName = String(params.tableKorName ?? '관망조회').trim() || '관망조회';
  const layers =
    layerKeys.length > 0
      ? layerKeys.map((k) => ({ layer: k, layerKor: korName }))
      : [{ layer: 'wtl_network', layerKor: korName }];

  const fileName = String(result.fileName ?? '관망조회_SHP.zip');

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(String(params.userIp ?? '')),
    fileType: 'SHP',
    layers,
    zipBuffer: Buffer.from(result.zipBuffer),
    zipName: fileName,
    auth,
  });
  if (!saved.success) return saved;

  try {
    await recordLayerDownloadLog({ tableName: layers[0]?.layer ?? 'wtl_network', format: 'SHP' });
  } catch {
    /* ignore */
  }

  return {
    success: true as const,
    fileGroupKey: saved.fileGroupKey,
    warning: result.warning ?? null,
    auth,
    immediateDownload: auth === LDA_AUTH_NONE,
  };
}

function resolveAttachmentAbsPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isAllowedServiceFileDataDownloadPath(normalized)) return null;
  const base = path.resolve(resolveGgnrDataDir());
  const resolvedRaw = path.resolve(base, ...normalized.split('/').filter(Boolean));
  const rel = path.relative(base, resolvedRaw);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return turbopackOpaquePath(resolvedRaw);
}

function resolveAttachmentRelativeFromParams(item: {
  pathB64?: string;
  path?: string;
}): string | null {
  const b64 = String(item.pathB64 ?? '').trim();
  if (b64) {
    const decoded = decodeServiceFileDataPathB64(b64);
    if (decoded) return decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  const p = String(item.path ?? '').trim();
  if (!p) return null;
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function uniqueZipEntryName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}_${i}${ext}`)) i += 1;
  const next = `${stem}_${i}${ext}`;
  used.add(next);
  return next;
}

/**
 * 첨부파일 다운로드 요청 접수 (fileType=첨부파일).
 * mode: single | folderZip | multi
 */
export async function submitAttachmentRequest(params: {
  pledgeName?: string;
  userIp?: string;
  tableKorName?: string;
  mode?: string;
  serEng?: string;
  pathB64?: string;
  path?: string;
  layer?: string;
  key?: string;
  label?: string;
  zipName?: string;
  schema?: string;
  tableName?: string;
  files?: { pathB64?: string; path?: string; fileName?: string }[];
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const mode = String(params.mode ?? 'single').trim() || 'single';
  const layerForAuth =
    String(params.tableName ?? '').trim() ||
    (mode === 'folderZip' ? String(params.layer ?? '').trim() : '');
  let auth: LayerDownloadAuthValue = LDA_AUTH_AUTO;
  if (layerForAuth) {
    const authRes = await getLayerDownloadAuth({
      schema: params.schema,
      tableName: layerForAuth,
    });
    auth = authRes.success ? authRes.attachment : LDA_AUTH_AUTO;
  }
  const nameErr = assertPledgeUnlessNone(user.usrName, params.pledgeName, auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const serEng = parseSerEngForServiceFileData(String(params.serEng ?? ''));
  if (serEng == null) {
    return { success: false as const, error: '유효하지 않은 serEng 입니다.' };
  }
  if (!(await userCanAccessServiceFileData(user.usrId, serEng, 'read'))) {
    return { success: false as const, error: 'Forbidden' };
  }

  const tableKorName =
    String(params.tableKorName ?? '').trim() ||
    String(params.label ?? '').trim() ||
    '첨부파일';

  let zipBuffer: Buffer;
  let zipName: string;
  /** file_data 레이어 폴더명(부모 테이블) */
  let fileLayerName: string;
  let layerKor: string;
  /** file_data/{layer}/{key} 의 key(pk 폴더명) */
  let fileFolderKey: string | null = null;

  try {
    if (mode === 'folderZip') {
      const layer = assertSafeFileDataSegment(String(params.layer ?? ''));
      const key = assertSafeFileDataSegment(String(params.key ?? ''));
      if (!layer || !key) {
        return { success: false as const, error: 'layer, key가 필요합니다.' };
      }
      const label = String(params.label ?? '').trim() || tableKorName;
      const packed = await createServiceFileDataZipBuffer({
        layerName: layer,
        keyValue: key,
        displayLabel: label,
      });
      zipBuffer = packed.zipBuffer;
      zipName = packed.downloadFileName;
      // layer 세그먼트는 첨부 저장소 기준 — 분할 레이어면 부모 테이블명
      fileLayerName = layer;
      fileFolderKey = key;
      layerKor = label;
    } else if (mode === 'multi') {
      const files = Array.isArray(params.files) ? params.files : [];
      if (files.length === 0) {
        return { success: false as const, error: '파일이 없습니다.' };
      }
      const used = new Set<string>();
      const entries: ZipFileEntry[] = [];
      let parsedMeta: { layer: string; key: string } | null = null;
      for (const f of files) {
        const rel = resolveAttachmentRelativeFromParams(f);
        if (!rel) continue;
        if (!parsedMeta) parsedMeta = parseFileDataLayerAndKey(rel);
        const abs = resolveAttachmentAbsPath(rel);
        if (!abs) continue;
        try {
          const st = await fs.stat(abs);
          if (!st.isFile()) continue;
        } catch {
          continue;
        }
        const baseName =
          String(f.fileName ?? '').trim() || path.basename(rel);
        entries.push({
          absPath: abs,
          entryName: uniqueZipEntryName(baseName, used),
        });
      }
      if (entries.length === 0) {
        return { success: false as const, error: '다운로드할 첨부파일이 없습니다.' };
      }
      const customZip = String(params.zipName ?? '').trim();
      const packed = await createServiceFileEntriesZipBuffer(
        entries,
        customZip ||
          `${seoulCompactTimestampForZip()}_${tableKorName} 첨부파일.zip`
      );
      zipBuffer = packed.zipBuffer;
      zipName = packed.downloadFileName;
      fileLayerName =
        String(params.tableName ?? '').trim() ||
        parsedMeta?.layer ||
        'attachments';
      fileFolderKey = parsedMeta?.key ?? null;
      layerKor = tableKorName;
    } else {
      const rel = resolveAttachmentRelativeFromParams({
        pathB64: params.pathB64,
        path: params.path,
      });
      if (!rel) {
        return { success: false as const, error: 'path 또는 pathB64가 필요합니다.' };
      }
      const abs = resolveAttachmentAbsPath(rel);
      if (!abs) {
        return { success: false as const, error: 'Forbidden' };
      }
      try {
        const st = await fs.stat(abs);
        if (!st.isFile()) {
          return { success: false as const, error: '파일만 요청할 수 있습니다.' };
        }
      } catch {
        return { success: false as const, error: '파일을 찾을 수 없습니다.' };
      }
      const baseName = path.basename(rel);
      const packed = await createServiceFileEntriesZipBuffer(
        [{ absPath: abs, entryName: baseName }],
        `${seoulCompactTimestampForZip()}_${baseName}.zip`
      );
      zipBuffer = packed.zipBuffer;
      zipName = packed.downloadFileName;
      const parsed = parseFileDataLayerAndKey(rel);
      fileLayerName =
        String(params.tableName ?? '').trim() ||
        parsed?.layer ||
        baseName;
      fileFolderKey = parsed?.key ?? null;
      layerKor = tableKorName || baseName;
    }
  } catch (e: unknown) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '첨부파일 준비 실패',
    };
  }

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(params.userIp),
    fileType: '첨부파일',
    layers: [
      {
        layer: fileLayerName,
        layerKor,
        layerKey: fileFolderKey,
      },
    ],
    zipBuffer,
    zipName,
    auth,
  });
  if (!saved.success) return saved;
  return {
    success: true as const,
    fileGroupKey: saved.fileGroupKey,
    auth,
    immediateDownload: auth === LDA_AUTH_NONE,
  };
}

/**
 * 클라이언트 생성 엑셀 등 바이너리 접수 (fileType=EXCEL).
 * xlsx 바이트를 ZIP에 넣어 저장 — 데이터요청 다운로드와 동일 경로.
 */
export async function submitExcelBinaryRequest(params: {
  pledgeName?: string;
  userIp?: string;
  tableKorName?: string;
  fileName?: string;
  schema?: string;
  tableName?: string;
  /** 다중 레이어(관망 등) — shpExcel 권한 중 가장 엄격한 값 */
  tableNames?: string[];
  /** raw xlsx/xls/csv bytes */
  fileBuffer?: Buffer;
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const tableName = String(params.tableName ?? '').trim();
  const tableNames = Array.isArray(params.tableNames)
    ? params.tableNames.map((n) => String(n ?? '').trim()).filter(Boolean)
    : [];
  const schema = normalizeLayerSchema(params.schema);
  let auth: LayerDownloadAuthValue = LDA_AUTH_AUTO;
  if (tableNames.length > 0) {
    auth = await resolveStrictestAuthForTables({
      tables: tableNames.map((n) => ({ schema, tableName: n })),
      kind: 'shpExcel',
    });
  } else if (tableName) {
    const authRes = await getLayerDownloadAuth({
      schema,
      tableName,
    });
    auth = authRes.success ? authRes.shpExcel : LDA_AUTH_AUTO;
  }
  const nameErr = assertPledgeUnlessNone(user.usrName, params.pledgeName, auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const buf = params.fileBuffer;
  if (!buf || buf.length === 0) {
    return { success: false as const, error: '엑셀 파일이 없습니다.' };
  }
  if (buf.length > 80 * 1024 * 1024) {
    return { success: false as const, error: '파일이 너무 큽니다. (최대 80MB)' };
  }

  let entryName = String(params.fileName ?? '').trim() || 'download.xlsx';
  entryName = entryName.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200);
  if (!/\.(xlsx|xls|csv)$/i.test(entryName)) {
    entryName = `${entryName}.xlsx`;
  }
  const tableKorName =
    String(params.tableKorName ?? '').trim() ||
    entryName.replace(/\.(xlsx|xls|csv)$/i, '') ||
    '엑셀';
  const layerLabel =
    tableNames[0] || tableName || entryName;

  try {
    const packed = await createZipBufferFromMemoryEntries(
      [{ entryName, data: buf }],
      `${seoulCompactTimestampForZip()}_${entryName}.zip`
    );
    const saved = await writeZipAndInsert({
      user,
      userIp: normalizeClientIp(params.userIp),
      fileType: 'EXCEL',
      layers: [
        {
          layer: layerLabel,
          layerKor: tableKorName,
        },
      ],
      zipBuffer: packed.zipBuffer,
      zipName: packed.downloadFileName,
      auth,
    });
    if (!saved.success) return saved;
    return {
      success: true as const,
      fileGroupKey: saved.fileGroupKey,
      auth,
      immediateDownload: auth === LDA_AUTH_NONE,
    };
  } catch (e: unknown) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '엑셀 접수 실패',
    };
  }
}

/** 시설목록 SHP 요청 접수 */
export async function submitWtlFacilityShpRequest(params: Record<string, unknown>) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const tableName = String(params.table ?? 'wtl_facility').trim() || 'wtl_facility';
  const schema = normalizeLayerSchema(params.schema);
  const authRes = await getLayerDownloadAuth({ schema, tableName });
  const auth = authRes.success ? authRes.shpExcel : LDA_AUTH_AUTO;
  const nameErr = assertPledgeUnlessNone(user.usrName, String(params.pledgeName ?? ''), auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const result = await exportFacilityShpZip(params as never);
  if (!result.success || !result.zipBuffer) {
    return { success: false as const, error: result.error ?? 'SHP 생성 실패' };
  }

  const tableKorName = String(params.tableKorName ?? '시설목록').trim() || '시설목록';
  const fileName = String(result.fileName ?? '시설목록_SHP.zip');

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(String(params.userIp ?? '')),
    fileType: 'SHP',
    layers: [{ layer: tableName, layerKor: tableKorName }],
    zipBuffer: Buffer.from(result.zipBuffer),
    zipName: fileName,
    auth,
  });
  if (!saved.success) return saved;

  try {
    await recordLayerDownloadLog({ tableName, format: 'SHP' });
  } catch {
    /* ignore */
  }

  return {
    success: true as const,
    fileGroupKey: saved.fileGroupKey,
    auth,
    immediateDownload: auth === LDA_AUTH_NONE,
  };
}

type ListParams = {
  keyword?: string;
  startDate?: string;
  endDate?: string;
  fileType?: string;
  fileUserName?: string;
  fileAccept?: string;
  /** request=데이터요청 목록, approve=승인 화면 */
  listMode?: 'request' | 'approve';
  page?: number;
  pageSize?: number;
};

function isFullViewer(user: SessionUser): boolean {
  return user.isSuper || user.isAdminDept || user.usrId === 'admin';
}

function canApproveRole(user: SessionUser): boolean {
  return user.isManager || user.isAdminDept || user.isSuper || user.usrId === 'admin';
}

function canFilterByUserRole(user: SessionUser): boolean {
  return canApproveRole(user);
}

/** 데이터 요청 목록: 슈퍼·관리자=전체, 팀장=본인+동일부서, 일반=본인 */
function visibilityForRequestList(user: SessionUser) {
  if (isFullViewer(user)) return null;
  if (user.isManager && user.ugName) {
    return or(
      eq(dataRequestFile.fileUserId, user.usrId),
      eq(dataRequestFile.fileUgName, user.ugName)
    );
  }
  return eq(dataRequestFile.fileUserId, user.usrId);
}

/** 승인 목록: 슈퍼·관리자=전체, 팀장=승인주체 team + 동일부서 */
function visibilityForApproveList(user: SessionUser) {
  if (isFullViewer(user)) return null;
  if (user.isManager && user.ugName) {
    return and(
      eq(dataRequestFile.fileAcceptAuthor, DRF_AUTHOR_TEAM),
      eq(dataRequestFile.fileUgName, user.ugName)
    );
  }
  return sql`false`;
}

function canActOnRow(
  user: SessionUser,
  row: { fileAcceptAuthor?: string | null; fileUgName?: string | null }
): boolean {
  if (user.isSuper || user.isAdminDept || user.usrId === 'admin') return true;
  const auth = String(row.fileAcceptAuthor ?? '').trim();
  if (
    user.isManager &&
    auth === DRF_AUTHOR_TEAM &&
    user.ugName &&
    String(row.fileUgName ?? '').trim() === user.ugName
  ) {
    return true;
  }
  return false;
}

/** 내 정보 알림 후보 — 승인 대기 / 승인·반려 결과 */
export type DataRequestNotifCandidate = {
  notifKey: string;
  kind: 'pending' | 'result';
  fileGroupKey: number;
  title: string;
  name: string;
  listKey: string;
  target: 'dataRequestApprove' | 'dataRequest';
};

function dataRequestNotifName(row: {
  fileUserName?: string | null;
  fileLayerKor?: string | null;
  fileLayer?: string | null;
  fileType?: string | null;
}): string {
  const who = String(row.fileUserName ?? '').trim() || '요청자';
  const layer =
    String(row.fileLayerKor ?? '').trim() ||
    String(row.fileLayer ?? '').trim() ||
    '레이어';
  const typ = String(row.fileType ?? '').trim() || '파일';
  return `${who} · ${layer} · ${typ}`;
}

/**
 * 데이터요청 알림 후보.
 * - pending: 승인 가능한 대기(P) 건 (팀장/관리자)
 * - result: 본인 요청의 승인·반려(Y/N), 수동승인만, withinDays 이내
 */
export async function listDataRequestNotifications(params?: {
  withinDays?: number;
}): Promise<{ items: DataRequestNotifCandidate[]; error?: string }> {
  const user = await resolveSessionUser();
  if (!user) return { items: [], error: '로그인이 필요합니다.' };

  const withinDays = Math.max(1, Math.min(365, Math.trunc(Number(params?.withinDays ?? 15))));
  const items: DataRequestNotifCandidate[] = [];

  try {
    if (canApproveRole(user)) {
      const pendingRows = await db
        .select()
        .from(dataRequestFile)
        .where(
          and(
            eq(dataRequestFile.fileIsDel, false),
            eq(dataRequestFile.fileAccept, DRF_ACCEPT_P),
            inArray(dataRequestFile.fileAcceptAuthor, [DRF_AUTHOR_TEAM, DRF_AUTHOR_ADMIN])
          )
        )
        .orderBy(desc(dataRequestFile.fileDate), desc(dataRequestFile.fileGroupKey));

      const pendingSeen = new Set<number>();
      for (const row of pendingRows) {
        if (!canActOnRow(user, row)) continue;
        const gk = Number(row.fileGroupKey);
        if (!Number.isFinite(gk) || pendingSeen.has(gk)) continue;
        pendingSeen.add(gk);
        const dateLabel = String(row.fileDate ?? '').trim().slice(0, 16) || '—';
        items.push({
          notifKey: `data-request-pending:${gk}`,
          kind: 'pending',
          fileGroupKey: gk,
          title: '데이터 승인 대기',
          name: dataRequestNotifName(row),
          listKey: dateLabel,
          target: 'dataRequestApprove',
        });
      }
    }

    const resultRows = await db
      .select()
      .from(dataRequestFile)
      .where(
        and(
          eq(dataRequestFile.fileIsDel, false),
          eq(dataRequestFile.fileUserId, user.usrId),
          inArray(dataRequestFile.fileAccept, [DRF_ACCEPT_Y, DRF_ACCEPT_N]),
          inArray(dataRequestFile.fileAcceptAuthor, [DRF_AUTHOR_TEAM, DRF_AUTHOR_ADMIN]),
          sql`${dataRequestFile.fileAcceptDate} IS NOT NULL`,
          sql`${dataRequestFile.fileAcceptDate}::date >= (CURRENT_DATE - ${withinDays}::int)`
        )
      )
      .orderBy(desc(dataRequestFile.fileAcceptDate), desc(dataRequestFile.fileGroupKey));

    const resultSeen = new Set<string>();
    for (const row of resultRows) {
      const gk = Number(row.fileGroupKey);
      const accept = String(row.fileAccept ?? '').trim();
      if (!Number.isFinite(gk) || (accept !== DRF_ACCEPT_Y && accept !== DRF_ACCEPT_N)) continue;
      const dedupe = `${gk}:${accept}`;
      if (resultSeen.has(dedupe)) continue;
      resultSeen.add(dedupe);
      const approved = accept === DRF_ACCEPT_Y;
      const dateLabel = String(row.fileAcceptDate ?? '').trim().slice(0, 16) || '—';
      items.push({
        notifKey: `data-request-result:${gk}:${accept}`,
        kind: 'result',
        fileGroupKey: gk,
        title: approved ? '데이터 요청 승인' : '데이터 요청 반려',
        name: dataRequestNotifName(row),
        listKey: dateLabel,
        target: 'dataRequest',
      });
    }

    return { items };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[dataRequest] notif load failed:', msg);
    return { items: [], error: msg };
  }
}

export async function listDataRequests(params: ListParams = {}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const listMode = params.listMode === 'approve' ? 'approve' : 'request';
  if (listMode === 'approve' && !canApproveRole(user)) {
    return { success: false as const, error: '승인 권한이 없습니다.' };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));

  const conditions = [eq(dataRequestFile.fileIsDel, false)];

  const vis =
    listMode === 'approve' ? visibilityForApproveList(user) : visibilityForRequestList(user);
  if (vis) conditions.push(vis);

  const keyword = String(params.keyword ?? '').trim();
  if (keyword) {
    const kw = `%${keyword}%`;
    conditions.push(
      or(
        like(dataRequestFile.fileLayer, kw),
        like(dataRequestFile.fileLayerKor, kw),
        like(dataRequestFile.fileUserName, kw),
        like(dataRequestFile.fileUserId, kw),
        like(dataRequestFile.userIp, kw),
        like(dataRequestFile.fileType, kw),
        like(dataRequestFile.fileAccept, kw),
        like(dataRequestFile.fileAcceptAuthor, kw),
        like(dataRequestFile.fileAcceptUser, kw),
        like(dataRequestFile.fileZipName, kw),
        like(dataRequestFile.filePath, kw),
        sql`CAST(${dataRequestFile.fileDate} AS text) LIKE ${kw}`,
        sql`CAST(${dataRequestFile.fileGroupKey} AS text) LIKE ${kw}`
      )!
    );
  }
  const fileType = String(params.fileType ?? '').trim();
  if (fileType) conditions.push(eq(dataRequestFile.fileType, fileType));
  const fileUserName = String(params.fileUserName ?? '').trim();
  if (fileUserName) conditions.push(eq(dataRequestFile.fileUserName, fileUserName));

  // 승인 화면 기본: 대기(P). 빈 문자열이면 전체.
  const rawAccept = params.fileAccept;
  const fileAccept =
    rawAccept === undefined && listMode === 'approve'
      ? DRF_ACCEPT_P
      : String(rawAccept ?? '').trim();
  if (fileAccept) conditions.push(eq(dataRequestFile.fileAccept, fileAccept));

  const startDate = String(params.startDate ?? '').trim();
  const endDate = String(params.endDate ?? '').trim();
  if (startDate) {
    conditions.push(sql`${dataRequestFile.fileDate}::date >= ${startDate}::date`);
  }
  if (endDate) {
    conditions.push(sql`${dataRequestFile.fileDate}::date <= ${endDate}::date`);
  }

  const where = and(...conditions);

  const allRows = await db
    .select()
    .from(dataRequestFile)
    .where(where)
    .orderBy(desc(dataRequestFile.fileDate), desc(dataRequestFile.fileGroupKey), asc(dataRequestFile.fileLayer));

  const byGroup = new Map<number, typeof allRows>();
  for (const row of allRows) {
    const g = row.fileGroupKey;
    const list = byGroup.get(g) ?? [];
    list.push(row);
    byGroup.set(g, list);
  }

  const groups = [...byGroup.entries()].map(([fileGroupKey, fileList]) => {
    const first = fileList[0]!;
    const kor = first.fileLayerKor ?? first.fileLayer ?? '';
    const extra = fileList.length > 1 ? ` 외 ${fileList.length - 1}` : '';
    const canAct = canActOnRow(user, first);
    return {
      fileGroupKey,
      fileUserName: first.fileUserName,
      fileUserId: first.fileUserId,
      fileUgName: first.fileUgName ?? null,
      userIp: normalizeClientIp(first.userIp),
      fileDate: first.fileDate,
      fileLayer: first.fileLayer ?? null,
      fileLayerKor: `${kor}${extra}`,
      fileLayerKey: first.fileLayerKey ?? null,
      fileType: first.fileType,
      fileGroupCount: fileList.length,
      fileAccept: first.fileAccept,
      fileAcceptAuthor: first.fileAcceptAuthor,
      fileAcceptDate: first.fileAcceptDate ?? null,
      acceptLabel: acceptLabel(first.fileAccept ?? '', first.fileAcceptAuthor ?? ''),
      authorLabel: authorLabel(first.fileAcceptAuthor ?? ''),
      fileSuccess: first.fileSuccess,
      fileIsDel: first.fileIsDel,
      canAct,
      fileList: fileList.map((f) => ({
        drfKey: f.drfKey,
        fileLayer: f.fileLayer,
        fileLayerKor: f.fileLayerKor,
        fileLayerKey: f.fileLayerKey ?? null,
        fileSuccess: f.fileSuccess,
        fileAccept: f.fileAccept,
        fileAcceptAuthor: f.fileAcceptAuthor,
        fileAcceptDate: f.fileAcceptDate ?? null,
        acceptLabel: acceptLabel(f.fileAccept ?? '', f.fileAcceptAuthor ?? ''),
        authorLabel: authorLabel(f.fileAcceptAuthor ?? ''),
        fileAcceptUser: f.fileAcceptUser,
      })),
    };
  });

  const totalCnt = groups.length;
  const offset = (page - 1) * pageSize;
  const pageGroups = groups.slice(offset, offset + pageSize);

  // 분류 options: 실제 저장된 file_type group by
  let fileTypes: string[] = [];
  try {
    const typeRows = await db
      .selectDistinct({ fileType: dataRequestFile.fileType })
      .from(dataRequestFile)
      .where(eq(dataRequestFile.fileIsDel, false))
      .orderBy(asc(dataRequestFile.fileType));
    fileTypes = typeRows
      .map((r) => String(r.fileType ?? '').trim())
      .filter(Boolean);
  } catch {
    fileTypes = [];
  }

  return {
    success: true as const,
    data: {
      list: pageGroups,
      totalCnt,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCnt / pageSize)),
      canApprove: canApproveRole(user),
      canFilterByUser: canFilterByUserRole(user),
      fileTypes,
      fileAccept: fileAccept || '',
    },
  };
}

export async function approveDataRequest(params: {
  fileGroupKey?: number;
  decision?: 'Y' | 'N';
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  if (!canApproveRole(user)) {
    return { success: false as const, error: '승인 권한이 없습니다.' };
  }

  const fileGroupKey = Number(params.fileGroupKey);
  if (!Number.isFinite(fileGroupKey) || fileGroupKey <= 0) {
    return { success: false as const, error: 'fileGroupKey가 필요합니다.' };
  }
  const decision = params.decision === 'N' ? DRF_ACCEPT_N : DRF_ACCEPT_Y;
  const now = formatSeoulDateTime();

  const rows = await db
    .select()
    .from(dataRequestFile)
    .where(
      and(eq(dataRequestFile.fileGroupKey, fileGroupKey), eq(dataRequestFile.fileIsDel, false))
    );

  if (rows.length === 0) return { success: false as const, error: '요청을 찾을 수 없습니다.' };

  // 권한에 맞는 대기(P) 행만 갱신
  const keys = rows
    .filter((r) => String(r.fileAccept ?? '').trim() === DRF_ACCEPT_P)
    .filter((r) => canActOnRow(user, r))
    .map((r) => r.drfKey);

  if (keys.length === 0) return { success: false as const, error: '처리할 수 있는 항목이 없습니다.' };

  await db
    .update(dataRequestFile)
    .set({
      fileAccept: decision,
      fileAcceptDate: now,
      fileAcceptUser: user.usrName,
    })
    .where(inArray(dataRequestFile.drfKey, keys));

  return { success: true as const, updated: keys.length };
}

/** 다운로드용 파일 절대경로 해석 (route에서 사용) */
export async function resolveDownloadZip(params: {
  fileGroupKey: number;
}): Promise<
  | { success: true; absPath: string; fileName: string }
  | { success: false; error: string; status?: number }
> {
  const user = await resolveSessionUser();
  if (!user) return { success: false, error: 'Unauthorized', status: 401 };

  const fileGroupKey = Number(params.fileGroupKey);
  if (!Number.isFinite(fileGroupKey) || fileGroupKey <= 0) {
    return { success: false, error: 'fileGroupKey가 필요합니다.', status: 400 };
  }

  const rows = await db
    .select()
    .from(dataRequestFile)
    .where(
      and(eq(dataRequestFile.fileGroupKey, fileGroupKey), eq(dataRequestFile.fileIsDel, false))
    )
    .orderBy(asc(dataRequestFile.drfKey));

  if (rows.length === 0) return { success: false, error: '요청을 찾을 수 없습니다.', status: 404 };

  const first = rows[0]!;
  const isOwner = first.fileUserId === user.usrId;
  const sameTeam =
    user.isManager &&
    Boolean(user.ugName) &&
    String(first.fileUgName ?? '').trim() === user.ugName;
  const canViewer = isFullViewer(user) || sameTeam;
  if (!isOwner && !canViewer) {
    return { success: false, error: '다운로드 권한이 없습니다.', status: 403 };
  }

  const allAccepted = rows.every((r) => r.fileAccept === DRF_ACCEPT_Y);
  if (!allAccepted) {
    const anyRejected = rows.some((r) => r.fileAccept === DRF_ACCEPT_N);
    return {
      success: false,
      error: anyRejected ? '승인 절차가 거부되었습니다.' : '승인 절차가 대기중입니다.',
      status: 403,
    };
  }

  const allReady = rows.every((r) => r.fileSuccess === 'Y');
  if (!allReady) {
    return { success: false, error: '파일이 준비되지 않았습니다.', status: 404 };
  }

  const zipName = String(first.fileZipName ?? '').trim() || 'download.zip';
  const absPath = path.join(dataRequestRootAbs(), first.filePath, zipName);
  try {
    await fs.access(absPath);
  } catch {
    return { success: false, error: '저장된 파일을 찾을 수 없습니다.', status: 404 };
  }

  return { success: true, absPath, fileName: zipName };
}

export type ManagedPathSource = 'fileManager' | 'roadDoc' | 'roadCad' | 'aerial';

async function collectDirFilesRecursive(
  absDir: string,
  prefix = ''
): Promise<ZipFileEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ZipFileEntry[] = [];
  for (const ent of entries) {
    const name = String(ent.name ?? '');
    if (!name || name === '.' || name === '..') continue;
    const absPath = path.join(absDir, name);
    const entryName = prefix ? `${prefix}/${name}` : name;
    if (ent.isDirectory()) {
      out.push(...(await collectDirFilesRecursive(absPath, entryName)));
      continue;
    }
    if (ent.isFile()) {
      out.push({ absPath, entryName });
    }
  }
  return out;
}

function resolveRoadDocOrCadAbs(
  source: 'roadDoc' | 'roadCad',
  rawName: string
): string | null {
  const base =
    source === 'roadDoc' ? getRoadDocFileDir() : getRoadCadFileDir();
  if (source === 'roadDoc') {
    const baseName = path.basename(rawName.trim());
    if (!baseName || baseName === '.' || baseName === '..') return null;
    const target = path.resolve(base, baseName);
    const rel = path.relative(path.resolve(base), target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
  }
  return resolveSafeRelativeUnderBase(base, rawName);
}

function resolveAerialAbs(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('aerial/') || normalized.includes('..')) return null;
  const base = path.resolve(resolveGgnrDataDir());
  const resolved = path.resolve(base, ...normalized.split('/').filter(Boolean));
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * 파일관리자·도로대장/CAD·정사영상 등 경로 기반 파일 접수.
 * service-files 첨부(serEng)와 별도.
 */
export async function submitManagedPathRequest(params: {
  pledgeName?: string;
  userIp?: string;
  tableKorName?: string;
  source?: string;
  paths?: string[];
  zipName?: string;
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
  if (nameErr) return { success: false as const, error: nameErr };

  const source = String(params.source ?? '').trim() as ManagedPathSource;
  const allowed: ManagedPathSource[] = ['fileManager', 'roadDoc', 'roadCad', 'aerial'];
  if (!allowed.includes(source)) {
    return { success: false as const, error: '유효하지 않은 다운로드 출처입니다.' };
  }

  const paths = Array.isArray(params.paths)
    ? params.paths.map((p) => String(p ?? '').trim()).filter(Boolean)
    : [];
  if (paths.length === 0) {
    return { success: false as const, error: '파일 경로가 필요합니다.' };
  }

  const tableKorName =
    String(params.tableKorName ?? '').trim() ||
    (source === 'aerial'
      ? '정사영상'
      : source === 'fileManager'
        ? '파일관리자'
        : source === 'roadCad'
          ? '도로 CAD'
          : '도로대장');

  const entries: ZipFileEntry[] = [];
  const used = new Set<string>();

  try {
    if (source === 'fileManager') {
      for (const rel of paths) {
        const target = await getFileManagerDownloadTarget({ relativePath: rel });
        if (target.isDirectory) {
          const nested = await collectDirFilesRecursive(
            target.absolutePath,
            path.basename(target.absolutePath)
          );
          for (const f of nested) {
            entries.push({
              absPath: f.absPath,
              entryName: uniqueZipEntryName(f.entryName, used),
            });
          }
        } else {
          entries.push({
            absPath: target.absolutePath,
            entryName: uniqueZipEntryName(target.fileName, used),
          });
        }
      }
    } else if (source === 'roadDoc' || source === 'roadCad') {
      for (const name of paths) {
        const abs = resolveRoadDocOrCadAbs(source, name);
        if (!abs) continue;
        try {
          const st = await fs.stat(abs);
          if (!st.isFile()) continue;
        } catch {
          continue;
        }
        entries.push({
          absPath: abs,
          entryName: uniqueZipEntryName(path.basename(abs), used),
        });
      }
    } else {
      for (const rel of paths) {
        const abs = resolveAerialAbs(rel);
        if (!abs) continue;
        try {
          const st = await fs.stat(abs);
          if (!st.isFile()) continue;
        } catch {
          continue;
        }
        entries.push({
          absPath: abs,
          entryName: uniqueZipEntryName(path.basename(abs), used),
        });
      }
    }
  } catch (e: unknown) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '파일 준비 실패',
    };
  }

  if (entries.length === 0) {
    return { success: false as const, error: '다운로드할 파일이 없습니다.' };
  }

  const customZip = String(params.zipName ?? '').trim();
  const packed = await createServiceFileEntriesZipBuffer(
    entries,
    customZip ||
      `${seoulCompactTimestampForZip()}_${tableKorName}${entries.length > 1 ? '' : `_${entries[0]!.entryName}`}.zip`
  );

  const fileType =
    source === 'aerial' ? '정사영상' : entries.length > 1 || source === 'fileManager' ? 'ZIP' : '첨부파일';

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(params.userIp),
    fileType,
    layers: [
      {
        layer: entries[0] ? path.basename(entries[0].entryName) : source,
        layerKor: tableKorName,
      },
    ],
    zipBuffer: packed.zipBuffer,
    zipName: packed.downloadFileName,
  });
  if (!saved.success) return saved;
  return { success: true as const, fileGroupKey: saved.fileGroupKey };
}

/** 레이어 CAD 변환 잡 완료 후 서약 접수 (job 임시파일 → 데이터요청 ZIP) */
export async function submitCadJobRequest(params: {
  pledgeName?: string;
  userIp?: string;
  jobId?: string;
  tableKorName?: string;
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const jobId = String(params.jobId ?? '').trim();
  if (!jobId) return { success: false as const, error: 'jobId가 필요합니다.' };

  const job = getLayerCadExportJob(jobId);
  if (!job) {
    return { success: false as const, error: 'CAD 작업을 찾을 수 없습니다.' };
  }
  if (job.status === 'pending') {
    return { success: false as const, error: 'CAD 변환이 아직 완료되지 않았습니다.' };
  }
  if (job.status === 'error') {
    return {
      success: false as const,
      error: job.error || 'CAD 변환에 실패했습니다.',
    };
  }

  const included = (job.included ?? [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  const auth = await resolveStrictestAuthForTables({
    tables: included.map((tableName) => ({ tableName })),
    kind: 'attachment',
  });
  const nameErr = assertPledgeUnlessNone(user.usrName, params.pledgeName, auth);
  if (nameErr) return { success: false as const, error: nameErr };

  const fileName = String(job.fileName ?? '').trim() || `layers.${job.format ?? 'dxf'}`;
  const tableKorName =
    String(params.tableKorName ?? '').trim() ||
    fileName.replace(/\.(dxf|dwg)$/i, '') ||
    '레이어 CAD';

  try {
    const st = await fs.stat(job.filePath);
    if (!st.isFile()) {
      return { success: false as const, error: 'CAD 파일이 없습니다.' };
    }
  } catch {
    return { success: false as const, error: 'CAD 파일을 찾을 수 없습니다.' };
  }

  try {
    for (const tableName of included) {
      try {
        await recordLayerDownloadLog({
          tableName,
          format: job.format === 'dwg' ? 'DWG' : 'DXF',
        });
      } catch (e) {
        console.warn('[submitCadJobRequest] data_log', e instanceof Error ? e.message : e);
      }
    }

    const packed = await createServiceFileEntriesZipBuffer(
      [{ absPath: job.filePath, entryName: fileName }],
      `${seoulCompactTimestampForZip()}_${fileName}.zip`
    );
    const saved = await writeZipAndInsert({
      user,
      userIp: normalizeClientIp(params.userIp),
      fileType: 'ZIP',
      layers: [{ layer: fileName, layerKor: tableKorName }],
      zipBuffer: packed.zipBuffer,
      zipName: packed.downloadFileName,
      auth,
    });
    await cleanupLayerCadExportJob(jobId);
    if (!saved.success) return saved;
    return {
      success: true as const,
      fileGroupKey: saved.fileGroupKey,
      auth,
      immediateDownload: auth === LDA_AUTH_NONE,
    };
  } catch (e: unknown) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : 'CAD 접수 실패',
    };
  }
}
