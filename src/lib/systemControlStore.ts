/**
 * system_control 읽기·쓰기 (서버 전용). API 노출 금지 — 권한 확인은 호출 서비스에서.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/database/db';
import { systemControl } from '@/database/schema/system_control';

let ensured = false;

/** 테이블 없으면 생성 (push 없이 기동 가능). 기존 V6 테이블은 그대로 사용 */
async function ensureSystemControlTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_control (
      sc_name varchar PRIMARY KEY NOT NULL,
      sc_value varchar
    )
  `);
  ensured = true;
}

/** 항목별 켜짐 여부. 행이 없는 항목은 Map에 없음 */
export async function readSystemControlValues(names: string[]): Promise<Map<string, boolean>> {
  await ensureSystemControlTable();
  const rows = await db
    .select({ scName: systemControl.scName, scValue: systemControl.scValue })
    .from(systemControl)
    .where(inArray(systemControl.scName, names));
  const out = new Map<string, boolean>();
  for (const r of rows) {
    out.set(r.scName, String(r.scValue ?? '').trim().toLowerCase() === 'true');
  }
  return out;
}

/** 행이 없으면 null */
export async function readSystemControl(name: string): Promise<boolean | null> {
  const v = (await readSystemControlValues([name])).get(name);
  return v === undefined ? null : v;
}

/** 기존 행 갱신, 없으면 추가 — 기존 테이블의 고유 제약 유무와 무관 */
export async function writeSystemControl(name: string, enabled: boolean): Promise<void> {
  await ensureSystemControlTable();
  const scValue = enabled ? 'true' : 'false';
  const updated = await db
    .update(systemControl)
    .set({ scValue })
    .where(eq(systemControl.scName, name))
    .returning({ scName: systemControl.scName });
  if (updated.length === 0) {
    await db.insert(systemControl).values({ scName: name, scValue });
  }
}
