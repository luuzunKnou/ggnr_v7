/**
 * 접도구역 기존 건축물(공작물) 관리대장
 * 업무 키는 ftr_idn. detail/confirm·첨부도 ftr_idn으로 연결.
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

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function isBlankDetail(d: RoadFrontageBuildingDetailItem): boolean {
  return (
    !tx(d.dongNo) &&
    !tx(d.instYmd) &&
    !tx(d.structure) &&
    !tx(d.usageType) &&
    !tx(d.areaSqm) &&
    !tx(d.locAdrR) &&
    !tx(d.locAdrC) &&
    !(d.badMarks ?? []).length
  );
}

function isBlankConfirm(c: RoadFrontageBuildingConfirmItem): boolean {
  return !tx(c.checkYmd) && !tx(c.checkNam) && !tx(c.appNam);
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

/** geom 갱신용 — DB 내부 serial만 사용. 외부 API 키는 ftr_idn */
async function updateGeomByPk(pk: number, lon: number | null, lat: number | null) {
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    await db
      .update(roadFrontageBuilding)
      .set({ geom: null })
      .where(eq(roadFrontageBuilding.id, pk));
    return;
  }
  await db.execute(
    sql.raw(
      `UPDATE layer.road_frontage_building
       SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)
       WHERE id = ${pk}`
    )
  );
}

function toDetailItem(
  row: typeof roadFrontageBuildingDetail.$inferSelect
): RoadFrontageBuildingDetailItem {
  return {
    id: String(row.id),
    dongNo: tx(row.dongNo),
    instYmd: tx(row.instYmd),
    structure: tx(row.structure),
    usageType: tx(row.usageType),
    areaSqm: tx(row.areaSqm),
    locAdrR: tx(row.locAdrR),
    locAdrC: tx(row.locAdrC),
    badMarks: textToMarks(row.badMarks),
  };
}

function toConfirmItem(
  row: typeof roadFrontageBuildingConfirm.$inferSelect
): RoadFrontageBuildingConfirmItem {
  return {
    id: String(row.id),
    checkYmd: tx(row.checkYmd),
    checkNam: tx(row.checkNam),
    appNam: tx(row.appNam),
  };
}

function toLedger(
  row: typeof roadFrontageBuilding.$inferSelect,
  details: RoadFrontageBuildingDetailItem[],
  confirms: RoadFrontageBuildingConfirmItem[]
): RoadFrontageBuildingLedger {
  const ftrIdn = tx(row.ftrIdn);
  return {
    /** UI·선택·첨부 키 = ftr_idn (숫자 serial 아님) */
    id: ftrIdn,
    ftrIdn,
    roadType: tx(row.roadType),
    routeNo: tx(row.routeNo),
    routeNam: tx(row.routeNam),
    serialNo: tx(row.serialNo),
    preYmd: tx(row.preYmd),
    locAdr: tx(row.locAdr),
    resiNam: tx(row.resiNam),
    resiNum: tx(row.resiNum),
    buildOnam: tx(row.buildOnam),
    buildOnum: tx(row.buildOnum),
    buildOadr: tx(row.buildOadr),
    landOnam: tx(row.landOnam),
    landOnum: tx(row.landOnum),
    landOadr: tx(row.landOadr),
    writeDept: tx(row.writeDept) || ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
    writeNam: tx(row.writeNam),
    writeYmd: tx(row.writeYmd),
    mockLonLat: {
      lon: row.lon ?? 0,
      lat: row.lat ?? 0,
    },
    details,
    confirmHistory: confirms,
    photos: [],
    formAttaches: emptyRoadFrontageBuildingFormAttaches(),
    formAttachShotDates: {
      before: tx(row.beforeYmd),
      after: tx(row.afterYmd),
    },
  };
}

async function loadChildren(ftrIdn: string) {
  const key = ftrIdn.trim();
  if (!key) {
    return {
      details: [] as RoadFrontageBuildingDetailItem[],
      confirms: [] as RoadFrontageBuildingConfirmItem[],
    };
  }
  const [details, confirms] = await Promise.all([
    db
      .select()
      .from(roadFrontageBuildingDetail)
      .where(eq(roadFrontageBuildingDetail.ftrIdn, key))
      .orderBy(asc(roadFrontageBuildingDetail.sortNo), asc(roadFrontageBuildingDetail.id)),
    db
      .select()
      .from(roadFrontageBuildingConfirm)
      .where(eq(roadFrontageBuildingConfirm.ftrIdn, key))
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
        if (!res.success) wmsEnsureOnce = null;
      })
      .catch(() => {
        wmsEnsureOnce = null;
      });
  }
  return wmsEnsureOnce;
}

export async function list(params: { keyword?: string; roadType?: string } = {}) {
  try {
    void ensureWmsLayerOnce();
    const keyword = emptyToNull(params?.keyword);
    const roadType = emptyToNull(params?.roadType);
    const conditions = [eq(roadFrontageBuilding.isDel, false)];
    if (roadType) {
      conditions.push(eq(roadFrontageBuilding.roadType, roadType));
    }
    if (keyword) {
      const like = `%${keyword}%`;
      conditions.push(
        or(
          ilike(roadFrontageBuilding.locAdr, like),
          ilike(roadFrontageBuilding.routeNo, like),
          ilike(roadFrontageBuilding.routeNam, like),
          ilike(roadFrontageBuilding.roadType, like),
          ilike(roadFrontageBuilding.buildOnam, like),
          ilike(roadFrontageBuilding.landOnam, like),
          ilike(roadFrontageBuilding.serialNo, like),
          ilike(roadFrontageBuilding.ftrIdn, like)
        )!
      );
    }
    const rows = await db
      .select()
      .from(roadFrontageBuilding)
      .where(and(...conditions))
      .orderBy(asc(roadFrontageBuilding.ftrIdn), asc(roadFrontageBuilding.id));
    return Promise.all(
      rows.map(async (row) => {
        const ch = await loadChildren(tx(row.ftrIdn));
        return toLedger(row, ch.details, ch.confirms);
      })
    );
  } catch (e) {
    throw dbCause(e);
  }
}

export async function get(params: { ftrIdn?: string; id?: string | number } = {}) {
  const key = tx(params.ftrIdn) || tx(params.id as string | undefined);
  if (!key) return null;
  const [row] = await db
    .select()
    .from(roadFrontageBuilding)
    .where(and(eq(roadFrontageBuilding.ftrIdn, key), eq(roadFrontageBuilding.isDel, false)))
    .limit(1);
  if (!row) return null;
  const ch = await loadChildren(tx(row.ftrIdn));
  return toLedger(row, ch.details, ch.confirms);
}

type SaveBody = Partial<RoadFrontageBuildingLedger> & { id?: string; ftrIdn?: string };

async function replaceChildren(ftrIdn: string, body: SaveBody) {
  const key = ftrIdn.trim();
  if (!key) return;

  await db.delete(roadFrontageBuildingDetail).where(eq(roadFrontageBuildingDetail.ftrIdn, key));
  await db.delete(roadFrontageBuildingConfirm).where(eq(roadFrontageBuildingConfirm.ftrIdn, key));

  const details = (Array.isArray(body.details) ? body.details : []).filter((d) => !isBlankDetail(d));
  if (details.length) {
    await db.insert(roadFrontageBuildingDetail).values(
      details.map((d, i) => ({
        ftrIdn: key,
        dongNo: emptyToNull(d.dongNo),
        instYmd: emptyToNull(d.instYmd),
        structure: emptyToNull(d.structure),
        usageType: emptyToNull(d.usageType),
        areaSqm: emptyToNull(d.areaSqm),
        locAdrR: emptyToNull(d.locAdrR),
        locAdrC: emptyToNull(d.locAdrC),
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
        ftrIdn: key,
        checkYmd: emptyToNull(c.checkYmd),
        checkNam: emptyToNull(c.checkNam),
        appNam: emptyToNull(c.appNam),
        sortNo: i,
      }))
    );
  }
}

async function nextAutoFtrIdn(): Promise<string> {
  const [row] = await db
    .select({ id: roadFrontageBuilding.id })
    .from(roadFrontageBuilding)
    .orderBy(sql`${roadFrontageBuilding.id} desc`)
    .limit(1);
  const n = (row?.id ?? 0) + 1;
  return `JD${String(n).padStart(4, '0')}`;
}

export async function save(body: SaveBody = {}) {
  const usrId = (await getSessionUsrId()) ?? '';
  const stamp = nowStamp();
  const lon = Number(body.mockLonLat?.lon);
  const lat = Number(body.mockLonLat?.lat);
  const lonVal = Number.isFinite(lon) ? lon : null;
  const latVal = Number.isFinite(lat) ? lat : null;
  const shot = body.formAttachShotDates ?? { before: '', after: '' };
  /** 업무 키 — body.ftrIdn 우선, 없으면 body.id(이미 ftr_idn으로 쓰는 UI) */
  let ftrKey = emptyToNull(body.ftrIdn) ?? emptyToNull(body.id);

  const fields = {
    lon: lonVal,
    lat: latVal,
    roadType: emptyToNull(body.roadType),
    routeNo: emptyToNull(body.routeNo),
    routeNam: emptyToNull(body.routeNam),
    serialNo: emptyToNull(body.serialNo),
    preYmd: emptyToNull(body.preYmd),
    locAdr: emptyToNull(body.locAdr),
    resiNam: emptyToNull(body.resiNam),
    resiNum: emptyToNull(body.resiNum),
    buildOnam: emptyToNull(body.buildOnam),
    buildOnum: emptyToNull(body.buildOnum),
    buildOadr: emptyToNull(body.buildOadr),
    landOnam: emptyToNull(body.landOnam),
    landOnum: emptyToNull(body.landOnum),
    landOadr: emptyToNull(body.landOadr),
    writeDept: emptyToNull(body.writeDept) ?? ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
    writeNam: emptyToNull(body.writeNam) ?? usrId,
    writeYmd: emptyToNull(body.writeYmd) ?? stamp,
    beforeYmd: emptyToNull(shot.before),
    afterYmd: emptyToNull(shot.after),
    updYmd: stamp,
    updNam: usrId,
  };

  let pk: number | null = null;
  if (ftrKey) {
    const [found] = await db
      .select({ id: roadFrontageBuilding.id, ftrIdn: roadFrontageBuilding.ftrIdn })
      .from(roadFrontageBuilding)
      .where(and(eq(roadFrontageBuilding.ftrIdn, ftrKey), eq(roadFrontageBuilding.isDel, false)))
      .limit(1);
    if (found) pk = found.id;
  }

  if (pk == null) {
    if (!ftrKey) ftrKey = await nextAutoFtrIdn();
    const [inserted] = await db
      .insert(roadFrontageBuilding)
      .values({
        ...fields,
        ftrIdn: ftrKey,
        isDel: false,
        creaYmd: stamp,
        creaNam: usrId,
      })
      .returning({ id: roadFrontageBuilding.id, ftrIdn: roadFrontageBuilding.ftrIdn });
    pk = inserted.id;
    ftrKey = tx(inserted.ftrIdn) || ftrKey;
  } else {
    await db
      .update(roadFrontageBuilding)
      .set({
        ...fields,
        ftrIdn: ftrKey,
      })
      .where(eq(roadFrontageBuilding.id, pk));
  }

  await updateGeomByPk(pk, lonVal, latVal);
  if (ftrKey) await replaceChildren(ftrKey, body);
  return get({ ftrIdn: ftrKey! });
}

export async function remove(params: { ftrIdn?: string; id?: string | number } = {}) {
  const key = tx(params.ftrIdn) || tx(params.id as string | undefined);
  if (!key) return { ok: false };
  const [row] = await db
    .select({ id: roadFrontageBuilding.id })
    .from(roadFrontageBuilding)
    .where(and(eq(roadFrontageBuilding.ftrIdn, key), eq(roadFrontageBuilding.isDel, false)))
    .limit(1);
  if (!row) return { ok: false };
  const usrId = (await getSessionUsrId()) ?? '';
  await db
    .update(roadFrontageBuilding)
    .set({ isDel: true, updYmd: nowStamp(), updNam: usrId })
    .where(eq(roadFrontageBuilding.id, row.id));
  await updateGeomByPk(row.id, null, null);
  return { ok: true };
}
