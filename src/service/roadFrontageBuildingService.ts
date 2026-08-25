/**
 * 접도구역 기존 건축물(공작물) 관리대장
 */
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  roadFrontageBuilding,
  roadFrontageBuildingConfirm,
  roadFrontageBuildingDetail,
} from '@/database/schema/road_frontage_building';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  applyDefaultStyleToLayer,
  createOrUpdateGeoServerLayer,
  getGeoServerLayerList,
  getGeoServerStyleList,
  setLayerDefaultStyle,
} from '@/service/devTestService';
import {
  ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
  emptyRoadFrontageBuildingFormAttaches,
  type RoadFrontageBuildingConfirmItem,
  type RoadFrontageBuildingDetailItem,
  type RoadFrontageBuildingLedger,
} from '@/app/(pages)/map/_mapContents/road/roadFrontageBuilding/roadFrontageBuildingMock';

function dbCause(e: unknown): Error {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur instanceof Error; i++) {
    const cause = (cur as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && /^Failed query:/i.test(cur.message) && cause.message.trim()) {
      cur = cause;
      continue;
    }
    break;
  }
  return cur instanceof Error ? cur : new Error(String(e));
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function tx(s: string | null | undefined): string {
  return String(s ?? '').trim();
}

function parseId(id: unknown): number | null {
  const n = Number(String(id ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function isBlankDetail(d: RoadFrontageBuildingDetailItem): boolean {
  return (
    toNum(d.dongNo) == null &&
    !tx(d.installedDate) &&
    !tx(d.structure) &&
    !tx(d.usageType) &&
    toNum(d.areaSqm) == null &&
    !tx(d.locationKind) &&
    !(d.badMarks ?? []).length
  );
}

function isBlankConfirm(c: RoadFrontageBuildingConfirmItem): boolean {
  return !tx(c.confirmDate) && !tx(c.confirmerName) && !tx(c.approverName);
}

function marksToText(marks: string[] | undefined): string | null {
  const list = (marks ?? []).map((m) => String(m).trim()).filter(Boolean);
  return list.length ? list.join(',') : null;
}

function textToMarks(s: string | null | undefined): string[] {
  return String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function updateGeom(id: number, lon: number | null, lat: number | null) {
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    await db
      .update(roadFrontageBuilding)
      .set({ geom: null })
      .where(eq(roadFrontageBuilding.id, id));
    return;
  }
  await db.execute(
    sql.raw(
      `UPDATE layer.road_frontage_building
       SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)
       WHERE id = ${id}`
    )
  );
}

function toDetailItem(
  row: typeof roadFrontageBuildingDetail.$inferSelect
): RoadFrontageBuildingDetailItem {
  return {
    id: String(row.id),
    dongNo: toNum(row.dongNo),
    installedDate: tx(row.installedDate),
    structure: tx(row.structure),
    usageType: tx(row.usageType),
    areaSqm: toNum(row.areaSqm),
    locationKind: (row.locationKind === '도로예정지' || row.locationKind === '접도구역'
      ? row.locationKind
      : '') as RoadFrontageBuildingDetailItem['locationKind'],
    badMarks: textToMarks(row.badMarks),
  };
}

function toConfirmItem(
  row: typeof roadFrontageBuildingConfirm.$inferSelect
): RoadFrontageBuildingConfirmItem {
  return {
    id: String(row.id),
    confirmDate: tx(row.confirmDate),
    confirmerName: tx(row.confirmerName),
    approverName: tx(row.approverName),
  };
}

function toLedger(
  row: typeof roadFrontageBuilding.$inferSelect,
  details: RoadFrontageBuildingDetailItem[],
  confirms: RoadFrontageBuildingConfirmItem[],
): RoadFrontageBuildingLedger {
  return {
    id: String(row.id),
    roadType: tx(row.roadType),
    routeNo: tx(row.routeNo),
    routeName: tx(row.routeName),
    serialNo: tx(row.serialNo),
    preparedDate: tx(row.preparedDate),
    locationAddress: tx(row.locationAddress),
    residentName: tx(row.residentName),
    residentPhone: tx(row.residentPhone),
    buildingOwnerName: tx(row.buildingOwnerName),
    buildingOwnerPhone: tx(row.buildingOwnerPhone),
    buildingOwnerAddress: tx(row.buildingOwnerAddress),
    landOwnerName: tx(row.landOwnerName),
    landOwnerPhone: tx(row.landOwnerPhone),
    landOwnerAddress: tx(row.landOwnerAddress),
    writerDept: tx(row.writerDept) || ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
    writerName: tx(row.writerName),
    writtenAt: tx(row.writtenAt),
    mockLonLat: {
      lon: row.lon ?? 0,
      lat: row.lat ?? 0,
    },
    details,
    confirmHistory: confirms,
    photos: [],
    formAttaches: emptyRoadFrontageBuildingFormAttaches(),
    formAttachShotDates: {
      before: tx(row.attachShotBefore),
      after: tx(row.attachShotAfter),
    },
  };
}

async function loadChildren(parentId: number) {
  const [details, confirms] = await Promise.all([
    db
      .select()
      .from(roadFrontageBuildingDetail)
      .where(eq(roadFrontageBuildingDetail.parentId, parentId))
      .orderBy(asc(roadFrontageBuildingDetail.sortNo), asc(roadFrontageBuildingDetail.id)),
    db
      .select()
      .from(roadFrontageBuildingConfirm)
      .where(eq(roadFrontageBuildingConfirm.parentId, parentId))
      .orderBy(asc(roadFrontageBuildingConfirm.sortNo), asc(roadFrontageBuildingConfirm.id)),
  ]);
  return {
    details: details.map(toDetailItem),
    confirms: confirms.map(toConfirmItem),
  };
}

const LAYER_ID = 'road_frontage_building';

/**
 * 지도 레이어 목록에서 이 대장을 점으로 그리려면 GeoServer 발행이 필요.
 * 없을 때만 만든다. (레이어 생성은 완전 재발행이라 이미 있으면 건드리지 않음)
 */
export async function ensureWmsLayer(): Promise<{
  success: boolean;
  layerCreated?: boolean;
  styleCreated?: boolean;
  error?: string;
}> {
  let layerCreated = false;
  let styleCreated = false;

  try {
    const listRes = await getGeoServerLayerList();
    const layerNames = (listRes.layers ?? []).map((n) => String(n).toLowerCase());
    if (!layerNames.includes(LAYER_ID)) {
      const layerRes = await createOrUpdateGeoServerLayer({ layerName: LAYER_ID });
      if (!layerRes.success) {
        return { success: false, error: layerRes.error ?? 'GeoServer 레이어 생성 실패' };
      }
      layerCreated = true;
    }

    const styleList = await getGeoServerStyleList();
    const hasStyle = (styleList.styles ?? []).some(
      (s) => String(s?.name ?? '').toLowerCase() === LAYER_ID
    );
    if (!hasStyle) {
      const styleRes = await applyDefaultStyleToLayer({ layerName: LAYER_ID });
      if (!styleRes.success) {
        return { success: false, layerCreated, error: styleRes.error ?? 'GeoServer 스타일 생성 실패' };
      }
      styleCreated = true;
    } else if (layerCreated) {
      await setLayerDefaultStyle({ layerName: LAYER_ID, styleName: LAYER_ID });
    }

    return { success: true, layerCreated, styleCreated };
  } catch (e: unknown) {
    return {
      success: false,
      layerCreated,
      styleCreated,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 목록 조회마다 GeoServer REST를 부르지 않도록 성공하면 프로세스당 한 번만 */
let wmsEnsureOnce: Promise<void> | null = null;
function ensureWmsLayerOnce(): Promise<void> {
  if (!wmsEnsureOnce) {
    wmsEnsureOnce = ensureWmsLayer()
      .then((res) => {
        // GeoServer 미기동 등으로 실패하면 다음 목록 조회에서 다시 시도
        if (!res.success) wmsEnsureOnce = null;
      })
      .catch(() => {
        wmsEnsureOnce = null;
      });
  }
  return wmsEnsureOnce;
}

export async function list(params: { keyword?: string } = {}) {
  try {
    // 발행이 안 돼 있으면 만들어 둔다. 실패해도 목록 조회는 계속
    void ensureWmsLayerOnce();
    const keyword = emptyToNull(params?.keyword);
    const conditions = [eq(roadFrontageBuilding.isDel, false)];
    if (keyword) {
      const like = `%${keyword}%`;
      conditions.push(
        or(
          ilike(roadFrontageBuilding.locationAddress, like),
          ilike(roadFrontageBuilding.routeNo, like),
          ilike(roadFrontageBuilding.routeName, like),
          ilike(roadFrontageBuilding.roadType, like),
          ilike(roadFrontageBuilding.buildingOwnerName, like),
          ilike(roadFrontageBuilding.landOwnerName, like),
          ilike(roadFrontageBuilding.serialNo, like)
        )!
      );
    }
    const rows = await db
      .select()
      .from(roadFrontageBuilding)
      .where(and(...conditions))
      .orderBy(asc(roadFrontageBuilding.id));
    return Promise.all(
      rows.map(async (row) => {
        const ch = await loadChildren(row.id);
        return toLedger(row, ch.details, ch.confirms);
      })
    );
  } catch (e) {
    throw dbCause(e);
  }
}

export async function get(params: { id?: string | number }) {
  const id = parseId(params?.id);
  if (id == null) return null;
  const [row] = await db
    .select()
    .from(roadFrontageBuilding)
    .where(and(eq(roadFrontageBuilding.id, id), eq(roadFrontageBuilding.isDel, false)))
    .limit(1);
  if (!row) return null;
  const ch = await loadChildren(row.id);
  return toLedger(row, ch.details, ch.confirms);
}

type SaveBody = Partial<RoadFrontageBuildingLedger> & { id?: string };

async function replaceChildren(parentId: number, body: SaveBody) {
  await db.delete(roadFrontageBuildingDetail).where(eq(roadFrontageBuildingDetail.parentId, parentId));
  await db.delete(roadFrontageBuildingConfirm).where(eq(roadFrontageBuildingConfirm.parentId, parentId));

  const details = (Array.isArray(body.details) ? body.details : []).filter((d) => !isBlankDetail(d));
  if (details.length) {
    await db.insert(roadFrontageBuildingDetail).values(
      details.map((d, i) => ({
        parentId,
        dongNo: toNum(d.dongNo),
        installedDate: emptyToNull(d.installedDate),
        structure: emptyToNull(d.structure),
        usageType: emptyToNull(d.usageType),
        areaSqm: toNum(d.areaSqm),
        locationKind: emptyToNull(d.locationKind),
        badMarks: marksToText(d.badMarks),
        sortNo: i,
      }))
    );
  }

  const confirms = (Array.isArray(body.confirmHistory) ? body.confirmHistory : []).filter(
    (c) => !isBlankConfirm(c)
  );
  if (confirms.length) {
    await db.insert(roadFrontageBuildingConfirm).values(
      confirms.map((c, i) => ({
        parentId,
        confirmDate: emptyToNull(c.confirmDate),
        confirmerName: emptyToNull(c.confirmerName),
        approverName: emptyToNull(c.approverName),
        sortNo: i,
      }))
    );
  }
}

export async function save(body: SaveBody = {}) {
  const usrId = (await getSessionUsrId()) ?? '';
  const stamp = nowStamp();
  const lon = Number(body.mockLonLat?.lon);
  const lat = Number(body.mockLonLat?.lat);
  const lonVal = Number.isFinite(lon) ? lon : null;
  const latVal = Number.isFinite(lat) ? lat : null;
  const shot = body.formAttachShotDates ?? { before: '', after: '' };
  const fields = {
    lon: lonVal,
    lat: latVal,
    roadType: emptyToNull(body.roadType),
    routeNo: emptyToNull(body.routeNo),
    routeName: emptyToNull(body.routeName),
    serialNo: emptyToNull(body.serialNo),
    preparedDate: emptyToNull(body.preparedDate),
    locationAddress: emptyToNull(body.locationAddress),
    residentName: emptyToNull(body.residentName),
    residentPhone: emptyToNull(body.residentPhone),
    buildingOwnerName: emptyToNull(body.buildingOwnerName),
    buildingOwnerPhone: emptyToNull(body.buildingOwnerPhone),
    buildingOwnerAddress: emptyToNull(body.buildingOwnerAddress),
    landOwnerName: emptyToNull(body.landOwnerName),
    landOwnerPhone: emptyToNull(body.landOwnerPhone),
    landOwnerAddress: emptyToNull(body.landOwnerAddress),
    writerDept: emptyToNull(body.writerDept) ?? ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
    writerName: emptyToNull(body.writerName) ?? usrId,
    writtenAt: emptyToNull(body.writtenAt) ?? stamp,
    attachShotBefore: emptyToNull(shot.before),
    attachShotAfter: emptyToNull(shot.after),
    updateDate: stamp,
    updateUser: usrId,
  };

  const existingId = parseId(body.id);
  let id = existingId;
  if (id != null) {
    const [found] = await db
      .select({ id: roadFrontageBuilding.id })
      .from(roadFrontageBuilding)
      .where(and(eq(roadFrontageBuilding.id, id), eq(roadFrontageBuilding.isDel, false)))
      .limit(1);
    if (!found) id = null;
  }

  if (id == null) {
    const [inserted] = await db
      .insert(roadFrontageBuilding)
      .values({
        ...fields,
        isDel: false,
        createDate: stamp,
        createUser: usrId,
      })
      .returning({ id: roadFrontageBuilding.id });
    id = inserted.id;
  } else {
    await db.update(roadFrontageBuilding).set(fields).where(eq(roadFrontageBuilding.id, id));
  }

  await updateGeom(id, lonVal, latVal);
  await replaceChildren(id, body);
  return get({ id });
}

export async function remove(params: { id?: string | number }) {
  const id = parseId(params?.id);
  if (id == null) return { ok: false };
  const usrId = (await getSessionUsrId()) ?? '';
  await db
    .update(roadFrontageBuilding)
    .set({ isDel: true, updateDate: nowStamp(), updateUser: usrId })
    .where(eq(roadFrontageBuilding.id, id));
  // 지도(WMS)는 테이블을 그대로 그리므로, 위치를 비워 삭제한 대장이 점으로 남지 않게 한다
  await updateGeom(id, null, null);
  return { ok: true };
}
