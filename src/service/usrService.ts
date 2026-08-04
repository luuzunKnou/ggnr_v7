import { asc, and, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/database/db';
import { usr } from '@/database/schema/usr';
import { ug } from '@/database/schema/ug';
import { ut } from '@/database/schema/ut';
import { perm } from '@/database/schema/perm';
import { upMap } from '@/database/schema/up_map';
import { hashPassword } from '@/lib/auth/password';
import { getSessionUsrId } from '@/lib/auth/guard';

type NullableBool = boolean | null;

function boolOrNull(v: unknown): NullableBool {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return Boolean(v);
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function parsePermKeys(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const keys = v
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
  return Array.from(new Set(keys));
}

async function ensureUgUt(ugName: string, utName: string) {
  const [existingUg] = await db.select().from(ug).where(eq(ug.ugName, ugName)).limit(1);
  if (!existingUg) {
    await db.insert(ug).values({ ugName, ugIsDel: false, ugIsHidden: false });
  }

  const [existingUt] = await db.select().from(ut).where(eq(ut.utName, utName)).limit(1);
  if (!existingUt) {
    await db.insert(ut).values({ utName, ugName, utIsDel: false, utIsHidden: false });
  }
}

function formatUserDeptLabel(ugName: string | null | undefined, utName: string | null | undefined): string {
  const ug = String(ugName ?? '').trim();
  const ut = String(utName ?? '').trim();
  if (ug && ut && ug !== ut) return `${ug} · ${ut}`;
  return ug || ut || '';
}

/** 로그인 사용자 본인 프로필 (지도 «내 정보» 패널) */
export async function getMyProfile(_params?: unknown) {
  const usrId = (await getSessionUsrId())?.trim() ?? '';
  if (!usrId) return { success: false, error: 'Unauthorized' };

  if (usrId === 'su') {
    return {
      success: true,
      data: {
        usrId: 'su',
        name: '슈퍼관리자',
        dept: '시스템',
        phone: '',
        email: '',
      },
    };
  }

  try {
    const [row] = await db
      .select({
        usrId: usr.usrId,
        usrName: usr.usrName,
        ugName: usr.ugName,
        utName: usr.utName,
        usrTel: usr.usrTel,
        usrMail: usr.usrMail,
      })
      .from(usr)
      .where(and(eq(usr.usrId, usrId), or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel))))
      .limit(1);

    if (!row) return { success: false, error: '사용자를 찾을 수 없습니다.' };

    return {
      success: true,
      data: {
        usrId: row.usrId,
        name: String(row.usrName ?? '').trim() || row.usrId,
        dept: formatUserDeptLabel(row.ugName, row.utName),
        phone: String(row.usrTel ?? '').trim(),
        email: String(row.usrMail ?? '').trim(),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '내 정보 조회 실패';
    return { success: false, error: message };
  }
}

export async function getUserMeta(_params?: unknown) {
  try {
    const [ugRows, utRows] = await Promise.all([
      db.select().from(ug).orderBy(asc(ug.ugName)),
      db.select().from(ut).orderBy(asc(ut.ugName), asc(ut.utName)),
    ]);
    return { success: true, data: { ug: ugRows, ut: utRows } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '사용자 메타 조회 실패';
    return { success: false, error: message, data: { ug: [], ut: [] } };
  }
}

export async function listUsers(_params?: unknown) {
  try {
    const rows = await db
      .select()
      .from(usr)
      .where(or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel)))
      .orderBy(asc(usr.usrId));

    const mappingRows = await db
      .select({
        usrId: upMap.usrId,
        permKey: upMap.permKey,
        permName: perm.permName,
      })
      .from(upMap)
      .leftJoin(perm, eq(upMap.permKey, perm.permKey));

    const permByUser = new Map<string, Map<number, string>>();
    for (const r of mappingRows) {
      const uid = r.usrId;
      if (!uid || r.permKey == null) continue;
      const label = String(r.permName ?? '').trim() || `권한#${r.permKey}`;
      let byKey = permByUser.get(uid);
      if (!byKey) {
        byKey = new Map();
        permByUser.set(uid, byKey);
      }
      byKey.set(r.permKey, label);
    }

    const data = rows.map((u) => {
      const byKey = permByUser.get(u.usrId);
      const permNames = byKey
        ? Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'ko'))
        : [];
      return { ...u, permNames };
    });
    return { success: true, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '사용자 목록 조회 실패';
    return { success: false, error: message, data: [] };
  }
}

export async function listPermCatalog(_params?: unknown) {
  try {
    const rows = await db
      .select({
        permKey: perm.permKey,
        permName: perm.permName,
        permEtc: perm.permEtc,
      })
      .from(perm)
      .where(or(eq(perm.permIsHidden, false), isNull(perm.permIsHidden)))
      .orderBy(asc(perm.permKey));
    return { success: true, data: rows };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '권한 목록 조회 실패';
    return { success: false, error: message, data: [] };
  }
}

export async function listUserPermKeys(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.', data: [] };
  try {
    const rows = await db
      .select({ permKey: upMap.permKey })
      .from(upMap)
      .where(eq(upMap.usrId, usrId));
    const data = rows
      .map((r) => (r.permKey == null ? null : Number(r.permKey)))
      .filter((v): v is number => v != null && Number.isInteger(v) && v > 0);
    return { success: true, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '사용자 권한 조회 실패';
    return { success: false, error: message, data: [] };
  }
}

export async function createUser(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  const ugName = String(params.ug_name ?? '').trim();
  const utName = String(params.ut_name ?? '').trim();
  const passwordRaw = String(params.usr_pwd ?? '').trim();
  const permKeys = parsePermKeys(params.perm_keys);
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };
  if (!ugName) return { success: false, error: '부서는 필수입니다.' };
  if (!utName) return { success: false, error: '팀은 필수입니다.' };
  if (!passwordRaw) return { success: false, error: '비밀번호는 필수입니다.' };

  try {
    const [exists] = await db.select({ usrId: usr.usrId, usrIsDel: usr.usrIsDel }).from(usr).where(eq(usr.usrId, usrId)).limit(1);
    if (exists) {
      if (exists.usrIsDel) {
        return { success: false, error: '이미 삭제된 아이디입니다. 기존 계정을 복구하거나 다른 아이디를 사용하세요.' };
      }
      return { success: false, error: '이미 사용 중인 아이디입니다.' };
    }

    await ensureUgUt(ugName, utName);
    const hashed = await hashPassword(passwordRaw);
    const inserted = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(usr)
        .values({
          usrId,
          ugName,
          utName,
          usrName: strOrNull(params.usr_name),
          usrPwd: hashed,
          usrTel: strOrNull(params.usr_tel),
          usrMail: strOrNull(params.usr_mail),
          usrIsDel: false,
          usrEtc: strOrNull(params.usr_etc),
        })
        .returning();

      if (permKeys.length) {
        await tx.insert(upMap).values(permKeys.map((permKey) => ({ usrId, permKey })));
      }

      return created;
    });
    return { success: true, data: inserted };
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string; detail?: string };
    if (e?.code === '23505') {
      return { success: false, error: '중복 값으로 저장할 수 없습니다. 아이디를 확인하세요.' };
    }
    if (e?.code === '23503') {
      return { success: false, error: '부서/팀 참조값이 올바르지 않습니다.' };
    }
    const message = error instanceof Error ? error.message : '사용자 추가 실패';
    return { success: false, error: message };
  }
}

export async function updateUser(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  const permKeys = parsePermKeys(params.perm_keys);
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };

  try {
    const nextUgName = params.ug_name !== undefined ? strOrNull(params.ug_name) : null;
    const nextUtName = params.ut_name !== undefined ? strOrNull(params.ut_name) : null;
    if (nextUgName && nextUtName) {
      await ensureUgUt(nextUgName, nextUtName);
    }

    const patch: Record<string, unknown> = {
      ...(params.ug_name !== undefined && { ugName: strOrNull(params.ug_name) }),
      ...(params.ut_name !== undefined && { utName: strOrNull(params.ut_name) }),
      ...(params.usr_name !== undefined && { usrName: strOrNull(params.usr_name) }),
      ...(params.usr_tel !== undefined && { usrTel: strOrNull(params.usr_tel) }),
      ...(params.usr_mail !== undefined && { usrMail: strOrNull(params.usr_mail) }),
      ...(params.usr_etc !== undefined && { usrEtc: strOrNull(params.usr_etc) }),
    };

    const nextPwd = strOrNull(params.usr_pwd);
    if (nextPwd) patch.usrPwd = await hashPassword(nextPwd);

    const [updated] = await db.transaction(async (tx) => {
      const [nextUser] = await tx.update(usr).set(patch).where(eq(usr.usrId, usrId)).returning();
      await tx.delete(upMap).where(eq(upMap.usrId, usrId));
      if (permKeys.length) {
        await tx.insert(upMap).values(permKeys.map((permKey) => ({ usrId, permKey })));
      }
      return [nextUser];
    });
    if (!updated) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };
    return { success: true, data: updated };
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string; detail?: string };
    if (e?.code === '23503') {
      return { success: false, error: '부서/팀 참조값이 올바르지 않습니다.' };
    }
    const message = error instanceof Error ? error.message : '사용자 수정 실패';
    return { success: false, error: message };
  }
}

export async function deleteUser(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };
  if (usrId === 'su') return { success: false, error: 'su 계정은 삭제할 수 없습니다.' };
  try {
    const rows = await db
      .update(usr)
      .set({ usrIsDel: true })
      .where(eq(usr.usrId, usrId))
      .returning({ usrId: usr.usrId });
    if (!rows.length) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '사용자 삭제 실패';
    return { success: false, error: message };
  }
}
