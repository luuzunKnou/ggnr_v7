/**
 * 안동 도로점용 전산화 전용 서비스.
 *
 * 목표 구조:
 * 1) 점용대장정보(1)
 * 2) 부과정보(N) - 점용대장정보 FK
 * 3) 점용지(N)   - 부과정보 FK
 * 4) 물건지(N)   - 부과정보 FK
 *
 * 한 파일에서 테이블 생성/적재/주소분해/GPT 정규화/VWorld 좌표화/지적 폴리곤 조회까지 처리한다.
 */
import { pool } from '@/database/db';
import { broadcastExcelWizardLog } from '@/lib/excelWizardEvents';

type GeometryMode = 'Point' | 'Polygon';

export type RoadUseAndongFieldMap = {
  // charge table columns
  permitNo: string;
  permitDate: string;
  completionConfirmDate: string;
  feeTotal: string;
  temporaryTotal: string;
  usageFeeTotal: string;
  vatTotal: string;
  licenseTaxYn: string;
  reductionReason: string;
  changeDetail: string;
  changePermitDate: string;
  completionCheckDate: string;
  convertedDiameter: string;
  excavationDetail: string;
  // info table columns
  roadNameType: string;
  roadRouteNo: string;
  occupancyEmd: string;
  occupancyRi: string;
  occupancyJibun: string;
  objectNearbyJibun: string;
  occupantAddress: string;
  occupantName: string;
  manager: string;
  occupantRegNo: string;
  occupantContact: string;
  occupancyPurpose: string;
  workName: string;
  permanentArea: string;
  permanentAreaDetail: string;
  quantityTemporary: string;
  permanentPeriod: string;
  temporaryPeriod: string;
  restoration: string;
  roadMgmtReviewYn: string;
  excavationYn: string;
  pavingLedger: string;
  poleNo: string;
  note: string;
  cuttingPavingDoneDate: string;
  consultationResult: string;
  // derived full-address fields for parcel split
  occupancyParcelText: string;
  objectParcelText: string;
};

export type RoadUseAndongBuildParams = {
  rows: Record<string, unknown>[];
  fieldMap: RoadUseAndongFieldMap;
  openaiApiKey?: string;
  vworldApiKey?: string;
  appendOnly?: boolean;
  geometryMode?: GeometryMode;
  tablePrefix?: string;
  jobId?: string;
  onProgress?: (message: string) => void;
};

export type RoadUseAndongBuildResult = {
  success: boolean;
  error?: string;
  tableNames?: {
    ledgerInfo: string;
    charge: string;
    occupancyParcel: string;
    objectParcel: string;
  };
  inserted?: {
    ledgerInfo: number;
    charge: number;
    occupancyParcel: number;
    objectParcel: number;
  };
  geometryStats?: {
    resolved: number;
    nullGeom: number;
  };
};

type InfoShape = {
  roadNameType: string;
  roadRouteNo: string;
  occupancyEmd: string;
  occupancyRi: string;
  occupancyJibun: string;
  objectNearbyJibun: string;
  occupantAddress: string;
  occupantName: string;
  manager: string;
  occupantRegNo: string;
  occupantContact: string;
  occupancyPurpose: string;
  workName: string;
  permanentArea: string;
  permanentAreaDetail: string;
  quantityTemporary: string;
  permanentPeriod: string;
  temporaryPeriod: string;
  restoration: string;
  roadMgmtReviewYn: string;
  excavationYn: string;
  pavingLedger: string;
  poleNo: string;
  note: string;
  cuttingPavingDoneDate: string;
  consultationResult: string;
};

type ChargeShape = {
  permitNo: string;
  permitDate: string;
  completionConfirmDate: string;
  feeTotal: string;
  temporaryTotal: string;
  usageFeeTotal: string;
  vatTotal: string;
  licenseTaxYn: string;
  reductionReason: string;
  changeDetail: string;
  changePermitDate: string;
  completionCheckDate: string;
  convertedDiameter: string;
  excavationDetail: string;
};

const DEFAULT_PREFIX = 'road_use_andong';
const SCHEMA = 'layer';
const EMD_RI_SCHEMA = 'public_layer';
const EMD_RI_NAME_COLUMNS = ['adm_nm', 'name', 'emd_nm', 'ri_nm'];

function s(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeParcelText(raw: string): string {
  let t = s(raw);
  if (!t) return t;
  t = t.replace(/번지선/gi, '번지');
  t = t.replace(/\s*하천부지\s*/gi, ' ');
  t = t.replace(/\s*하천\s*/gi, ' ');
  // 5자리 이상 숫자는 본번·부번이 아니므로 제거 (주민번호·관리번호 등 오염 방지)
  t = t.replace(/\b\d{5,}\b/g, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

function isLikelyComplexParcelText(raw: string): boolean {
  const t = normalizeParcelText(raw);
  if (!t) return false;
  if (/[\r\n,;]|외\s*\d+|및|\/|·/.test(t)) return true;
  // '번지'가 두 번 이상 → 한 칸에 지번이 여러 개
  if ((t.match(/번지/g) ?? []).length >= 2) return true;
  // 숫자-(한글/영문 단어 1개 이상)-숫자 → 지번이 여러 개로 추정 (공백 포함 멀티워드도 감지)
  if (/\d+(?:\s+[가-힣A-Za-z]+)+\s+\d+/.test(t)) return true;
  // "번지" 뒤에 읍/면/동/리가 또 나오면 새 필지 주소가 시작됨 (예: "236번지 입암면 금학리 1203")
  if (/번지\s+[가-힣]+(?:읍|면|동|리)/.test(t)) return true;
  // 시·도 행정구역 단위(도/광역시/특별시 등)가 2번 이상 → 전체 주소가 반복됨 (예: "...도곡리 630 경상북도 영양군...")
  if ((t.match(/[가-힣]+(?:도|광역시|특별시|특별자치시|특별자치도)/g) ?? []).length >= 2) return true;
  return false;
}

function enrichParcelPrefixContext(parcels: string[], rawText: string): string[] {
  if (!Array.isArray(parcels) || parcels.length === 0) return [];
  const text = s(rawText).replace(/\s+/g, ' ');
  const cityMatch = text.match(
    /((?:[가-힣]+(?:도|특별시|광역시|특별자치시|특별자치도)\s+)?[가-힣]+시)/
  );
  const cityPrefix = s(cityMatch?.[1]);
  const baseMatch = text.match(
    /((?:[가-힣]+(?:도|특별시|광역시|특별자치시|특별자치도)\s+)?[가-힣]+시\s+[가-힣0-9]+(?:읍|면|동)(?:\s+[가-힣0-9]+리)?)\s*(?=산?\d)/
  );
  const basePrefix = s(baseMatch?.[1]);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parcels) {
    let p = s(raw).replace(/\s+/g, ' ');
    if (!p) continue;
    const hasAdmin = /(도|특별시|광역시|특별자치).*[가-힣]+시|[가-힣]+시/.test(p) && /(읍|면|동|리)/.test(p);
    const hasEmdOrRi = /(읍|면|동|리)/.test(p);
    const onlyJibun = /^산?\d+(?:-\d+)?(?:번지)?$/.test(p);

    if (!hasAdmin && hasEmdOrRi && cityPrefix) {
      p = `${cityPrefix} ${p}`.replace(/\s+/g, ' ').trim();
    } else if (!hasAdmin && onlyJibun) {
      if (basePrefix) p = `${basePrefix} ${p}`.replace(/\s+/g, ' ').trim();
      else if (cityPrefix) p = `${cityPrefix} ${p}`.replace(/\s+/g, ' ').trim();
    }
    if (/\d/.test(p) && !/번지\s*$/.test(p)) p = `${p}번지`;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function splitParcelsByRule(raw: string): string[] {
  const t = s(raw);
  if (!t) return [];
  const parts = t
    .split(/[\r\n,;]+/g)
    .map((x) => s(x))
    .filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0] ?? '';
  const firstMatch = first.match(/^(.*?\s)?(\d+(?:-\d+)?(?:번지)?)$/);
  const prefix = firstMatch?.[1] ? s(firstMatch[1]) : '';
  const withPrefix = parts.map((p, i) => {
    if (i === 0 || !prefix) return p;
    // 뒤 파트가 순수 지번(숫자/하이픈/번지) 형태면 앞 읍면동·리 접두를 복제
    if (/^\d+(?:-\d+)?(?:번지)?$/.test(p)) return `${prefix} ${p}`.replace(/\s+/g, ' ').trim();
    return p;
  });
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const p of withPrefix) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }
  return enrichParcelPrefixContext(uniq, t);
}

async function gptNormalizeParcels(openaiApiKey: string, rawText: string): Promise<string[]> {
  const normalizedInput = normalizeParcelText(rawText);
  const prompt = `다음 문자열은 도로점용 필지목록입니다.
- 콤마/줄바꿈/세미콜론/외 N필지 등 혼합 표기를 "개별 지번 문자열 배열"로 정규화하세요.
- "652번지 5호"처럼 "번지" 뒤에 오는 "N호"는 호수/건물번호이므로 부번(-N)으로 보지 말고 제외하고 "652번지"로만 반환하세요. ("652-5"로 만들지 마세요)
- "번지" 뒤에 읍/면/동/리가 다시 나오면 새 필지의 시작으로 보고 분리하세요. (예: "236번지 입암면 금학리 1203" → ["...입암면 금학리 236번지", "...입암면 금학리 1203번지"])
- "하천", "하천부지", "번지선" 등 지번이 아닌 설명어는 제거하세요.
- 모르는 정보는 추정하지 마세요.
- 빈값은 제외하세요.
- 응답은 JSON 한 개만:
{ "parcels": ["...", "..."] }

입력:
${normalizedInput}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `OpenAI API 오류 (${res.status})`);
  }
  const content = s(json?.choices?.[0]?.message?.content);
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? s(fence[1]) : content;
  const objMatch = body.match(/\{[\s\S]*\}/);
  if (!objMatch) return splitParcelsByRule(rawText);
  try {
    const parsed = JSON.parse(objMatch[0]) as { parcels?: unknown[] };
    const arr = Array.isArray(parsed?.parcels) ? parsed.parcels : [];
    const out = arr.map((x) => s(x)).filter(Boolean);
    return out.length > 0 ? enrichParcelPrefixContext(out, rawText) : splitParcelsByRule(rawText);
  } catch {
    return splitParcelsByRule(rawText);
  }
}

async function normalizeParcels(rawText: string, openaiApiKey?: string): Promise<string[]> {
  const normalized = normalizeParcelText(rawText);
  const rule = splitParcelsByRule(normalized);
  if (!openaiApiKey || !isLikelyComplexParcelText(normalized)) return rule;
  try {
    return await gptNormalizeParcels(openaiApiKey, normalized);
  } catch {
    return rule;
  }
}

async function geocodeAddressVworld(
  address: string,
  vworldApiKey?: string
): Promise<{ ok: boolean; lon?: number; lat?: number; message?: string }> {
  if (!vworldApiKey) return { ok: false, message: 'VWORLD_API_KEY 미설정' };
  const run = async (type: 'ROAD' | 'PARCEL') => {
    const params = new URLSearchParams({
      service: 'address',
      request: 'getCoord',
      version: '2.0',
      crs: 'epsg:4326',
      address,
      type,
      format: 'json',
      key: vworldApiKey,
    });
    const res = await fetch(`https://api.vworld.kr/req/address?${params.toString()}`);
    const data = (await res.json()) as {
      response?: {
        status?: string;
        result?: { point?: { x?: string; y?: string } };
      };
    };
    const status = s(data?.response?.status).toUpperCase();
    const x = Number(data?.response?.result?.point?.x);
    const y = Number(data?.response?.result?.point?.y);
    if (status === 'OK' && Number.isFinite(x) && Number.isFinite(y)) {
      return { ok: true as const, lon: x, lat: y };
    }
    return { ok: false as const, message: `VWorld ${type} 실패` };
  };
  const road = await run('ROAD');
  if (road.ok) return road;
  return run('PARCEL');
}

type ParsedPnuParts = {
  emdName: string;
  riName: string;
  bonbun: string;
  bubun: string;
};

function parseAddressForPnu(address: string): ParsedPnuParts | null {
  let text = s(address).replace(/번지/g, '');
  if (!text) return null;
  text = text.replace(/\s*산\s*/g, ' ').trim();
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 5) return null;
  const emdName = parts[2]!;
  const riName = parts[3]!;
  const rest = parts.slice(4).join(' ');
  const nums = rest.split('-').map((p) => p.replace(/\D/g, ''));
  const bonbun = (nums[0] || '0').padStart(4, '0').slice(-4);
  const bubun = (nums[1] || '0').padStart(4, '0').slice(-4);
  return { emdName, riName, bonbun, bubun };
}

async function getPnuFromAddress(address: string): Promise<string | null> {
  const parsed = parseAddressForPnu(address);
  if (!parsed) return null;
  const esc = (x: string) => x.replace(/'/g, "''");
  let emdCd: string | null = null;
  for (const nameCol of EMD_RI_NAME_COLUMNS) {
    const r = await pool.query(
      `SELECT "emd_cd" AS code FROM "${EMD_RI_SCHEMA}"."emd" WHERE "${nameCol}" = $1 LIMIT 1`,
      [parsed.emdName]
    ).catch(() => null);
    const v = s(r?.rows?.[0]?.code);
    if (v) {
      emdCd = v;
      break;
    }
  }
  if (!emdCd) return null;
  // 행정리(서부3리) → 법정리(서부리) 폴백 — 지적 PNU는 법정리 기준
  const toBeopjeongRi = (n: string) => {
    const t = n.trim();
    const m = t.match(/^(.+?)\d+리$/u);
    return m ? `${m[1]}리` : t;
  };
  const riCandidates = [parsed.riName, toBeopjeongRi(parsed.riName)].filter(
    (n, i, arr) => n && arr.indexOf(n) === i
  );
  let riCd: string | null = null;
  for (const candidate of riCandidates) {
    for (const nameCol of EMD_RI_NAME_COLUMNS) {
      const r = await pool.query(
        `SELECT "ri_cd" AS code FROM "${EMD_RI_SCHEMA}"."ri" WHERE "ri_cd" LIKE $1 AND "${nameCol}" = $2 LIMIT 1`,
        [`${emdCd}%`, candidate]
      ).catch(() => null);
      const v = s(r?.rows?.[0]?.code);
      if (v) {
        riCd = v;
        break;
      }
    }
    if (riCd) break;
  }
  if (!riCd) return null;
  return `${riCd}${parsed.bonbun}${parsed.bubun}`;
}

async function getJijukGeomByPnu(pnu: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT ST_AsText(ST_SetSRID(geom, 5181)) AS wkt FROM ${EMD_RI_SCHEMA}.jijuk WHERE pnu = $1 LIMIT 1`,
    [pnu]
  ).catch(() => null);
  const wkt = s(r?.rows?.[0]?.wkt);
  return wkt || null;
}

async function getJijukGeomByLonLat(lon: number, lat: number): Promise<string | null> {
  const r = await pool.query(
    `SELECT ST_AsText(geom) AS wkt
     FROM ${EMD_RI_SCHEMA}.jijuk
     WHERE ST_Intersects(ST_SetSRID(geom, 5181), ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 5181))
     LIMIT 1`,
    [lon, lat]
  ).catch(() => null);
  const wkt = s(r?.rows?.[0]?.wkt);
  return wkt || null;
}

async function resolveParcelGeometry(
  address: string,
  mode: GeometryMode,
  vworldApiKey?: string
): Promise<{ wkt: string | null; srid: 4326 | 5181 }> {
  const coord = await geocodeAddressVworld(address, vworldApiKey);
  if (!coord.ok || coord.lon == null || coord.lat == null) {
    if (mode === 'Point') return { wkt: null, srid: 4326 };
    const pnu = await getPnuFromAddress(address);
    if (!pnu) return { wkt: null, srid: 5181 };
    const poly = await getJijukGeomByPnu(pnu);
    return { wkt: poly, srid: 5181 };
  }
  if (mode === 'Point') {
    return { wkt: `POINT(${coord.lon} ${coord.lat})`, srid: 4326 };
  }
  const poly = await getJijukGeomByLonLat(coord.lon, coord.lat);
  if (poly) return { wkt: poly, srid: 5181 };
  const pnu = await getPnuFromAddress(address);
  if (!pnu) return { wkt: null, srid: 5181 };
  return { wkt: await getJijukGeomByPnu(pnu), srid: 5181 };
}

function pickInfo(row: Record<string, unknown>, map: RoadUseAndongFieldMap): InfoShape {
  return {
    roadNameType: s(row[map.roadNameType]),
    roadRouteNo: s(row[map.roadRouteNo]),
    occupancyEmd: s(row[map.occupancyEmd]),
    occupancyRi: s(row[map.occupancyRi]),
    occupancyJibun: s(row[map.occupancyJibun]),
    objectNearbyJibun: s(row[map.objectNearbyJibun]),
    occupantAddress: s(row[map.occupantAddress]),
    occupantName: s(row[map.occupantName]),
    manager: s(row[map.manager]),
    occupantRegNo: s(row[map.occupantRegNo]),
    occupantContact: s(row[map.occupantContact]),
    occupancyPurpose: s(row[map.occupancyPurpose]),
    workName: s(row[map.workName]),
    permanentArea: s(row[map.permanentArea]),
    permanentAreaDetail: s(row[map.permanentAreaDetail]),
    quantityTemporary: s(row[map.quantityTemporary]),
    permanentPeriod: s(row[map.permanentPeriod]),
    temporaryPeriod: s(row[map.temporaryPeriod]),
    restoration: s(row[map.restoration]),
    roadMgmtReviewYn: s(row[map.roadMgmtReviewYn]),
    excavationYn: s(row[map.excavationYn]),
    pavingLedger: s(row[map.pavingLedger]),
    poleNo: s(row[map.poleNo]),
    note: s(row[map.note]),
    cuttingPavingDoneDate: s(row[map.cuttingPavingDoneDate]),
    consultationResult: s(row[map.consultationResult]),
  };
}

function pickCharge(row: Record<string, unknown>, map: RoadUseAndongFieldMap): ChargeShape {
  return {
    permitNo: s(row[map.permitNo]),
    permitDate: s(row[map.permitDate]),
    completionConfirmDate: s(row[map.completionConfirmDate]),
    feeTotal: s(row[map.feeTotal]),
    temporaryTotal: s(row[map.temporaryTotal]),
    usageFeeTotal: s(row[map.usageFeeTotal]),
    vatTotal: s(row[map.vatTotal]),
    licenseTaxYn: s(row[map.licenseTaxYn]),
    reductionReason: s(row[map.reductionReason]),
    changeDetail: s(row[map.changeDetail]),
    changePermitDate: s(row[map.changePermitDate]),
    completionCheckDate: s(row[map.completionCheckDate]),
    convertedDiameter: s(row[map.convertedDiameter]),
    excavationDetail: s(row[map.excavationDetail]),
  };
}

async function ensureTables(prefix: string): Promise<{
  ledgerInfo: string;
  charge: string;
  occupancyParcel: string;
  objectParcel: string;
}> {
  const tableNames = {
    ledgerInfo: `${prefix}_info`,
    charge: `${prefix}_charge`,
    occupancyParcel: `${prefix}_jijuk`,
    objectParcel: `${prefix}_jyj`,
  };
  const li = `"${tableNames.ledgerInfo}"`;
  const ch = `"${tableNames.charge}"`;
  const oc = `"${tableNames.occupancyParcel}"`;
  const ob = `"${tableNames.objectParcel}"`;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.${li} (
      id SERIAL PRIMARY KEY
    )`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.${ch} (
      id SERIAL PRIMARY KEY,
      ledger_info_id integer NOT NULL REFERENCES ${SCHEMA}.${li}(id) ON DELETE CASCADE
    )`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.${oc} (
      id SERIAL PRIMARY KEY,
      ledger_info_id integer NOT NULL REFERENCES ${SCHEMA}.${li}(id) ON DELETE CASCADE,
      charge_id integer NOT NULL REFERENCES ${SCHEMA}.${ch}(id) ON DELETE CASCADE,
      jibun text NOT NULL,
      geom geometry(Geometry, 5181)
    )`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA}.${ob} (
      id SERIAL PRIMARY KEY,
      ledger_info_id integer NOT NULL REFERENCES ${SCHEMA}.${li}(id) ON DELETE CASCADE,
      charge_id integer NOT NULL REFERENCES ${SCHEMA}.${ch}(id) ON DELETE CASCADE,
      jibun text NOT NULL,
      geom geometry(Geometry, 5181)
    )`
  );
  const infoCols = [
    'road_name_type',
    'road_route_no',
    'occupancy_emd',
    'occupancy_ri',
    'occupancy_jibun',
    'object_nearby_jibun',
    'occupant_address',
    'occupant_name',
    'manager_name',
    'occupant_reg_no',
    'occupant_contact',
    'occupancy_purpose',
    'work_name',
    'permanent_area',
    'permanent_area_detail',
    'quantity_temporary',
    'permanent_period',
    'temporary_period',
    'restoration',
    'road_mgmt_review_yn',
    'excavation_yn',
    'paving_ledger',
    'pole_no',
    'note',
    'cutting_paving_done_date',
    'consultation_result',
  ];
  for (const col of infoCols) {
    await pool.query(`ALTER TABLE ${SCHEMA}.${li} ADD COLUMN IF NOT EXISTS "${col}" text`);
  }
  const chargeCols = [
    'permit_no',
    'permit_date',
    'completion_confirm_date',
    'fee_total',
    'temporary_total',
    'usage_fee_total',
    'vat_total',
    'license_tax_yn',
    'reduction_reason',
    'change_detail',
    'change_permit_date',
    'completion_check_date',
    'converted_diameter',
    'excavation_detail',
    'occupancy_parcel_text',
    'object_parcel_text',
  ];
  for (const col of chargeCols) {
    await pool.query(`ALTER TABLE ${SCHEMA}.${ch} ADD COLUMN IF NOT EXISTS "${col}" text`);
  }
  return tableNames;
}

export async function buildRoadUseAndongHierarchy(
  params: RoadUseAndongBuildParams
): Promise<RoadUseAndongBuildResult> {
  const rows = Array.isArray(params.rows) ? params.rows : [];
  if (rows.length === 0) return { success: false, error: 'rows가 비어 있습니다.' };
  const fieldMap = params.fieldMap;
  const geometryMode: GeometryMode = params.geometryMode ?? 'Polygon';
  const prefix = s(params.tablePrefix) || DEFAULT_PREFIX;
  const onProgress = params.onProgress;
  const jobId = s(params.jobId);
  const log = (message: string) => {
    onProgress?.(message);
    if (jobId) {
      broadcastExcelWizardLog({ jobId, message, at: Date.now() });
    }
  };

  const inserted = { ledgerInfo: 0, charge: 0, occupancyParcel: 0, objectParcel: 0 };
  const geometryStats = { resolved: 0, nullGeom: 0 };
  let currentRowIndex = -1;

  try {
    log('테이블 준비 중...');
    const tableNames = await ensureTables(prefix);
    const li = `"${tableNames.ledgerInfo}"`;
    const ch = `"${tableNames.charge}"`;
    const oc = `"${tableNames.occupancyParcel}"`;
    const ob = `"${tableNames.objectParcel}"`;

    if (!params.appendOnly) {
      log('기존 데이터 초기화...');
      await pool.query(`TRUNCATE TABLE ${SCHEMA}.${ob} RESTART IDENTITY CASCADE`);
      await pool.query(`TRUNCATE TABLE ${SCHEMA}.${oc} RESTART IDENTITY CASCADE`);
      await pool.query(`TRUNCATE TABLE ${SCHEMA}.${ch} RESTART IDENTITY CASCADE`);
      await pool.query(`TRUNCATE TABLE ${SCHEMA}.${li} RESTART IDENTITY CASCADE`);
    }

    log(`총 ${rows.length}행 처리 시작...`);

    for (let i = 0; i < rows.length; i++) {
      currentRowIndex = i;
      const row = rows[i] ?? {};
      log(`행 ${i + 1}/${rows.length} 처리 시작`);
      const info = pickInfo(row, fieldMap);
      const liRes = await pool.query(
        `INSERT INTO ${SCHEMA}.${li}
         (road_name_type, road_route_no, occupancy_emd, occupancy_ri, occupancy_jibun, object_nearby_jibun, occupant_address, occupant_name, manager_name, occupant_reg_no, occupant_contact, occupancy_purpose, work_name, permanent_area, permanent_area_detail, quantity_temporary, permanent_period, temporary_period, restoration, road_mgmt_review_yn, excavation_yn, paving_ledger, pole_no, note, cutting_paving_done_date, consultation_result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id`,
        [
          info.roadNameType,
          info.roadRouteNo,
          info.occupancyEmd,
          info.occupancyRi,
          info.occupancyJibun,
          info.objectNearbyJibun,
          info.occupantAddress,
          info.occupantName,
          info.manager,
          info.occupantRegNo,
          info.occupantContact,
          info.occupancyPurpose,
          info.workName,
          info.permanentArea,
          info.permanentAreaDetail,
          info.quantityTemporary,
          info.permanentPeriod,
          info.temporaryPeriod,
          info.restoration,
          info.roadMgmtReviewYn,
          info.excavationYn,
          info.pavingLedger,
          info.poleNo,
          info.note,
          info.cuttingPavingDoneDate,
          info.consultationResult,
        ]
      );
      const ledgerInfoId = Number(liRes.rows[0]?.id);
      inserted.ledgerInfo += 1;

      const occupancyRaw = s(row[fieldMap.occupancyParcelText]);
      const objectRaw = s(row[fieldMap.objectParcelText]);
      const charge = pickCharge(row, fieldMap);

      const chRes = await pool.query(
        `INSERT INTO ${SCHEMA}.${ch}
         (ledger_info_id, permit_no, permit_date, completion_confirm_date, fee_total, temporary_total, usage_fee_total, vat_total, license_tax_yn, reduction_reason, change_detail, change_permit_date, completion_check_date, converted_diameter, excavation_detail, occupancy_parcel_text, object_parcel_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          ledgerInfoId,
          charge.permitNo,
          charge.permitDate,
          charge.completionConfirmDate,
          charge.feeTotal,
          charge.temporaryTotal,
          charge.usageFeeTotal,
          charge.vatTotal,
          charge.licenseTaxYn,
          charge.reductionReason,
          charge.changeDetail,
          charge.changePermitDate,
          charge.completionCheckDate,
          charge.convertedDiameter,
          charge.excavationDetail,
          occupancyRaw,
          objectRaw,
        ]
      );
      const chargeId = Number(chRes.rows[0]?.id);
      inserted.charge += 1;

      const useGptForOccupancy = Boolean(params.openaiApiKey) && isLikelyComplexParcelText(occupancyRaw);
      const useGptForObject = Boolean(params.openaiApiKey) && isLikelyComplexParcelText(objectRaw);
      log(
        `행 ${i + 1}/${rows.length} 점용지 정규화 시작 (${useGptForOccupancy ? 'GPT 호출중' : '규칙 분해'})`
      );
      const occupancyList = await normalizeParcels(occupancyRaw, params.openaiApiKey);
      log(`행 ${i + 1}/${rows.length} 점용지 정규화 완료 (${occupancyList.length}건)`);
      log(
        `행 ${i + 1}/${rows.length} 물건지 정규화 시작 (${useGptForObject ? 'GPT 호출중' : '규칙 분해'})`
      );
      const objectList = await normalizeParcels(objectRaw, params.openaiApiKey);
      log(`행 ${i + 1}/${rows.length} 물건지 정규화 완료 (${objectList.length}건)`);

      for (const jibun of occupancyList) {
        log(`행 ${i + 1}/${rows.length} 점용지 지번 작업중: ${jibun}`);
        log(`행 ${i + 1}/${rows.length} 점용지 VWorld 호출중: ${jibun}`);
        const g = await resolveParcelGeometry(jibun, geometryMode, params.vworldApiKey);
        log(
          `행 ${i + 1}/${rows.length} 점용지 VWorld 호출 결과: ${g.wkt ? '도형 확보' : '좌표/도형 미확보'} (${jibun})`
        );
        const q =
          `INSERT INTO ${SCHEMA}.${oc} (ledger_info_id, charge_id, jibun, geom)
           VALUES ($1, $2, $3,
             CASE
               WHEN $4::text IS NULL THEN NULL
               WHEN $5::int = 4326 THEN ST_Transform(ST_GeomFromText($4::text, 4326), 5181)
               ELSE ST_GeomFromText($4::text, 5181)
             END
           )`;
        await pool.query(q, [ledgerInfoId, chargeId, jibun, g.wkt, g.srid]);
        inserted.occupancyParcel += 1;
        if (g.wkt) geometryStats.resolved += 1;
        else geometryStats.nullGeom += 1;
      }

      for (const jibun of objectList) {
        log(`행 ${i + 1}/${rows.length} 물건지 지번 작업중: ${jibun}`);
        log(`행 ${i + 1}/${rows.length} 물건지 VWorld 호출중: ${jibun}`);
        const g = await resolveParcelGeometry(jibun, geometryMode, params.vworldApiKey);
        log(
          `행 ${i + 1}/${rows.length} 물건지 VWorld 호출 결과: ${g.wkt ? '도형 확보' : '좌표/도형 미확보'} (${jibun})`
        );
        const q =
          `INSERT INTO ${SCHEMA}.${ob} (ledger_info_id, charge_id, jibun, geom)
           VALUES ($1, $2, $3,
             CASE
               WHEN $4::text IS NULL THEN NULL
               WHEN $5::int = 4326 THEN ST_Transform(ST_GeomFromText($4::text, 4326), 5181)
               ELSE ST_GeomFromText($4::text, 5181)
             END
           )`;
        await pool.query(q, [ledgerInfoId, chargeId, jibun, g.wkt, g.srid]);
        inserted.objectParcel += 1;
        if (g.wkt) geometryStats.resolved += 1;
        else geometryStats.nullGeom += 1;
      }

      log(`행 ${i + 1}/${rows.length} 처리 완료`);
    }

    return {
      success: true,
      tableNames,
      inserted,
      geometryStats,
    };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (currentRowIndex >= 0) {
      log(`처리 실패: 행 ${currentRowIndex + 1}/${rows.length} - ${errMsg}`);
    } else {
      log(`처리 실패: ${errMsg}`);
    }
    return {
      success: false,
      error: errMsg,
      inserted,
      geometryStats,
    };
  }
}
