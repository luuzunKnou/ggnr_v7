import fs from 'node:fs';
import path from 'node:path';
import { calendarSlotKey } from '@/integrations/integrationSchedule';
import { resolveGgnrNpmScript } from '@/lib/ggnrBootCommand';

const LOG = '[nssm-log-backup]';

/** nssm_install_ggnr.bat 과 동일 */
const LOG_DIR = 'C:\\logs';
const BACKUP_DIR = path.join(LOG_DIR, 'backup');
const LOG_FILES = ['GGNR_V7_stdout.log', 'GGNR_V7_stderr.log'] as const;

const DAILY_SCHEDULE = { mode: 'daily' as const, hour: 0, minute: 0 };

function yesterdayYmd(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 백업 복사 후 원본은 삭제하지 않고 0바이트로 비움.
 * nssm·Get-Content -Wait 가 같은 경로 핸들을 유지하도록 함.
 */
export function rotateNssmServiceLogs(now = new Date()): {
  ok: boolean;
  backedUp: string[];
  skipped: string[];
  errors: string[];
} {
  const backedUp: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const stamp = yesterdayYmd(now);

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      console.info(`${LOG} mkdir ${BACKUP_DIR}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`backup dir: ${msg}`);
    console.warn(`${LOG} backup dir fail:`, msg);
    return { ok: false, backedUp, skipped, errors };
  }

  for (const name of LOG_FILES) {
    const src = path.join(LOG_DIR, name);
    const dest = path.join(BACKUP_DIR, `${stamp}_${name}`);
    if (!fs.existsSync(src)) {
      skipped.push(name);
      continue;
    }
    try {
      fs.copyFileSync(src, dest);
      fs.truncateSync(src, 0);
      backedUp.push(dest);
      console.info(`${LOG} backed up → ${dest}, truncated ${src}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      console.warn(`${LOG} fail ${name}:`, msg);
    }
  }

  return { ok: errors.length === 0, backedUp, skipped, errors };
}

/**
 * 매일 00:00 — C:\\logs 서비스 로그 → backup\\yyyyMMdd_파일명
 * `npm run start` 일 때만 등록(호출 측에서 가드). 기동 직후 실행 없음.
 */
export function startNssmLogBackupScheduler(): void {
  if (resolveGgnrNpmScript() !== 'start') {
    console.info(`${LOG} skipped (not start: ${resolveGgnrNpmScript()})`);
    return;
  }

  console.info(`${LOG} registered: daily 00:00, no run on startup`);

  let lastSlot: string | null = null;

  setInterval(() => {
    const now = new Date();
    const slot = calendarSlotKey(DAILY_SCHEDULE, now);
    if (!slot) return;
    if (lastSlot === slot) return;
    lastSlot = slot;
    void Promise.resolve().then(() => rotateNssmServiceLogs(now));
  }, 15_000);
}
