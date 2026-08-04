import { FOLDER_KIND_TOKEN, KIND_TO_FOLDER_TOKEN, AERIAL_KIND_ROOT } from './aerialMediaRoots';
import type { AerialKind } from './aerialMediaTypes';

export type ParsedWorkFolder =
  | {
      ok: true;
      workDate: string;
      kind: AerialKind;
      kindLabel: string;
      crsHint: string;
      workName: string;
      root: string;
    }
  | {
      ok: false;
      error: string;
    };

const DEFAULT_CRS_HINT = '5181';

/** 오늘(로컬) YYYYMMDD */
function todayYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 시스템 폴더명 생성: 작업일_구분_좌표계힌트_작업단위명
 * 사용자는 작업단위명만 입력하고, 나머지는 화면 종류·오늘 날짜로 채운다.
 */
export function buildWorkFolderName(params: {
  kind: AerialKind;
  workName: string;
  /** YYYYMMDD — 생략 시 오늘 */
  workDateYmd?: string;
  crsHint?: string;
}): string {
  const name = params.workName.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const date = params.workDateYmd ?? todayYmd();
  const token = KIND_TO_FOLDER_TOKEN[params.kind];
  const crs = params.crsHint ?? DEFAULT_CRS_HINT;
  return `${date}_${token}_${crs}_${name}`;
}

/**
 * 폴더명: 작업일_구분_좌표계힌트_작업명
 * 예) 20260703_드론영상_5181_2024 대왕암공원 촬영
 */
export function parseWorkFolderName(folderName: string): ParsedWorkFolder {
  const name = folderName.trim().replace(/[/\\]+$/, '');
  const base = name.split(/[/\\]/).pop() ?? name;
  const parts = base.split('_');
  if (parts.length < 4) {
    return { ok: false, error: '형식이 올바르지 않습니다. 작업일_구분_좌표계힌트_작업명' };
  }
  const dateRaw = parts[0] ?? '';
  const kindToken = parts[1] ?? '';
  const crsHint = parts[2] ?? '';
  const workName = parts.slice(3).join('_').trim();

  if (!/^\d{8}$/.test(dateRaw)) {
    return { ok: false, error: '작업일은 8자리 숫자(YYYYMMDD)여야 합니다.' };
  }
  const kind = FOLDER_KIND_TOKEN[kindToken];
  if (!kind) {
    return {
      ok: false,
      error: '구분은 드론영상·사진동영상·파노라마·항공영상 중 하나여야 합니다.',
    };
  }
  if (!/^\d{4,5}$/.test(crsHint)) {
    return { ok: false, error: '좌표계 힌트(숫자)가 필요합니다. 예: 5181' };
  }
  if (!workName) {
    return { ok: false, error: '작업명이 비어 있습니다.' };
  }

  const workDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  return {
    ok: true,
    workDate,
    kind,
    kindLabel: KIND_TO_FOLDER_TOKEN[kind],
    crsHint,
    workName,
    root: AERIAL_KIND_ROOT[kind],
  };
}
