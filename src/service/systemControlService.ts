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

/** 필지정보 소유자명 마스킹 여부 — 모든 사용자(su 포함) 동일 적용 */
export async function isPersonInfoMaskEnabled(): Promise<boolean> {
  try {
    return (await readSystemControl('personInfo')) === true;
  } catch {
    return false;
  }
}

export async function getPersonInfoMaskEnabled(_params?: unknown): Promise<{ enabled: boolean }> {
  return { enabled: await isPersonInfoMaskEnabled() };
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
