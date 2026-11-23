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
} from '@/database/schema/data_request_file';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { fetchPublicLayerSggNames } from '@/lib/publicLayerSgg';
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
  if (a === DRF_ACCEPT_P) return '진행중';
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
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  let sggNm = '';
  try {
    const names = await fetchPublicLayerSggNames();
    sggNm = names[0] ?? '';
  } catch {
    sggNm = '';
  }
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

async function writeZipAndInsert(params: {
  user: SessionUser;
  userIp: string;
  fileType: string;
  layers: { layer: string; layerKor: string }[];
  zipBuffer: Buffer;
  zipName: string;
}): Promise<{ success: true; fileGroupKey: number } | { success: false; error: string }> {
  const fileGroupKey = await nextFileGroupKey();
  const folderRel = `${fileGroupKey}_${params.user.usrId}`.replace(/[^\w가-힣._-]+/g, '_');
  const absDir = path.join(dataRequestRootAbs(), folderRel);
  await fs.mkdir(absDir, { recursive: true });
  const safeZip = params.zipName.replace(/[^\w가-힣._-]+/g, '_') || 'download.zip';
  await fs.writeFile(path.join(absDir, safeZip), params.zipBuffer);

  const now = formatSeoulDateTime();
  // 당분간 전체 자동승인
  const fileAccept = DRF_ACCEPT_Y;
  const fileAcceptAuthor = '';

  const rows = params.layers.map((L) => ({
    fileGroupKey,
    fileUserId: params.user.usrId,
    fileUserName: params.user.usrName,
    fileUgName: params.user.ugName,
    fileAccept,
    fileAcceptAuthor,
    fileAcceptDate: now,
    fileAcceptUser: '자동승인',
    filePath: folderRel,
    fileType: params.fileType,
    fileDate: now,
    filePledge: true,
    fileLayer: L.layer,
    fileLayerKor: L.layerKor,
    fileSuccess: 'Y' as const,
    fileIsDel: false,
    userIp: params.userIp || null,
    fileZipName: safeZip,
  }));

  await db.insert(dataRequestFile).values(rows);
  return { success: true, fileGroupKey };
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
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
  if (nameErr) return { success: false as const, error: nameErr };

  const tableName = String(params.tableName ?? '').trim();
  if (!tableName) return { success: false as const, error: 'tableName이 필요합니다.' };
  const schemaRaw = String(params.schema ?? '').toLowerCase();
  const schema = schemaRaw === 'public_layer' ? ('public_layer' as const) : ('layer' as const);
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
  });
  if (!saved.success) return saved;
  return { success: true as const, fileGroupKey: saved.fileGroupKey };
}

/** 관망조회 SHP 요청 접수 — body는 download API와 동일 */
export async function submitWtlNetworkShpRequest(params: Record<string, unknown>) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
  if (nameErr) return { success: false as const, error: nameErr };

  const result = await exportWtlNetworkShpZip(params as never);
  if (!result.success || !result.zipBuffer) {
    return {
      success: false as const,
      error: result.error ?? 'SHP 생성 실패',
      code: result.errorCode,
    };
  }

  const layerKeys = Array.isArray(params.layerKeys)
    ? (params.layerKeys as unknown[]).map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];
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
  files?: { pathB64?: string; path?: string; fileName?: string }[];
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
  if (nameErr) return { success: false as const, error: nameErr };

  const serEng = parseSerEngForServiceFileData(String(params.serEng ?? ''));
  if (serEng == null) {
    return { success: false as const, error: '유효하지 않은 serEng 입니다.' };
  }
  if (!(await userCanAccessServiceFileData(user.usrId, serEng, 'read'))) {
    return { success: false as const, error: 'Forbidden' };
  }

  const mode = String(params.mode ?? 'single').trim() || 'single';
  const tableKorName =
    String(params.tableKorName ?? '').trim() ||
    String(params.label ?? '').trim() ||
    '첨부파일';

  let zipBuffer: Buffer;
  let zipName: string;
  let layerKey: string;
  let layerKor: string;

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
      layerKey = layer;
      layerKor = label;
    } else if (mode === 'multi') {
      const files = Array.isArray(params.files) ? params.files : [];
      if (files.length === 0) {
        return { success: false as const, error: '파일이 없습니다.' };
      }
      const used = new Set<string>();
      const entries: ZipFileEntry[] = [];
      for (const f of files) {
        const rel = resolveAttachmentRelativeFromParams(f);
        if (!rel) continue;
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
      layerKey = entries[0] ? path.basename(entries[0].entryName) : 'attachments';
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
      layerKey = baseName;
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
    layers: [{ layer: layerKey, layerKor }],
    zipBuffer,
    zipName,
  });
  if (!saved.success) return saved;
  return { success: true as const, fileGroupKey: saved.fileGroupKey };
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
  /** raw xlsx/xls/csv bytes */
  fileBuffer?: Buffer;
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
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

  try {
    const packed = await createZipBufferFromMemoryEntries(
      [{ entryName, data: buf }],
      `${seoulCompactTimestampForZip()}_${entryName}.zip`
    );
    const saved = await writeZipAndInsert({
      user,
      userIp: normalizeClientIp(params.userIp),
      fileType: 'EXCEL',
      layers: [{ layer: entryName, layerKor: tableKorName }],
      zipBuffer: packed.zipBuffer,
      zipName: packed.downloadFileName,
    });
    if (!saved.success) return saved;
    return { success: true as const, fileGroupKey: saved.fileGroupKey };
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
  const nameErr = assertPledgeName(user.usrName, String(params.pledgeName ?? ''));
  if (nameErr) return { success: false as const, error: nameErr };

  const result = await exportFacilityShpZip(params as never);
  if (!result.success || !result.zipBuffer) {
    return { success: false as const, error: result.error ?? 'SHP 생성 실패' };
  }

  const tableName = String(params.table ?? 'wtl_facility').trim() || 'wtl_facility';
  const tableKorName = String(params.tableKorName ?? '시설목록').trim() || '시설목록';
  const fileName = String(result.fileName ?? '시설목록_SHP.zip');

  const saved = await writeZipAndInsert({
    user,
    userIp: normalizeClientIp(String(params.userIp ?? '')),
    fileType: 'SHP',
    layers: [{ layer: tableName, layerKor: tableKorName }],
    zipBuffer: Buffer.from(result.zipBuffer),
    zipName: fileName,
  });
  if (!saved.success) return saved;

  try {
    await recordLayerDownloadLog({ tableName, format: 'SHP' });
  } catch {
    /* ignore */
  }

  return { success: true as const, fileGroupKey: saved.fileGroupKey };
}

type ListParams = {
  keyword?: string;
  startDate?: string;
  endDate?: string;
  fileType?: string;
  fileUserName?: string;
  mode?: 'mine' | 'approve';
  page?: number;
  pageSize?: number;
};

export async function listDataRequests(params: ListParams = {}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));

  const conditions = [eq(dataRequestFile.fileIsDel, false)];

  // 일반 사용자: 본인 요청만. 관리자·슈퍼·admin: 전체
  if (!user.isSuper && !user.isAdminDept && user.usrId !== 'admin') {
    conditions.push(eq(dataRequestFile.fileUserId, user.usrId));
  }

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
    return {
      fileGroupKey,
      fileUserName: first.fileUserName,
      fileUserId: first.fileUserId,
      userIp: normalizeClientIp(first.userIp),
      fileDate: first.fileDate,
      fileLayerKor: `${kor}${extra}`,
      fileType: first.fileType,
      fileGroupCount: fileList.length,
      fileAccept: first.fileAccept,
      fileAcceptAuthor: first.fileAcceptAuthor,
      acceptLabel: acceptLabel(first.fileAccept ?? '', first.fileAcceptAuthor ?? ''),
      fileSuccess: first.fileSuccess,
      fileIsDel: first.fileIsDel,
      fileList: fileList.map((f) => ({
        drfKey: f.drfKey,
        fileLayer: f.fileLayer,
        fileLayerKor: f.fileLayerKor,
        fileSuccess: f.fileSuccess,
        fileAccept: f.fileAccept,
        fileAcceptAuthor: f.fileAcceptAuthor,
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
      canApprove: user.isManager || user.isAdminDept || user.isSuper,
      fileTypes,
    },
  };
}

export async function approveDataRequest(params: {
  fileGroupKey?: number;
  decision?: 'Y' | 'N';
}) {
  const user = await resolveSessionUser();
  if (!user) return { success: false as const, error: 'Unauthorized' };
  if (!(user.isManager || user.isAdminDept || user.isSuper)) {
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

  // 권한에 맞는 행만 갱신
  const keys = rows
    .filter((r) => {
      if (user.isSuper) return true;
      const auth = String(r.fileAcceptAuthor ?? '').trim();
      if (user.isAdminDept && (auth === 'admin' || auth === '')) return true;
      if (user.isManager && auth === 'team' && r.fileUgName === user.ugName) return true;
      if (user.isManager && !auth) return true;
      return false;
    })
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
  const canAdmin = user.isSuper || user.isAdminDept || user.isManager;
  if (!isOwner && !canAdmin) {
    return { success: false, error: '다운로드 권한이 없습니다.', status: 403 };
  }

  const allAccepted = rows.every((r) => r.fileAccept === DRF_ACCEPT_Y);
  if (!allAccepted) {
    const anyRejected = rows.some((r) => r.fileAccept === DRF_ACCEPT_N);
    return {
      success: false,
      error: anyRejected ? '승인 절차가 거부되었습니다.' : '승인 절차가 진행중입니다.',
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
