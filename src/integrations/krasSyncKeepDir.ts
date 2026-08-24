/**
 * 행망 도형·공시 파일을 오늘 날짜 폴더에만 남기고, 이전 날짜는 지운다.
 * {GGNR_DATA_DIR}/kras_sync/YYYY-MM-DD/{이름}/
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export function krasSyncDataDir(): string {
  return (process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir').trim() || 'd:\\ggnr_data_dir';
}

export function krasSyncSeoulDay(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function krasSyncWorkDir(name: string): string {
  return path.join(krasSyncDataDir(), 'kras_sync', krasSyncSeoulDay(), name);
}

export function krasSyncRelShp(table: string, fileName: string): string {
  return path.join('kras_sync', krasSyncSeoulDay(), table, fileName).replace(/\\/g, '/');
}

/** 오늘이 아닌 kras_sync 하위(날짜 폴더·예전 레이어 폴더)를 삭제 */
export async function pruneOldKrasSyncDays(): Promise<void> {
  const root = path.join(krasSyncDataDir(), 'kras_sync');
  const today = krasSyncSeoulDay();
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === today) continue;
    await fs.rm(path.join(root, e.name), { recursive: true, force: true }).catch(() => {});
  }
}
