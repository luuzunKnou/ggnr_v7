/**
 * 프로젝트 runtime.env 파일 직접 파싱 (Next noStore 없이 — instrumentation·스케줄러용).
 */
import fs from 'fs';
import path from 'path';

function projectRoot(): string {
  return process.cwd();
}

/** GGNR_PROJECT 의 src/config/projects/<project>.runtime.env */
export function readProjectRuntimeEnvVars(): Record<string, string> {
  const project = (process.env.GGNR_PROJECT ?? '').trim();
  if (!project) return {};
  const filePath = path.join(projectRoot(), 'src', 'config', 'projects', `${project}.runtime.env`);
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const out: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** 스케줄러 코드명 — instrumentation / DISABLED_SCHEDULERS 와 맞춤 */
export const SCHEDULER_CODES = {
  useFeeSync: 'useFeeSync',
  safetydata: 'safetydata',
  kais: 'kais',
  krasLayer: 'krasLayer',
  nssmLogBackup: 'nssmLogBackup',
} as const;

export type SchedulerCode = (typeof SCHEDULER_CODES)[keyof typeof SCHEDULER_CODES];

/**
 * runtime.env DISABLED_SCHEDULERS=useFeeSync,kais
 * — 목록에 있으면 해당 스케줄러 등록 안 함.
 */
export function isSchedulerDisabledInRuntime(code: string): boolean {
  const raw = (readProjectRuntimeEnvVars().DISABLED_SCHEDULERS ?? '').trim();
  if (!raw) return false;
  const want = String(code ?? '')
    .trim()
    .toLowerCase();
  if (!want) return false;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(want);
}

/**
 * ENABLED_SYSTEMS 파싱.
 * 키 없음/빈 문자열 → null(전체 허용, 시스템목록과 동일 관례).
 */
export function getEnabledSystemKeysFromRuntime(): string[] | null {
  const raw = (readProjectRuntimeEnvVars().ENABLED_SYSTEMS ?? '').trim();
  if (!raw) return null;
  const keys = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return keys.length ? keys : null;
}
