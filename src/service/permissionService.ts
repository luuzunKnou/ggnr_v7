import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import db from '@/database/db';
import { perm } from '@/database/schema/perm';
import { ser } from '@/database/schema/ser';
import {
  serpMap,
  SERP_TYPE_NONE,
  SERP_TYPE_WRITE,
  SERP_TYPE_LABELS,
} from '@/database/schema/serp_map';
import { sys } from '@/database/schema/sys';
import { syspMap } from '@/database/schema/sysp_map';
import {
  usrAccessRequest,
  ACCESS_REQ_PENDING,
  ACCESS_REQ_APPROVED,
  ACCESS_REQ_REJECTED,
  TARGET_SER,
  TARGET_SYS,
} from '@/database/schema/usr_access_request';
import { usrSerGrant } from '@/database/schema/usr_ser_grant';
import { usrSysGrant } from '@/database/schema/usr_sys_grant';
import { upMap } from '@/database/schema/up_map';
import { usr } from '@/database/schema/usr';
import { getServiceList, getSystemList, getSystemListAll, getEnabledSystemsRaw } from '@/service/configService';
import { loadUserAccess } from '@/lib/auth/access';
import { listConsoleMenuCatalog as buildConsoleMenuCatalog } from '@/lib/consoleMenuAccess/registry';

type Params = Record<string, unknown> & { _sessionUsrId?: string };

/** runtime ENABLED_SYSTEMS 키 집합. 비어 있으면 필터 없음(null). */
function enabledSysKeySet(): Set<string> | null {
  const raw = getEnabledSystemsRaw();
  if (!raw) return null;
  const keys = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return keys.size > 0 ? keys : null;
}

function normalizePermSysKey(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === 'number' && Number.isFinite(v) ? String(Math.trunc(v)) : String(v).trim();
  return s || null;
}

async function isPrivateSysKey(sk: string): Promise<boolean> {
  const key = sk.trim();
  if (!key) return false;
  const cfg = getSystemList().systems.find((s) => s.sys_key?.trim() === key);
  if (cfg?.sys_is_private === true) return true;
  const n = Number(key);
  if (Number.isFinite(n) && String(n) === key) {
    const rows = await db.select({ p: sys.sysIsPrivate }).from(sys).where(eq(sys.sysKey, n)).limit(1);
    return rows[0]?.p === true;
  }
  return false;
}

function requireSession(p: Params): string {
  const id = p._sessionUsrId;
  if (!id) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return id;
}

/** 클라이언트 지도·인덱스: 비공개 서비스/시스템 권한 판별용 스냅샷 */
export async function getMyAccessSnapshot(p: Params) {
  const usrId = requireSession(p);
  const snap = await loadUserAccess(usrId);
  return {
    privateSerLevel: snap.privateSerLevel,
    privateSysKeys: snap.privateSysKeys,
    consoleMenuLevel: snap.consoleMenuLevel,
  };
}

/** 권한관리 UI: 콘솔 메뉴 카탈로그 (registry 기준) */
export async function listConsoleMenuCatalog(_p: Params) {
  requireSession(_p);
  return buildConsoleMenuCatalog();
}

export async function listPerms(_p: Params) {
  requireSession(_p);
  return db.select().from(perm).orderBy(perm.permKey);
}

export async function createPerm(p: Params) {
  requireSession(p);
  const permName = String(p.permName ?? '').trim() || '권한';
  const permEtc = p.permEtc != null ? String(p.permEtc) : null;
  const [row] = await db.insert(perm).values({ permName, permEtc }).returning();
  return row;
}

export async function updatePerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  await db
    .update(perm)
    .set({
      permName: p.permName != null ? String(p.permName) : undefined,
      permEtc: p.permEtc !== undefined ? (p.permEtc == null ? null : String(p.permEtc)) : undefined,
    })
    .where(eq(perm.permKey, permKey));
  return { ok: true };
}

export async function deletePerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  await db.delete(perm).where(eq(perm.permKey, permKey));
  return { ok: true };
}

/** `up_map` 기준: 해당 perm을 가진 사용자(삭제되지 않은 계정만) */
export async function listUsersForPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  return db
    .select({
      usrId: usr.usrId,
      utName: usr.utName,
      usrName: usr.usrName,
    })
    .from(upMap)
    .innerJoin(usr, eq(upMap.usrId, usr.usrId))
    .where(and(eq(upMap.permKey, permKey), or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel))))
    .orderBy(asc(usr.utName), asc(usr.usrName), asc(usr.usrId));
}

export async function removeUserFromPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  const usrId = String(p.usr_id ?? '').trim();
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  if (!usrId) throw new Error('usr_id required');
  await db.delete(upMap).where(and(eq(upMap.permKey, permKey), eq(upMap.usrId, usrId)));
  return { ok: true };
}

export async function listPrivateSers(_p: Params) {
  requireSession(_p);
  const dbRows = await db
    .select({
      serEng: ser.serEng,
      serKor: ser.serKor,
      serIsPrivate: ser.serIsPrivate,
      serIdx: ser.serIdx,
    })
    .from(ser)
    .where(eq(ser.serIsPrivate, true))
    .orderBy(ser.serIdx, ser.serEng);

  type Row = {
    serEng: string;
    serKor: string | null;
    serIsPrivate: boolean | null;
    _sort: number;
  };
  const byEng = new Map<string, Row>();
  for (const r of dbRows) {
    if (!r.serEng) continue;
    byEng.set(r.serEng, {
      serEng: r.serEng,
      serKor: r.serKor,
      serIsPrivate: true,
      _sort: r.serIdx ?? 1_000_000,
    });
  }
  for (const s of getServiceList().ser) {
    const eng = s.ser_eng?.trim();
    if (!eng || s.ser_is_private !== true) continue;
    if (!byEng.has(eng)) {
      byEng.set(eng, {
        serEng: eng,
        serKor: s.ser_kor ?? null,
        serIsPrivate: true,
        _sort: s.ser_idx ?? 1_000_000,
      });
    }
  }
  return [...byEng.values()]
    .sort((a, b) => a._sort - b._sort || a.serEng.localeCompare(b.serEng))
    .map(({ serEng, serKor, serIsPrivate }) => ({ serEng, serKor, serIsPrivate }));
}

export async function listPrivateSys(_p: Params) {
  requireSession(_p);
  /** 메인과 동일: ENABLED_SYSTEMS가 있으면 그 키만. 없으면 전체. */
  const enabledKeys = enabledSysKeySet();

  const dbRows = await db
    .select({
      sysKey: sys.sysKey,
      sysKor: sys.sysKor,
      sysEng: sys.sysEng,
      sysDetail: sys.sysDetail,
      sysIsPrivate: sys.sysIsPrivate,
      sysIdx: sys.sysIdx,
    })
    .from(sys)
    .where(eq(sys.sysIsPrivate, true))
    .orderBy(sys.sysIdx, sys.sysKey);

  type Row = {
    sysKey: string;
    sysKor: string | null;
    sysEng: string | null;
    sysDetail: string | null;
    sysIsPrivate: boolean | null;
    _sort: number;
  };
  const byKey = new Map<string, Row>();
  for (const r of dbRows) {
    const k = String(r.sysKey);
    if (enabledKeys && !enabledKeys.has(k)) continue;
    byKey.set(k, {
      sysKey: k,
      sysKor: r.sysKor,
      sysEng: r.sysEng,
      sysDetail: r.sysDetail,
      sysIsPrivate: true,
      _sort: r.sysIdx ?? 1_000_000,
    });
  }
  for (const s of getSystemListAll().systems) {
    const k = s.sys_key?.trim();
    if (!k || s.sys_is_private !== true) continue;
    if (enabledKeys && !enabledKeys.has(k)) continue;
    const cfgDetail =
      s.sys_detail != null && String(s.sys_detail).trim() ? String(s.sys_detail).trim() : null;
    const existing = byKey.get(k);
    if (existing) {
      if (!(existing.sysDetail ?? '').trim() && cfgDetail) {
        existing.sysDetail = cfgDetail;
      }
      const cfgKor = s.sys_kor != null ? String(s.sys_kor).trim() : '';
      if (cfgKor && !(existing.sysKor ?? '').trim()) {
        existing.sysKor = cfgKor;
      }
      continue;
    }
    byKey.set(k, {
      sysKey: k,
      sysKor: s.sys_kor ?? null,
      sysEng: s.sys_eng ?? null,
      sysDetail: cfgDetail,
      sysIsPrivate: true,
      _sort: s.sys_idx ?? 1_000_000,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a._sort - b._sort || a.sysKey.localeCompare(b.sysKey))
    .map(({ sysKey, sysKor, sysEng, sysDetail, sysIsPrivate }) => ({
      sysKey,
      sysKor,
      sysEng,
      sysDetail,
      sysIsPrivate,
    }));
}

export async function getSerpForPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  return db.select().from(serpMap).where(eq(serpMap.permKey, permKey));
}

export async function setSerpForPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  const serEng = String(p.serEng ?? '');
  const serpType = Number(p.serpType);
  if (!Number.isFinite(permKey) || !serEng) throw new Error('permKey, serEng required');
  await db
    .delete(serpMap)
    .where(and(eq(serpMap.permKey, permKey), eq(serpMap.serEng, serEng)));
  if (serpType > SERP_TYPE_NONE) {
    await db.insert(serpMap).values({ permKey, serEng, serpType });
  }
  return { ok: true };
}

export async function getSyspForPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  if (!Number.isFinite(permKey)) throw new Error('permKey required');
  return db.select().from(syspMap).where(eq(syspMap.permKey, permKey));
}

export async function setSyspForPerm(p: Params) {
  requireSession(p);
  const permKey = Number(p.permKey);
  const sysKey = normalizePermSysKey(p.sysKey);
  const enabled = p.enabled === true || p.enabled === 'true';
  if (!Number.isFinite(permKey) || !sysKey) throw new Error('permKey, sysKey required');
  await db
    .delete(syspMap)
    .where(and(eq(syspMap.permKey, permKey), eq(syspMap.sysKey, sysKey)));
  if (enabled) {
    await db.insert(syspMap).values({ permKey, sysKey });
  }
  return { ok: true };
}

export async function submitAccessRequest(p: Params) {
  const usrId = requireSession(p);
  const targetType = String(p.targetType ?? '');
  if (targetType !== TARGET_SER && targetType !== TARGET_SYS) throw new Error('targetType ser|sys');
  const serEng = p.serEng != null ? String(p.serEng) : null;
  const sysKeyStr = targetType === TARGET_SYS ? normalizePermSysKey(p.sysKey) : null;
  const requestedSerpType =
    p.requestedSerpType != null ? Number(p.requestedSerpType) : SERP_TYPE_WRITE;
  if (targetType === TARGET_SER && !serEng) throw new Error('serEng required');
  if (targetType === TARGET_SYS && !sysKeyStr) throw new Error('sysKey required');

  const requestReasonRaw = p.requestReason != null ? String(p.requestReason).trim() : '';
  const requestReason = requestReasonRaw.length > 0 ? requestReasonRaw.slice(0, 4000) : null;

  if (targetType === TARGET_SER) {
    const rows = await db.select().from(ser).where(eq(ser.serEng, serEng!)).limit(1);
    const cfgPrivate = getServiceList().ser.some(
      (s) => s.ser_eng?.trim() === serEng!.trim() && s.ser_is_private === true
    );
    if (!rows[0]?.serIsPrivate && !cfgPrivate) throw new Error('서비스가 비공개가 아닙니다.');
  } else {
    const ok = await isPrivateSysKey(sysKeyStr!);
    if (!ok) throw new Error('시스템이 비공개가 아닙니다.');
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(usrAccessRequest)
    .values({
      usrId,
      targetType,
      serEng: targetType === TARGET_SER ? serEng : null,
      sysKey: targetType === TARGET_SYS ? sysKeyStr : null,
      requestedSerpType: targetType === TARGET_SER ? requestedSerpType : null,
      requestReason,
      state: ACCESS_REQ_PENDING,
      createdAt: now,
    })
    .returning();
  return row;
}

export async function listPendingAccessRequests(_p: Params) {
  requireSession(_p);
  return db
    .select()
    .from(usrAccessRequest)
    .where(eq(usrAccessRequest.state, ACCESS_REQ_PENDING))
    .orderBy(desc(usrAccessRequest.createdAt));
}

export async function listMyAccessRequests(p: Params) {
  const usrId = requireSession(p);
  return db
    .select()
    .from(usrAccessRequest)
    .where(eq(usrAccessRequest.usrId, usrId))
    .orderBy(desc(usrAccessRequest.createdAt));
}

export async function approveAccessRequest(p: Params) {
  const operator = requireSession(p);
  const uarKey = Number(p.uarKey);
  if (!Number.isFinite(uarKey)) throw new Error('uarKey required');

  const [req] = await db
    .select()
    .from(usrAccessRequest)
    .where(and(eq(usrAccessRequest.uarKey, uarKey), eq(usrAccessRequest.state, ACCESS_REQ_PENDING)))
    .limit(1);
  if (!req) throw new Error('신청을 찾을 수 없습니다.');

  const now = new Date().toISOString();
  if (req.targetType === TARGET_SER && req.serEng) {
    const level = req.requestedSerpType ?? SERP_TYPE_WRITE;
    await db
      .delete(usrSerGrant)
      .where(and(eq(usrSerGrant.usrId, req.usrId), eq(usrSerGrant.serEng, req.serEng)));
    await db.insert(usrSerGrant).values({ usrId: req.usrId, serEng: req.serEng, serpType: level });
  } else if (req.targetType === TARGET_SYS && req.sysKey != null) {
    const exists = await db
      .select()
      .from(usrSysGrant)
      .where(and(eq(usrSysGrant.usrId, req.usrId), eq(usrSysGrant.sysKey, req.sysKey)))
      .limit(1);
    if (exists.length === 0) {
      await db.insert(usrSysGrant).values({ usrId: req.usrId, sysKey: req.sysKey });
    }
  }

  await db
    .update(usrAccessRequest)
    .set({
      state: ACCESS_REQ_APPROVED,
      processedAt: now,
      processedBy: operator,
    })
    .where(eq(usrAccessRequest.uarKey, uarKey));

  return { ok: true };
}

export async function rejectAccessRequest(p: Params) {
  const operator = requireSession(p);
  const uarKey = Number(p.uarKey);
  const reason = p.rejectReason != null ? String(p.rejectReason) : null;
  if (!Number.isFinite(uarKey)) throw new Error('uarKey required');
  const now = new Date().toISOString();
  await db
    .update(usrAccessRequest)
    .set({
      state: ACCESS_REQ_REJECTED,
      processedAt: now,
      processedBy: operator,
      rejectReason: reason,
    })
    .where(and(eq(usrAccessRequest.uarKey, uarKey), eq(usrAccessRequest.state, ACCESS_REQ_PENDING)));
  return { ok: true };
}

export { SERP_TYPE_LABELS, SERP_TYPE_NONE, TARGET_SER, TARGET_SYS };
