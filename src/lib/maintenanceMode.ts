import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * 점검(maintenance) 모드 — **준비만** 되어 있고 기본 비활성.
 *
 * - `GGNR_MAINTENANCE_MODE_ENABLED=1` : 파일 read/write 허용
 * - `MAINTENANCE_MODE_WIRED=false` : API·middleware·apply commit 에 **연동 안 함**
 *
 * 연동 확정 후 WIRED 를 true 로 바꾸고 middleware/API 에 shouldRejectWriteDuringMaintenance 적용.
 */
export const MAINTENANCE_MODE_WIRED = false;

const REL_PATH = '.cursor-runtime/maintenance.json';

export type MaintenanceState = {
  active: boolean;
  reason?: string;
  since?: string;
  source?: string;
};

export function isMaintenanceModeFeatureEnabled(): boolean {
  return process.env.GGNR_MAINTENANCE_MODE_ENABLED === '1';
}

export function getMaintenanceStatePath(cwd = process.cwd()): string {
  return path.join(cwd, REL_PATH);
}

export function readMaintenanceState(cwd = process.cwd()): MaintenanceState {
  if (!isMaintenanceModeFeatureEnabled()) return { active: false };
  try {
    const raw = fsSync.readFileSync(getMaintenanceStatePath(cwd), 'utf8');
    const parsed = JSON.parse(raw) as MaintenanceState;
    return parsed?.active === true ? parsed : { active: false };
  } catch {
    return { active: false };
  }
}

export async function writeMaintenanceState(state: MaintenanceState, cwd = process.cwd()): Promise<void> {
  if (!isMaintenanceModeFeatureEnabled()) return;
  const file = getMaintenanceStatePath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (!state.active) {
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}

/** commit cutover 시작(연동 전 no-op) */
export async function enableMaintenanceForApply(reason: string): Promise<void> {
  if (!isMaintenanceModeFeatureEnabled() || !MAINTENANCE_MODE_WIRED) return;
  await writeMaintenanceState({
    active: true,
    reason,
    since: new Date().toISOString(),
    source: 'source-apply-commit',
  });
}

/** commit cutover 종료(연동 전 no-op) */
export async function disableMaintenanceForApply(): Promise<void> {
  if (!isMaintenanceModeFeatureEnabled() || !MAINTENANCE_MODE_WIRED) return;
  await writeMaintenanceState({ active: false });
}

/** middleware/API 연동용 — WIRED=false 이면 항상 false */
export function shouldRejectWriteDuringMaintenance(): boolean {
  if (!isMaintenanceModeFeatureEnabled() || !MAINTENANCE_MODE_WIRED) return false;
  return readMaintenanceState().active === true;
}
