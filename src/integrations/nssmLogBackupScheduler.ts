import fs from 'node:fs';
import path from 'node:path';
import { calendarSlotKey } from '@/integrations/integrationSchedule';
import { resolveGgnrNpmScript } from '@/lib/ggnrBootCommand';
import { GGNR_SYSTEM_LOG_DIR } from '@/lib/ggnrSystemLogDir';

const LOG = '[nssm-log-backup]';

/** 00_nssm_install_ggnr.bat 과 동일 */
const LOG_DIR = GGNR_SYSTEM_LOG_DIR;
const BACKUP_DIR = path.join(LOG_DIR, 'backup');
const LOG_FILES = ['GGNR_V7_stdout.log', 'GGNR_V7_stderr.log'] as const;
/** nssm AppRotateFiles 가 남긴 조각: GGNR_V7_stdout-20260908T053713.053.log */
const ROTATED_LOG_RE = /^GGNR_V7_(stdout|stderr)-.+\.log$/i;

const DAILY_SCHEDULE = { mode: 'daily' as const, hour: 0, minute: 0 };

function yesterdayYmd(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function uniqueBackupDest(fileName: string): string {
  let dest = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let i = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(BACKUP_DIR, `${base}_${i}${ext}`);
    i += 1;
  }
  return dest;
}

/**
 * 활성 로그: 백업 복사 후 원본은 삭제하지 않고 0바이트로 비움.
 * nssm 회전본(타임스탬프 파일명): backup 으로 이동(원본 삭제).
 * nssm·Get-Content -Wait 가 활성 경로 핸들을 유지하도록 함.
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

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(LOG_DIR);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`readdir: ${msg}`);
    console.warn(`${LOG} readdir fail:`, msg);
    return { ok: errors.length === 0, backedUp, skipped, errors };
  }

  for (const name of entries) {
    if (!ROTATED_LOG_RE.test(name)) continue;
    const src = path.join(LOG_DIR, name);
    try {
      if (!fs.statSync(src).isFile()) continue;
      const dest = uniqueBackupDest(name);
      fs.renameSync(src, dest);
      backedUp.push(dest);
      console.info(`${LOG} moved rotated → ${dest}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      console.warn(`${LOG} fail rotated ${name}:`, msg);
    }
  }

  return { ok: errors.length === 0, backedUp, skipped, errors };
}

/**
 * 매일 00:00 — C:\\logs 활성·nssm 회전 로그 → backup
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
