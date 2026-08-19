import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '@/database/db';
import { usr } from '@/database/schema/usr';
import { ug } from '@/database/schema/ug';
import { ut } from '@/database/schema/ut';
import { perm } from '@/database/schema/perm';
import { upMap } from '@/database/schema/up_map';
import { hashPassword } from '@/lib/auth/password';
import { getSessionUsrId } from '@/lib/auth/guard';
import { recordUserLog, UL_CAT_USER } from '@/service/userLogService';

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

function nowTs(): string {
  return new Date().toISOString();
}

/** 가입신청 대기: 신청시각 있음 · 승인/반려 없음 */
function isPendingSignUpRow(u: {
  usrReqTime: string | null;
  usrOkTime: string | null;
  usrCancleTime: string | null;
}): boolean {
  return Boolean(u.usrReqTime) && !u.usrOkTime && !u.usrCancleTime;
}

async function requireLoggedIn(): Promise<string> {
  const id = await getSessionUsrId();
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
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
  await requireLoggedIn();
  try {
    // 가입대기·반려는 가입승인 화면 전용. 사용자관리에는 승인(또는 신청 없이 등록)된 계정만.
    const rows = await db
      .select()
      .from(usr)
      .where(
        and(
          or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel)),
          isNull(usr.usrCancleTime),
          or(isNotNull(usr.usrOkTime), isNull(usr.usrReqTime))
        )
      )
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
  await requireLoggedIn();
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
  await requireLoggedIn();
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
  const operator = await requireLoggedIn();
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
    const okAt = nowTs();
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
          usrIsHidden: false,
          usrEtc: strOrNull(params.usr_etc),
          usrOkTime: okAt,
        })
        .returning();

      if (permKeys.length) {
        await tx.insert(upMap).values(permKeys.map((permKey) => ({ usrId, permKey })));
      }

      return created;
    });
    void recordUserLog({
      ulCat: UL_CAT_USER,
      ulContents: '사용자 생성',
      ulType: '추가',
      ulUser: usrId,
      ulGroup: ugName,
      ulWorkUser: operator,
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

/** 메인 가입신청 (비로그인). 승인 전 로그인 불가. 반려된 아이디는 재신청 시 대기로 초기화. */
export async function submitSignUp(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  const ugName = String(params.ug_name ?? '').trim();
  const utName = String(params.ut_name ?? '').trim();
  const passwordRaw = String(params.usr_pwd ?? '').trim();
  const passwordConfirm = String(params.usr_pwd_confirm ?? '').trim();
  if (!usrId) return { success: false, error: '아이디는 필수입니다.' };
  if (usrId === 'su') return { success: false, error: '사용할 수 없는 아이디입니다.' };
  if (!ugName) return { success: false, error: '부서는 필수입니다.' };
  if (!utName) return { success: false, error: '팀은 필수입니다.' };
  if (!passwordRaw) return { success: false, error: '비밀번호는 필수입니다.' };
  if (passwordRaw.length < 4) return { success: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  if (passwordRaw !== passwordConfirm) return { success: false, error: '비밀번호 확인이 일치하지 않습니다.' };
  if (!strOrNull(params.usr_name)) return { success: false, error: '이름은 필수입니다.' };

  try {
    const [exists] = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
    if (exists) {
      if (exists.usrIsDel) {
        return { success: false, error: '이미 삭제된 아이디입니다. 다른 아이디를 사용하세요.' };
      }
      // 반려된 아이디만 재신청 → 행을 승인대기로 초기화
      if (exists.usrCancleTime) {
        await ensureUgUt(ugName, utName);
        const hashed = await hashPassword(passwordRaw);
        const reqAt = nowTs();
        const [reset] = await db.transaction(async (tx) => {
          await tx.delete(upMap).where(eq(upMap.usrId, usrId));
          const [next] = await tx
            .update(usr)
            .set({
              ugName,
              utName,
              usrName: strOrNull(params.usr_name),
              usrPwd: hashed,
              usrTel: strOrNull(params.usr_tel),
              usrMail: strOrNull(params.usr_mail),
              usrEtc: strOrNull(params.usr_etc),
              usrIsHidden: false,
              usrIsManager: false,
              usrReqTime: reqAt,
              usrOkTime: null,
              usrCancleTime: null,
              usrRejectReason: null,
            })
            .where(eq(usr.usrId, usrId))
            .returning({
              usrId: usr.usrId,
              usrName: usr.usrName,
              usrReqTime: usr.usrReqTime,
            });
          return [next];
        });
        return { success: true, data: reset };
      }
      if (exists.usrReqTime && !exists.usrOkTime) {
        return { success: false, error: '이미 승인 대기 중인 아이디입니다.' };
      }
      return { success: false, error: '이미 사용 중인 아이디입니다.' };
    }

    await ensureUgUt(ugName, utName);
    const hashed = await hashPassword(passwordRaw);
    const reqAt = nowTs();
    const [created] = await db
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
        usrIsHidden: false,
        usrIsManager: false,
        usrEtc: strOrNull(params.usr_etc),
        usrReqTime: reqAt,
        usrOkTime: null,
        usrCancleTime: null,
      })
      .returning({
        usrId: usr.usrId,
        usrName: usr.usrName,
        usrReqTime: usr.usrReqTime,
      });

    return { success: true, data: created };
  } catch (error: unknown) {
    const e = error as { code?: string };
    if (e?.code === '23505') {
      return { success: false, error: '이미 사용 중인 아이디입니다.' };
    }
    if (e?.code === '23503') {
      return { success: false, error: '부서/팀 참조값이 올바르지 않습니다.' };
    }
    const message = error instanceof Error ? error.message : '가입 신청 실패';
    return { success: false, error: message };
  }
}

/** 가입신청 대기·반려만. 승인 완료는 사용자관리로 이동(목록에서 제외). 신청시간 내림차순 */
export async function listPendingSignUps(_params?: unknown) {
  await requireLoggedIn();
  try {
    const rows = await db
      .select({
        usrId: usr.usrId,
        ugName: usr.ugName,
        utName: usr.utName,
        usrName: usr.usrName,
        usrTel: usr.usrTel,
        usrMail: usr.usrMail,
        usrEtc: usr.usrEtc,
        usrReqTime: usr.usrReqTime,
        usrOkTime: usr.usrOkTime,
        usrCancleTime: usr.usrCancleTime,
        usrRejectReason: usr.usrRejectReason,
      })
      .from(usr)
      .where(
        and(
          isNotNull(usr.usrReqTime),
          isNull(usr.usrOkTime),
          or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel))
        )
      )
      .orderBy(desc(usr.usrReqTime));
    return { success: true, data: rows };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '가입 신청 목록 조회 실패';
    return { success: false, error: message, data: [] };
  }
}

export async function approveSignUp(params: Record<string, unknown>) {
  const operator = await requireLoggedIn();
  const usrId = String(params.usr_id ?? '').trim();
  const permKeys = parsePermKeys(params.perm_keys);
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };

  try {
    const [row] = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
    if (!row) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };
    if (!isPendingSignUpRow(row)) {
      return { success: false, error: '승인 대기 중인 가입 신청이 아닙니다.' };
    }

    const okAt = nowTs();
    const [updated] = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(usr)
        .set({ usrOkTime: okAt, usrCancleTime: null, usrRejectReason: null })
        .where(eq(usr.usrId, usrId))
        .returning();
      if (permKeys.length) {
        await tx.delete(upMap).where(eq(upMap.usrId, usrId));
        await tx.insert(upMap).values(permKeys.map((permKey) => ({ usrId, permKey })));
      }
      return [next];
    });
    void recordUserLog({
      ulCat: UL_CAT_USER,
      ulContents: '가입 승인',
      ulType: '추가',
      ulUser: usrId,
      ulGroup: row.ugName,
      ulWorkUser: operator,
    });
    return { success: true, data: updated };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '가입 승인 실패';
    return { success: false, error: message };
  }
}

export async function rejectSignUp(params: Record<string, unknown>) {
  const operator = await requireLoggedIn();
  const usrId = String(params.usr_id ?? '').trim();
  const rejectReason = strOrNull(params.reject_reason ?? params.rejectReason);
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };

  try {
    const [row] = await db.select().from(usr).where(eq(usr.usrId, usrId)).limit(1);
    if (!row) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };
    if (!isPendingSignUpRow(row)) {
      return { success: false, error: '승인 대기 중인 가입 신청이 아닙니다.' };
    }

    const [updated] = await db
      .update(usr)
      .set({
        usrCancleTime: nowTs(),
        usrOkTime: null,
        usrRejectReason: rejectReason,
      })
      .where(eq(usr.usrId, usrId))
      .returning();
    void recordUserLog({
      ulCat: UL_CAT_USER,
      ulContents: '가입 반려',
      ulType: '삭제',
      ulUser: usrId,
      ulGroup: row.ugName,
      ulWorkUser: operator,
      ulDetail: rejectReason,
    });
    return { success: true, data: updated };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '가입 반려 실패';
    return { success: false, error: message };
  }
}

/** 로그인 안내용. 반려된 계정만 사유를 돌려준다. 로그인 불필요. */
export async function getSignUpRejectReason(params: Record<string, unknown>) {
  const usrId = String(params.usr_id ?? '').trim();
  if (!usrId) return { success: true, data: { reason: null } };
  try {
    const [row] = await db
      .select({
        usrCancleTime: usr.usrCancleTime,
        usrRejectReason: usr.usrRejectReason,
      })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    if (!row?.usrCancleTime) return { success: true, data: { reason: null } };
    return { success: true, data: { reason: strOrNull(row.usrRejectReason) } };
  } catch {
    return { success: true, data: { reason: null } };
  }
}

export async function updateUser(params: Record<string, unknown>) {
  const operator = await requireLoggedIn();
  const usrId = String(params.usr_id ?? '').trim();
  const permKeys = parsePermKeys(params.perm_keys);
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };

  try {
    const [before] = await db
      .select({
        ugName: usr.ugName,
        utName: usr.utName,
        usrName: usr.usrName,
        usrTel: usr.usrTel,
        usrMail: usr.usrMail,
        usrEtc: usr.usrEtc,
      })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    if (!before) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };

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

    const newUg = nextUgName ?? before.ugName;
    const ugChanged = params.ug_name !== undefined && nextUgName && nextUgName !== before.ugName;
    const utChanged = params.ut_name !== undefined && nextUtName && nextUtName !== before.utName;

    if (ugChanged || utChanged) {
      const detailParts: string[] = [];
      if (ugChanged) detailParts.push(`부서: ${before.ugName ?? '—'} -> ${nextUgName}`);
      if (utChanged) detailParts.push(`팀: ${before.utName ?? '—'} -> ${nextUtName}`);
      void recordUserLog({
        ulCat: UL_CAT_USER,
        ulContents: ugChanged ? '부서 이관' : '팀 변경',
        ulType: '수정',
        ulUser: usrId,
        ulGroup: newUg,
        ulWorkUser: operator,
        ulDetail: detailParts.join('\n'),
      });
    } else {
      const infoParts: string[] = [];
      if (params.usr_name !== undefined && strOrNull(params.usr_name) !== before.usrName)
        infoParts.push(`이름: ${before.usrName ?? '—'} -> ${strOrNull(params.usr_name) ?? '—'}`);
      if (params.usr_tel !== undefined && strOrNull(params.usr_tel) !== before.usrTel)
        infoParts.push(`전화: ${before.usrTel ?? '—'} -> ${strOrNull(params.usr_tel) ?? '—'}`);
      if (params.usr_mail !== undefined && strOrNull(params.usr_mail) !== before.usrMail)
        infoParts.push(`메일: ${before.usrMail ?? '—'} -> ${strOrNull(params.usr_mail) ?? '—'}`);
      if (params.usr_etc !== undefined && strOrNull(params.usr_etc) !== before.usrEtc)
        infoParts.push(`비고: ${before.usrEtc ?? '—'} -> ${strOrNull(params.usr_etc) ?? '—'}`);
      if (nextPwd) infoParts.push('비밀번호 변경');
      void recordUserLog({
        ulCat: UL_CAT_USER,
        ulContents: '사용자 정보 수정',
        ulType: '수정',
        ulUser: usrId,
        ulGroup: newUg,
        ulWorkUser: operator,
        ulDetail: infoParts.length ? infoParts.join('\n') : undefined,
      });
    }
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
  const operator = await requireLoggedIn();
  const usrId = String(params.usr_id ?? '').trim();
  if (!usrId) return { success: false, error: 'usr_id는 필수입니다.' };
  if (usrId === 'su') return { success: false, error: 'su 계정은 삭제할 수 없습니다.' };
  try {
    const [before] = await db
      .select({ ugName: usr.ugName })
      .from(usr)
      .where(eq(usr.usrId, usrId))
      .limit(1);
    const rows = await db
      .update(usr)
      .set({ usrIsDel: true })
      .where(eq(usr.usrId, usrId))
      .returning({ usrId: usr.usrId });
    if (!rows.length) return { success: false, error: '대상 사용자를 찾을 수 없습니다.' };
    void recordUserLog({
      ulCat: UL_CAT_USER,
      ulContents: '사용자 삭제',
      ulType: '삭제',
      ulUser: usrId,
      ulGroup: before?.ugName ?? null,
      ulWorkUser: operator,
    });
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '사용자 삭제 실패';
    return { success: false, error: message };
  }
}

/** 부서 추가 */
export async function createUg(params: Record<string, unknown>) {
  await requireLoggedIn();
  const ugName = String(params.ug_name ?? '').trim();
  if (!ugName) return { success: false, error: '부서명은 필수입니다.' };
  try {
    const [exists] = await db.select().from(ug).where(eq(ug.ugName, ugName)).limit(1);
    if (exists) return { success: false, error: '이미 있는 부서입니다.' };
    const [row] = await db
      .insert(ug)
      .values({ ugName, ugIsDel: false, ugIsHidden: false, ugEtc: strOrNull(params.ug_etc) })
      .returning();
    return { success: true, data: row };
  } catch (error: unknown) {
    const e = error as { code?: string };
    if (e?.code === '23505') return { success: false, error: '이미 있는 부서입니다.' };
    const message = error instanceof Error ? error.message : '부서 추가 실패';
    return { success: false, error: message };
  }
}

/**
 * 부서명 변경 — 소속 팀·사용자 레코드의 부서명도 함께 변경.
 * (PK 변경이라 새 행 추가 → 참조 갱신 → 옛 행 삭제)
 */
export async function renameUg(params: Record<string, unknown>) {
  await requireLoggedIn();
  const oldName = String(params.old_ug_name ?? '').trim();
  const newName = String(params.new_ug_name ?? '').trim();
  if (!oldName) return { success: false, error: '기존 부서명은 필수입니다.' };
  if (!newName) return { success: false, error: '새 부서명은 필수입니다.' };
  if (oldName === newName) return { success: true, data: { ugName: newName } };

  try {
    const [oldRow] = await db.select().from(ug).where(eq(ug.ugName, oldName)).limit(1);
    if (!oldRow) return { success: false, error: '대상 부서를 찾을 수 없습니다.' };
    const [dup] = await db.select().from(ug).where(eq(ug.ugName, newName)).limit(1);
    if (dup) return { success: false, error: '이미 있는 부서명입니다.' };

    await db.transaction(async (tx) => {
      await tx.insert(ug).values({
        ugName: newName,
        ugIsDel: oldRow.ugIsDel ?? false,
        ugIsHidden: oldRow.ugIsHidden ?? false,
        ugEtc: oldRow.ugEtc,
      });
      await tx.update(ut).set({ ugName: newName }).where(eq(ut.ugName, oldName));
      await tx.update(usr).set({ ugName: newName }).where(eq(usr.ugName, oldName));
      await tx.delete(ug).where(eq(ug.ugName, oldName));
    });
    return { success: true, data: { ugName: newName } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '부서명 변경 실패';
    return { success: false, error: message };
  }
}

/** 부서 삭제 — 소속 사용자가 있으면 거부. 없으면 팀까지 cascade 삭제 */
export async function deleteUg(params: Record<string, unknown>) {
  await requireLoggedIn();
  const ugName = String(params.ug_name ?? '').trim();
  if (!ugName) return { success: false, error: '부서명은 필수입니다.' };
  try {
    const users = await db.select({ usrId: usr.usrId }).from(usr).where(eq(usr.ugName, ugName)).limit(1);
    if (users.length) {
      return { success: false, error: '이 부서에 소속된 사용자가 있어 삭제할 수 없습니다. 먼저 사용자를 다른 부서로 옮기세요.' };
    }
    const rows = await db.delete(ug).where(eq(ug.ugName, ugName)).returning({ ugName: ug.ugName });
    if (!rows.length) return { success: false, error: '대상 부서를 찾을 수 없습니다.' };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '부서 삭제 실패';
    return { success: false, error: message };
  }
}

/** 팀 추가 */
export async function createUt(params: Record<string, unknown>) {
  await requireLoggedIn();
  const utName = String(params.ut_name ?? '').trim();
  const ugName = String(params.ug_name ?? '').trim();
  if (!utName) return { success: false, error: '팀명은 필수입니다.' };
  if (!ugName) return { success: false, error: '부서는 필수입니다.' };
  try {
    const [parent] = await db.select().from(ug).where(eq(ug.ugName, ugName)).limit(1);
    if (!parent) return { success: false, error: '부서가 없습니다. 부서를 먼저 만드세요.' };
    const [exists] = await db.select().from(ut).where(eq(ut.utName, utName)).limit(1);
    if (exists) return { success: false, error: '이미 있는 팀명입니다. (팀명은 전체에서 고유해야 합니다.)' };
    const [row] = await db
      .insert(ut)
      .values({
        utName,
        ugName,
        utIsDel: false,
        utIsHidden: false,
        utEtc: strOrNull(params.ut_etc),
      })
      .returning();
    return { success: true, data: row };
  } catch (error: unknown) {
    const e = error as { code?: string };
    if (e?.code === '23505') return { success: false, error: '이미 있는 팀명입니다.' };
    if (e?.code === '23503') return { success: false, error: '부서 참조가 올바르지 않습니다.' };
    const message = error instanceof Error ? error.message : '팀 추가 실패';
    return { success: false, error: message };
  }
}

/**
 * 팀명 변경 — 해당 팀 소속 사용자도 함께 갱신.
 * ug_name을 넘기면 소속 부서도 함께 변경.
 */
export async function renameUt(params: Record<string, unknown>) {
  await requireLoggedIn();
  const oldName = String(params.old_ut_name ?? '').trim();
  const newName = String(params.new_ut_name ?? '').trim();
  const nextUg = params.ug_name !== undefined ? String(params.ug_name ?? '').trim() : null;
  if (!oldName) return { success: false, error: '기존 팀명은 필수입니다.' };
  if (!newName) return { success: false, error: '새 팀명은 필수입니다.' };

  try {
    const [oldRow] = await db.select().from(ut).where(eq(ut.utName, oldName)).limit(1);
    if (!oldRow) return { success: false, error: '대상 팀을 찾을 수 없습니다.' };
    const targetUg = nextUg || oldRow.ugName;
    const [parent] = await db.select().from(ug).where(eq(ug.ugName, targetUg)).limit(1);
    if (!parent) return { success: false, error: '부서가 없습니다.' };

    if (oldName === newName) {
      if (targetUg !== oldRow.ugName) {
        await db.update(ut).set({ ugName: targetUg }).where(eq(ut.utName, oldName));
        await db.update(usr).set({ ugName: targetUg }).where(eq(usr.utName, oldName));
      }
      return { success: true, data: { utName: newName, ugName: targetUg } };
    }

    const [dup] = await db.select().from(ut).where(eq(ut.utName, newName)).limit(1);
    if (dup) return { success: false, error: '이미 있는 팀명입니다.' };

    await db.transaction(async (tx) => {
      await tx.insert(ut).values({
        utName: newName,
        ugName: targetUg,
        utIsDel: oldRow.utIsDel ?? false,
        utIsHidden: oldRow.utIsHidden ?? false,
        utEtc: oldRow.utEtc,
      });
      await tx
        .update(usr)
        .set({ utName: newName, ugName: targetUg })
        .where(eq(usr.utName, oldName));
      await tx.delete(ut).where(eq(ut.utName, oldName));
    });
    return { success: true, data: { utName: newName, ugName: targetUg } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '팀명 변경 실패';
    return { success: false, error: message };
  }
}

/** 팀 삭제 — 소속 사용자가 있으면 거부 */
export async function deleteUt(params: Record<string, unknown>) {
  await requireLoggedIn();
  const utName = String(params.ut_name ?? '').trim();
  if (!utName) return { success: false, error: '팀명은 필수입니다.' };
  try {
    const users = await db.select({ usrId: usr.usrId }).from(usr).where(eq(usr.utName, utName)).limit(1);
    if (users.length) {
      return { success: false, error: '이 팀에 소속된 사용자가 있어 삭제할 수 없습니다. 먼저 사용자를 다른 팀으로 옮기세요.' };
    }
    const rows = await db.delete(ut).where(eq(ut.utName, utName)).returning({ utName: ut.utName });
    if (!rows.length) return { success: false, error: '대상 팀을 찾을 수 없습니다.' };
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '팀 삭제 실패';
    return { success: false, error: message };
  }
}
