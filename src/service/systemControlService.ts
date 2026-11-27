/**
 * 시스템 통합제어 (V6 system_control) — 항목별 on/off. 조회·변경은 su 계정만.
 */
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  readSystemControl,
  readSystemControlValues,
  writeSystemControl,
} from '@/lib/systemControlStore';
import { getOrthoZoomLimitEnabled } from '@/service/aerialOrthoService';
import { isKrasPiiAllowedForSession } from '@/service/krasPiiPermissionService';

export const SYSTEM_CONTROL_ITEMS = [
  {
    name: 'personInfo',
    label: '개인정보 마스킹',
    description: '필지정보 소유자명, 공유인·변동연혁 소유자를 * 로 표시',
  },
  {
    name: 'orthoZoomLimit',
    label: '드론영상 고화질 제한',
    description: '드론영상 타일을 제한 줌까지만 불러오고, 그 이상은 확대만 표시',
  },
] as const;

type SystemControlName = (typeof SYSTEM_CONTROL_ITEMS)[number]['name'];

function throwHttp(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function requireSu(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throwHttp(401, '로그인이 필요합니다.');
  if (usrId.trim().toLowerCase() !== 'su') throwHttp(403, '권한이 없습니다.');
  return usrId;
}

function isKnownName(name: string): name is SystemControlName {
  return SYSTEM_CONTROL_ITEMS.some((item) => item.name === name);
}

/** 통합제어 «개인정보 마스킹» ON 여부 (스냅샷·설정값) */
export async function isPersonInfoMaskEnabled(): Promise<boolean> {
  try {
    return (await readSystemControl('personInfo')) === true;
  } catch {
    return false;
  }
}

/**
 * 세션 기준 마스킹 플래그.
 * - maskOwnerNm: 통합제어 ON 또는 KRAS 원문 권한 회수 → 소유자명
 * - maskWide: KRAS 원문 권한 회수만 → 필지정보 등록번호·주소(v6 필지정보 범위). 통합제어는 적용하지 않음
 */
export async function getPersonInfoMaskFlagsForSession(): Promise<{
  maskOwnerNm: boolean;
  maskWide: boolean;
}> {
  const personInfoOn = await isPersonInfoMaskEnabled();
  const krasDenied = !(await isKrasPiiAllowedForSession());
  return {
    maskOwnerNm: personInfoOn || krasDenied,
    maskWide: krasDenied,
  };
}

/** 화면·응답에 소유자명을 가릴지 */
export async function shouldMaskPersonInfoForSession(): Promise<boolean> {
  return (await getPersonInfoMaskFlagsForSession()).maskOwnerNm;
}

/** KRAS 원문 권한 회수 시 필지정보 등록번호·주소 마스킹 */
export async function shouldMaskKrasPiiWideForSession(): Promise<boolean> {
  return (await getPersonInfoMaskFlagsForSession()).maskWide;
}

/** 클라이언트 표시용 — 소유자명(enabled) + KRAS 광범위(maskWide) */
export async function getPersonInfoMaskEnabled(_params?: unknown): Promise<{
  enabled: boolean;
  maskWide: boolean;
}> {
  const flags = await getPersonInfoMaskFlagsForSession();
  return { enabled: flags.maskOwnerNm, maskWide: flags.maskWide };
}

export async function listSystemControls(_params?: unknown): Promise<{
  items: { name: string; label: string; description: string; enabled: boolean }[];
}> {
  await requireSu();
  const values = await readSystemControlValues(SYSTEM_CONTROL_ITEMS.map((item) => item.name));
  const orthoZoomLimit = await getOrthoZoomLimitEnabled();
  return {
    items: SYSTEM_CONTROL_ITEMS.map((item) => ({
      ...item,
      enabled: item.name === 'orthoZoomLimit' ? orthoZoomLimit : values.get(item.name) === true,
    })),
  };
}

export async function updateSystemControl(params: {
  name?: string;
  enabled?: boolean;
}): Promise<{ name: string; enabled: boolean }> {
  await requireSu();
  const name = String(params?.name ?? '').trim();
  if (!isKnownName(name)) throwHttp(400, '알 수 없는 통합제어 항목입니다.');
  const enabled = params?.enabled === true;
  await writeSystemControl(name, enabled);
  return { name, enabled };
}
