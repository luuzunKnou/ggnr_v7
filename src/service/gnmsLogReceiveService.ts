import fs from 'node:fs/promises';
import path from 'node:path';

/** 기본 저장 루트 — env `GGNR_V7_LOG_ROOT` */
export const DEFAULT_GNMS_LOG_ROOT = 'C:\\ggnr_v7_logs';

export function resolveGnmsLogRoot(): string {
  const fromEnv = (process.env.GGNR_V7_LOG_ROOT ?? '').trim();
  return fromEnv || DEFAULT_GNMS_LOG_ROOT;
}

/** 소스 업로드와 동일 Bearer env 키 */
export function resolveGnmsLogBearer(): string {
  return (
    process.env.GNMS_SOURCE_BEARER?.trim() ||
    process.env.SOURCE_UPLOAD_REMOTE_BEARER?.trim() ||
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BEARER?.trim() ||
    ''
  );
}

export function assertGnmsLogBearer(authHeader: string | null): { ok: true } | { ok: false; status: 401; error: string } {
  const expected = resolveGnmsLogBearer();
  if (!expected) return { ok: true };
  const raw = (authHeader ?? '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  const token = m?.[1]?.trim() ?? '';
  if (!token || token !== expected) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

/** 경로 세그먼트: .., /, \ 불가 */
export function assertPathSegment(value: string, field: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw Object.assign(new Error(`${field}이(가) 필요합니다.`), { status: 400 });
  if (s.includes('..') || s.includes('/') || s.includes('\\')) {
    throw Object.assign(new Error(`${field}에 .., /, \\ 를 사용할 수 없습니다.`), { status: 400 });
  }
  return s;
}

export function assertLogDate(value: string): string {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw Object.assign(new Error('date는 yyyy-mm-dd 형식이어야 합니다.'), { status: 400 });
  }
  return s;
}

export function safeLogBasename(raw: string): string {
  const base = path.basename(String(raw ?? '').trim());
  if (!base || base === '.' || base === '..') {
    throw Object.assign(new Error('유효한 파일명이 아닙니다.'), { status: 400 });
  }
  if (base.includes('/') || base.includes('\\') || base.includes('..')) {
    throw Object.assign(new Error('유효한 파일명이 아닙니다.'), { status: 400 });
  }
  return base;
}

export type GnmsLogFileInput = {
  fileName: string;
  data: Buffer;
};

export type SaveGnmsLogFilesResult = {
  ok: true;
  project: string;
  type: string;
  date: string;
  savedFiles: string[];
  dir: string;
};

export async function saveGnmsLogFiles(params: {
  project: string;
  type: string;
  date: string;
  files: GnmsLogFileInput[];
}): Promise<SaveGnmsLogFilesResult> {
  const project = assertPathSegment(params.project, 'project');
  const type = assertPathSegment(params.type, 'type');
  const date = assertLogDate(params.date);
  if (!params.files.length) {
    throw Object.assign(new Error('file 또는 files가 1개 이상 필요합니다.'), { status: 400 });
  }

  const root = resolveGnmsLogRoot();
  const dir = path.join(root, project, type, date);
  const resolvedDir = path.resolve(dir);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolvedDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('잘못된 저장 경로입니다.'), { status: 400 });
  }

  await fs.mkdir(resolvedDir, { recursive: true });

  const savedFiles: string[] = [];
  for (const f of params.files) {
    const name = safeLogBasename(f.fileName);
    const target = path.join(resolvedDir, name);
    const resolvedTarget = path.resolve(target);
    const fileRel = path.relative(resolvedDir, resolvedTarget);
    if (fileRel.startsWith('..') || path.isAbsolute(fileRel)) {
      throw Object.assign(new Error('잘못된 파일 경로입니다.'), { status: 400 });
    }
    await fs.writeFile(resolvedTarget, f.data);
    savedFiles.push(name);
  }

  return {
    ok: true,
    project,
    type,
    date,
    savedFiles,
    dir: resolvedDir,
  };
}

/** nssm 활성 로그 (실파일명) + 약칭 호환 */
const ACTIVE_LOG_NAMES = [
  'GGNR_V7_stdout.log',
  'GGNR_V7_stderr.log',
  'stdout.log',
  'stderr.log',
] as const;

/** 일일 백업: 20260908_GGNR_V7_stdout.log */
const BACKUP_STAMP_RE = /^(\d{8})_(.+)$/i;
/** nssm 회전: GGNR_V7_stdout-20260908T053713.053.log */
const ROTATED_STAMP_RE = /^GGNR_V7_(stdout|stderr)-(\d{4})(\d{2})(\d{2})T.+\.log$/i;
const ANY_SERVICE_LOG_RE = /^(GGNR_V7_)?(stdout|stderr)/i;

export function getGnmsLogBootContext(): { project: string; type: string } {
  return {
    project: (process.env.GGNR_PROJECT ?? '').trim() || 'unknown',
    type: (process.env.GGNR_ENV ?? '').trim() || 'unknown',
  };
}

function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ymdCompactToDash(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** 파일명에서 로그 날짜(yyyy-mm-dd) 추론. 활성 로그는 null(오늘로 취급). */
export function inferLogFileDate(fileName: string): string | null {
  const base = path.basename(fileName);
  const stamped = BACKUP_STAMP_RE.exec(base);
  if (stamped) {
    return ymdCompactToDash(stamped[1]!);
  }
  const rotated = ROTATED_STAMP_RE.exec(base);
  if (rotated) {
    return `${rotated[2]}-${rotated[3]}-${rotated[4]}`;
  }
  const iso = base.match(/(\d{4})(\d{2})(\d{2})T\d{6}/);
  if (iso && ANY_SERVICE_LOG_RE.test(base)) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return null;
}

function isCandidateLogName(name: string): boolean {
  if ((ACTIVE_LOG_NAMES as readonly string[]).includes(name)) return true;
  if (BACKUP_STAMP_RE.test(name) && /stdout|stderr/i.test(name)) return true;
  if (ROTATED_STAMP_RE.test(name)) return true;
  if (/^GGNR_V7_(stdout|stderr)-.+\.log$/i.test(name)) return true;
  return false;
}

export type GatheredLogFile = {
  fileName: string;
  data: Buffer;
  date: string;
  sourcePath: string;
};

/**
 * C:\\logs 활성·회전본 + backup 폴더 수집.
 * dateFilter(yyyy-mm-dd) 있으면 해당 날짜만, 없으면 전부.
 * 활성 로그(날짜 없는 이름)는 오늘 날짜로 분류하며, 필터가 오늘이 아니면 제외.
 */
export async function gatherLocalServiceLogs(params?: {
  dateFilter?: string | null;
  logDir?: string;
}): Promise<GatheredLogFile[]> {
  const { GGNR_SYSTEM_LOG_DIR } = await import('@/lib/ggnrSystemLogDir');
  const logDir = params?.logDir?.trim() || GGNR_SYSTEM_LOG_DIR;
  const backupDir = path.join(logDir, 'backup');
  const filterRaw = (params?.dateFilter ?? '').trim();
  const filter = filterRaw ? assertLogDate(filterRaw) : null;
  const today = todayYmd();

  const dirs = [logDir, backupDir];
  const out: GatheredLogFile[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!isCandidateLogName(name)) continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      const inferred = inferLogFileDate(name);
      const isActive = (ACTIVE_LOG_NAMES as readonly string[]).includes(name);
      const fileDate = inferred ?? (isActive ? today : null);
      if (!fileDate) continue;
      if (filter && fileDate !== filter) continue;

      const key = `${fileDate}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const data = await fs.readFile(abs);
      out.push({
        fileName: name,
        data,
        date: fileDate,
        sourcePath: abs,
      });
    }
  }

  return out;
}

/** 기동 인자 project/type으로 로컬 로그를 모아 원격 GNMS `POST /api/logs` 로 전송 (소스 업로드와 동일 undici·Bearer) */
export async function uploadLocalServiceLogsToRemoteGnms(params?: {
  dateFilter?: string | null;
}): Promise<{
  project: string;
  type: string;
  fileCount: number;
  dirs: string[];
  savedFiles: string[];
  remoteUrl: string;
}> {
  const boot = getGnmsLogBootContext();
  const gathered = await gatherLocalServiceLogs({ dateFilter: params?.dateFilter });
  if (!gathered.length) {
    throw Object.assign(
      new Error(
        params?.dateFilter
          ? `해당 날짜(${params.dateFilter})의 로그 파일이 없습니다.`
          : 'C:\\logs 및 backup 에서 수집할 로그가 없습니다.'
      ),
      { status: 400 }
    );
  }

  const { getRemoteLogsApiUrl, postRemoteLogsMultipart } = await import(
    '@/service/sourceUploadRemote'
  );
  const remoteUrl = getRemoteLogsApiUrl();

  const dirs: string[] = [];
  const savedFiles: string[] = [];

  /** 파일 단위 전송 — 대용량 multipart 게이트 잘림·boundary 이슈 완화 */
  for (const g of gathered) {
    const res = await postRemoteLogsMultipart({
      fields: {
        project: boot.project,
        type: boot.type,
        date: g.date,
      },
      files: [{ fieldName: 'file', fileName: g.fileName, data: g.data }],
    });
    const json = res.json as {
      error?: string;
      ok?: boolean;
      dir?: string;
      savedFiles?: string[];
    };
    if (res.status < 200 || res.status >= 300) {
      throw Object.assign(
        new Error(
          (typeof json.error === 'string' && json.error) ||
            res.text.slice(0, 400) ||
            `GNMS 로그 업로드 실패 (HTTP ${res.status})`
        ),
        { status: res.status >= 400 && res.status < 600 ? res.status : 500 }
      );
    }
    if (typeof json.dir === 'string' && json.dir && !dirs.includes(json.dir)) {
      dirs.push(json.dir);
    }
    const names = Array.isArray(json.savedFiles) ? json.savedFiles : [g.fileName];
    savedFiles.push(...names.map((f) => `${g.date}/${f}`));
  }

  return {
    project: boot.project,
    type: boot.type,
    fileCount: gathered.length,
    dirs,
    savedFiles,
    remoteUrl,
  };
}

/** @deprecated 로컬 저장 — `uploadLocalServiceLogsToRemoteGnms` 사용 */
export async function archiveLocalServiceLogsToGnmsRoot(params?: {
  dateFilter?: string | null;
}): Promise<{
  project: string;
  type: string;
  fileCount: number;
  dirs: string[];
  savedFiles: string[];
}> {
  const r = await uploadLocalServiceLogsToRemoteGnms(params);
  return {
    project: r.project,
    type: r.type,
    fileCount: r.fileCount,
    dirs: r.dirs,
    savedFiles: r.savedFiles,
  };
}
