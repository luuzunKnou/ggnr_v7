import { call } from '@/lib/api';

export type PermMappingTab = 'ser' | 'sys';

export type SerRow = { serEng: string; serKor: string | null };
export type SysRow = {
  sysKey: string;
  sysKor: string | null;
  sysEng: string | null;
  sysDetail: string | null;
};

export async function permCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call('', 'POST', { service: 'permissionService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data;
}
