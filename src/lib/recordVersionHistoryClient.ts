import { resolveClientMachineIp } from '@/lib/clientMachineIp';

export type ClientVersionHistoryType = 'source_upload' | 'install_zip' | 'apply_latest';

/** 브라우저·클라이언트 전용 — 서비스/DB import 금지 */
export async function recordVersionHistoryClient(params: {
  historyType: ClientVersionHistoryType;
  status: 'success' | 'fail';
  message?: string;
  option?: string[];
  memo?: string;
  /** GNMS folder / version */
  version?: string;
}): Promise<void> {
  try {
    const clientIp = await resolveClientMachineIp();
    await fetch('/api/dev/version-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, clientIp }),
    });
  } catch {
    /* 이력 기록 실패는 업무 흐름을 막지 않음 */
  }
}
