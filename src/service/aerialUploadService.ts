/**
 * 촬영(영상) 작업단위 폴더 API
 * — GGNR_DATA_DIR/aerial/{kind}/{folderName}/
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import {
  aerialWorkUnitRelativeDir,
  isAerialUploadKind,
  sanitizeAerialFolderName,
  type AerialUploadKind,
} from '@/lib/aerialUploadPaths';

const APPROVAL_SER = 'shootingApproval';
const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireSession(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  return usrId;
}

/** 승인관리 쓰기 또는 로그인 사용자(영상관리 메뉴 업로드) */
async function requireUploader(srKey?: number | null): Promise<string> {
  const usrId = await requireSession();
  if (srKey != null && Number.isFinite(srKey)) {
    const ok = await userHasSerAccess(usrId, APPROVAL_SER, 'write');
    if (!ok) throwHttp(403, '자료 등록 권한이 없습니다.');
  }
  return usrId;
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

export type CreateWorkUnitFolderResult = {
  kind: AerialUploadKind;
  folderName: string;
  workName: string;
  relativeDir: string;
  absoluteDir: string;
  created: boolean;
};

/**
 * 작업단위 폴더 생성.
 * 이미 있으면 재사용(created=false).
 */
export async function createWorkUnitFolder(params: {
  kind?: string;
  /** 시스템 폴더명 (작업일_구분_좌표계_작업단위명). 없으면 workName 사용 */
  folderName?: string;
  workName?: string;
  /** 승인 건 연결 시 — 승인관리 쓰기 권한 필요 */
  srKey?: number;
} = {}): Promise<CreateWorkUnitFolderResult> {
  const srKey =
    params.srKey != null && Number.isFinite(Number(params.srKey)) ? Number(params.srKey) : null;
  await requireUploader(srKey);

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

  // access 성공해도 디렉터리가 아닐 수 있음
  const st = await fs.stat(resolved.abs);
  if (!st.isDirectory()) {
    throwHttp(400, '같은 이름의 파일이 이미 있습니다.');
  }

  return {
    kind,
    folderName: folderRaw,
    workName,
    relativeDir: resolved.rel,
    absoluteDir: resolved.abs,
    created,
  };
}
