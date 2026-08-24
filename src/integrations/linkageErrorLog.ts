/**
 * 시스템 연계 오류를 서비스 로그와 같은 폴더에 UTF-8로 남긴다.
 * 경로: C:\logs\linkage\YYYY-MM-DD.log
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { GGNR_SYSTEM_LOG_DIR } from '@/lib/ggnrSystemLogDir';

function seoulNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function linkageErrorLogDir(): string {
  return path.join(GGNR_SYSTEM_LOG_DIR, 'linkage');
}

export function formatLinkageError(e: unknown): string {
  if (e instanceof Error) {
    const stack = e.stack?.trim();
    if (stack && stack !== e.message) return stack;
    return e.message;
  }
  return String(e ?? '');
}

let announced = false;
let writeChain: Promise<void> = Promise.resolve();

async function writeBlock(block: string, file: string, dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, '\uFEFF', 'utf8');
  }
  await fs.appendFile(file, block, 'utf8');
  if (!announced) {
    announced = true;
    console.info(`[linkage-error-log] ${dir}`);
  }
}

/** 연계 오류 한 건을 날짜 파일에 이어 씀. 쓰기 실패해도 연계는 계속. */
export function appendLinkageError(opts: {
  system: string;
  title: string;
  detail?: string;
}): Promise<void> {
  const job = async () => {
    try {
      const now = seoulNow();
      const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
      const dir = linkageErrorLogDir();
      const file = path.join(dir, `${day}.log`);
      const body = String(opts.detail ?? '').trim() || '(메시지 없음)';
      const block = `======== ${day} ${time} | ${opts.system} | ${opts.title} ========\n${body}\n\n`;
      await writeBlock(block, file, dir);
    } catch (e) {
      console.warn('[linkage-error-log] write failed:', e instanceof Error ? e.message : e);
    }
  };
  writeChain = writeChain.then(job, job);
  return writeChain;
}
