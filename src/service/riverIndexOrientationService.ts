/**
 * 하천기본계획 색인도 방향 판정 — 색인도 칸 안 하천 모양(지도)과 도면 수면(PDF)을 비교해 저장.
 * 결과: file_data/{색인도 레이어}/_index_orientation.json (색인도 첨부 폴더와 같은 층 — 첨부 목록에 안 섞임)
 * 원본 PDF 는 수정하지 않는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSessionUsrId, requireMapAdminToolsAccess } from '@/lib/auth/guard';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import {
  isServiceFileDataSystemJunkFileName,
  isServiceFileDataTmpMarkedFileName,
} from '@/lib/serviceFileData';
import { riverBasicPlanIndexDefineTable, type RiverBasicPlanTab } from '@/lib/riverBasicPlanMapAttachmentLayers';
import {
  decideRotation,
  detectNorthArrow,
  extractWaterMask,
  type NorthArrow,
  rasterizePolygons,
  rotateAndResample,
  scoreRotations,
  sheetFrameFromRing,
  type BinaryGrid,
  type Pt,
  type RiverIndexOrientationMethod,
  type RiverIndexRotation,
  type RiverIndexRotationScore,
} from '@/lib/riverIndexOrientationEngine';
import { getDefineTableKeyFieldName } from '@/service/standardService';

type Tab = RiverBasicPlanTab;

export type RiverIndexOrientationRecord = {
  /** 자동 판정 방향 */
  autoRotation: RiverIndexRotation;
  method: RiverIndexOrientationMethod;
  score: number;
  second: number;
  confidence: number;
  scores: RiverIndexRotationScore[];
  /** PDF 에 들어 있던 회전값 */
  pageRotate: number;
  fileName: string;
  judgedAt: string;
  /** 지도 하천 모양을 잡은 레이어(한글 이름) */
  refLayer?: string;
  /** 기준 레이어 후보별 시도 결과 */
  refTrials?: RiverShapeLayerTrial[];
  /** 도면 방위표 — 있으면 N 이 위로 오도록 방향을 정한다(하천 모양 비교보다 우선) */
  north?: NorthArrow;
  /** 방위표 방향과 하천 모양 비교(뚜렷할 때)가 다를 때 — 검토 필요 */
  northShapeConflict?: boolean;
  /** 사람이 확정한 방향 — 있으면 자동 판정보다 우선, 다시 판정해도 유지 */
  manualRotation?: RiverIndexRotation;
  manualBy?: string;
  manualAt?: string;
  error?: string;
};

type OrientationStore = { version: 1; items: Record<string, RiverIndexOrientationRecord> };

const STORE_FILE = '_index_orientation.json';
/**
 * 지도 쪽 하천 모양 기준 레이어 — 앞에서부터 칸 안에 하천이 충분히 있는 첫 후보를 쓴다.
 * 지도에 그려지는 하천기본계획도·소하천 기본계획도(둘을 합쳐 지류까지)를 먼저 보고,
 * 비어 있는 칸은 하천구역·지목 하천·연속주제도, 마지막으로 종단면도 선(띠로 넓힘) 순으로 대신한다.
 */
type ShapeLayer = { names: string[]; label: string; kind: 'area' | 'line' };

const RIVER_SHAPE_LAYERS: Record<Tab, ShapeLayer[]> = {
  river: [
    { names: ['river_plan_as', 'river_plan_s_as'], label: '하천·소하천 기본계획도', kind: 'area' },
    { names: ['river_d_as'], label: '하천구역', kind: 'area' },
    { names: ['landown_river'], label: '지목 하천', kind: 'area' },
    { names: ['lsmd_cont_uj201_ujb100'], label: '하천구역(연속주제도)', kind: 'area' },
    { names: ['river_plan_jd_lm'], label: '종단면도 선', kind: 'line' },
  ],
  smallRiver: [
    { names: ['river_plan_s_as', 'river_plan_as'], label: '소하천·하천 기본계획도', kind: 'area' },
    { names: ['river_s_as'], label: '소하천구역', kind: 'area' },
    { names: ['lsmd_cont_uj301_ujc100'], label: '소하천구역(연속주제도)', kind: 'area' },
    { names: ['landown_river'], label: '지목 하천', kind: 'area' },
    { names: ['river_plan_s_jd_lm'], label: '종단면도 선', kind: 'line' },
  ],
};
/** 칸 면적 대비 하천이 이 비율 이상인 첫 레이어를 쓴다. 없으면 조금이라도 겹친 레이어 중 가장 넓은 것 */
const RIVER_SHAPE_MIN_AREA_RATIO = 0.01;
/** 종단면도 선은 칸 크기 대비 이 폭으로 넓혀 하천 띠로 본다 (좁은 하천용 마지막 대안) */
const LINE_BAND_RATIO = 0.015;

/** 기준 레이어별 시도 결과 — 검토 화면에서 «왜 비었는지» 확인용 */
export type RiverShapeLayerTrial = {
  label: string;
  status: 'used' | 'noTable' | 'empty' | 'small' | 'error' | 'skipped';
  /** 칸 면적 대비 하천 비율(%) */
  percent?: number;
  message?: string;
};

/** 렌더 긴 변(px) — 방위표 N 글자(몇 px)까지 보이도록. 수면 모양은 격자로 줄여 비교 */
const RENDER_LONG_PX = 1600;
/** 전체 판정 동시 처리 수 — 화면 응답이 밀리지 않게 낮게 */
const BATCH_CONCURRENCY = 2;
/** 판정 중간 저장 간격(건) */
const BATCH_FLUSH_EVERY = 10;

function normalizeTab(tab?: string | null): Tab {
  return tab === 'smallRiver' ? 'smallRiver' : 'river';
}

function esc(v: string): string {
  return v.replace(/'/g, "''");
}

function finalRotation(r: RiverIndexOrientationRecord): RiverIndexRotation {
  return r.manualRotation ?? r.autoRotation;
}

/* ── 저장 ─────────────────────────────────────────────── */

function storePath(tab: Tab): string {
  return path.join(resolveGgnrDataDir(), 'file_data', riverBasicPlanIndexDefineTable(tab), STORE_FILE);
}

async function readStore(tab: Tab): Promise<OrientationStore> {
  try {
    const raw = JSON.parse(await fs.readFile(storePath(tab), 'utf8')) as OrientationStore;
    if (raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object') return raw;
  } catch {
    /* 없음 */
  }
  return { version: 1, items: {} };
}

/** 같은 탭 저장이 겹치지 않게 순서대로 */
const writeChains = new Map<Tab, Promise<void>>();

function updateStore(tab: Tab, mutate: (s: OrientationStore) => void): Promise<void> {
  const prev = writeChains.get(tab) ?? Promise.resolve();
  const next = prev.then(async () => {
    const store = await readStore(tab);
    mutate(store);
    const file = storePath(tab);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fs.rename(tmp, file);
  });
  writeChains.set(
    tab,
    next.catch(() => undefined)
  );
  return next;
}

/* ── DB 조회 ──────────────────────────────────────────── */

async function physicalTable(logical: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(logical.toLowerCase())}' LIMIT 1`
    )
  );
  const name = String((res.rows?.[0] as { table_name?: string } | undefined)?.table_name ?? '').trim();
  return name || null;
}

function keySelectSql(indexLogical: string): string {
  const keyField = getDefineTableKeyFieldName(indexLogical);
  if (keyField && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(keyField)) {
    return `TRIM(COALESCE(i."${keyField}"::text, ''))`;
  }
  return `i.ogc_fid::text`;
}

export type RiverIndexSheetRow = { ogcFid: number; key: string; riverName: string; rivpCode: string };

async function listIndexSheets(tab: Tab): Promise<RiverIndexSheetRow[]> {
  const logical = riverBasicPlanIndexDefineTable(tab);
  const table = await physicalTable(logical);
  if (!table) return [];
  const t = table.replace(/"/g, '""');
  const keySel = keySelectSql(logical);
  const withNames = `SELECT i.ogc_fid::int AS "ogcFid", ${keySel} AS "key",
      COALESCE(i.river_name::text, '') AS "riverName", COALESCE(i.rivp_code::text, '') AS "rivpCode"
    FROM layer."${t}" i WHERE i.geom IS NOT NULL ORDER BY 3, 4, 1`;
  const plain = `SELECT i.ogc_fid::int AS "ogcFid", ${keySel} AS "key", '' AS "riverName", '' AS "rivpCode"
    FROM layer."${t}" i WHERE i.geom IS NOT NULL ORDER BY 1`;
  let rows: unknown[] = [];
  try {
    rows = (await db.execute(sql.raw(withNames))).rows ?? [];
  } catch {
    rows = (await db.execute(sql.raw(plain))).rows ?? [];
  }
  return (rows as Record<string, unknown>[])
    .map((r) => ({
      ogcFid: Number(r.ogcFid),
      key: String(r.key ?? '').trim(),
      riverName: String(r.riverName ?? '').trim(),
      rivpCode: String(r.rivpCode ?? '').trim(),
    }))
    .filter((r) => Number.isFinite(r.ogcFid) && r.key);
}

function parsePolygons(raw: unknown): Pt[][][] {
  let gj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      gj = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const rec = gj as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
  if (!rec) return [];
  const toRings = (poly: unknown): Pt[][] =>
    Array.isArray(poly)
      ? (poly as unknown[])
          .map((ring) =>
            Array.isArray(ring)
              ? (ring as unknown[])
                  .filter((p): p is number[] => Array.isArray(p) && p.length >= 2)
                  .map((p) => [Number(p[0]), Number(p[1])] as Pt)
              : []
          )
          .filter((ring) => ring.length >= 3)
      : [];
  if (rec.type === 'Polygon') return [toRings(rec.coordinates)].filter((p) => p.length);
  if (rec.type === 'MultiPolygon' && Array.isArray(rec.coordinates)) {
    return (rec.coordinates as unknown[]).map(toRings).filter((p) => p.length);
  }
  if (rec.type === 'GeometryCollection' && Array.isArray(rec.geometries)) {
    return rec.geometries.flatMap((g) => parsePolygons(g));
  }
  return [];
}

/** layer·public_layer 중 실제 테이블 (layer 우선) — "schema"."table" */
async function qualifiedTable(logical: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema IN ('layer', 'public_layer') AND lower(table_name) = '${esc(logical.toLowerCase())}'
       ORDER BY CASE table_schema WHEN 'layer' THEN 0 ELSE 1 END LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
  if (!row?.table_schema || !row?.table_name) return null;
  return `"${row.table_schema.replace(/"/g, '""')}"."${row.table_name.replace(/"/g, '""')}"`;
}

/** 한 테이블에서 칸 안 하천 면(3857)과 칸 면적 대비 비율. 선 레이어는 띠로 넓혀 면으로 */
async function clipShapeTable(
  table: string,
  indexTable: string,
  fid: number,
  kind: ShapeLayer['kind']
): Promise<{ polys: Pt[][][]; ratio: number }> {
  /** 칸을 하천 레이어 좌표계로 옮겨 비교 — 레이어 공간 색인을 그대로 쓰고 좌표계가 달라도 동작 */
  const sridRes = await db.execute(sql.raw(`SELECT ST_SRID(geom) AS srid FROM ${table} WHERE geom IS NOT NULL LIMIT 1`));
  const srid = Number((sridRes.rows?.[0] as { srid?: unknown } | undefined)?.srid);
  if (!Number.isFinite(srid) || srid <= 0) return { polys: [], ratio: 0 };
  const clip =
    kind === 'line'
      ? `ST_CollectionExtract(ST_Intersection(ST_Buffer(ST_Intersection(u.g, s.g), ${LINE_BAND_RATIO} * sqrt(ST_Area(s.g))), s.g), 3)`
      : `ST_CollectionExtract(ST_Intersection(u.g, s.g), 3)`;
  const res = await db.execute(
    sql.raw(
      `WITH s AS (SELECT ST_Transform(ST_MakeValid(geom), ${srid}) AS g FROM layer."${indexTable}" WHERE ogc_fid = ${fid}),
       u AS (
         SELECT ST_Union(ST_MakeValid(t.geom)) AS g FROM ${table} t, s
         WHERE t.geom IS NOT NULL AND t.geom && s.g AND ST_Intersects(t.geom, s.g)
       ),
       c AS (SELECT ${clip} AS g, s.g AS sg FROM u, s WHERE u.g IS NOT NULL)
       SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(c.g, ${srid}), 3857)) AS river,
              COALESCE(ST_Area(c.g) / NULLIF(ST_Area(c.sg), 0), 0) AS ratio
       FROM c`
    )
  );
  const row = res.rows?.[0] as { river?: unknown; ratio?: unknown } | undefined;
  return { polys: parsePolygons(row?.river), ratio: Number(row?.ratio ?? 0) || 0 };
}

/**
 * 색인도 칸 외곽 + 칸 안 하천 면 — 3857.
 * 후보 순서대로 칸 면적 1% 이상인 첫 후보를 쓰고, 없으면 조금이라도 겹친 후보 중 가장 넓은 것.
 * 후보마다 결과(테이블 없음·비어 있음·면적 %·오류)를 남겨 검토 화면에서 원인을 볼 수 있게 한다.
 */
async function loadSheetReference(
  tab: Tab,
  ogcFid: number
): Promise<{ ring: Pt[] | null; river: Pt[][][]; refLayer: string | null; trials: RiverShapeLayerTrial[] }> {
  const idx = await physicalTable(riverBasicPlanIndexDefineTable(tab));
  if (!idx) return { ring: null, river: [], refLayer: null, trials: [] };
  const i = idx.replace(/"/g, '""');
  const fid = Math.floor(ogcFid);
  const ringRes = await db.execute(
    sql.raw(`SELECT ST_AsGeoJSON(ST_Transform(geom, 3857)) AS ring FROM layer."${i}" WHERE ogc_fid = ${fid} LIMIT 1`)
  );
  const ring = parsePolygons((ringRes.rows?.[0] as { ring?: unknown } | undefined)?.ring)[0]?.[0] ?? null;
  if (!ring) return { ring: null, river: [], refLayer: null, trials: [] };

  const trials: RiverShapeLayerTrial[] = [];
  const found: { label: string; polys: Pt[][][]; ratio: number; trialIdx: number }[] = [];
  for (const cand of RIVER_SHAPE_LAYERS[tab]) {
    const tables = (await Promise.all(cand.names.map((n) => qualifiedTable(n)))).filter((t): t is string => t != null);
    if (tables.length === 0) {
      trials.push({ label: cand.label, status: 'noTable' });
      continue;
    }
    try {
      let polys: Pt[][][] = [];
      let ratio = 0;
      for (const t of tables) {
        const r = await clipShapeTable(t, i, fid, cand.kind);
        polys = polys.concat(r.polys);
        ratio += r.ratio;
      }
      const percent = Number((ratio * 100).toFixed(2));
      if (polys.length === 0 || ratio <= 0) {
        trials.push({ label: cand.label, status: 'empty', percent: 0 });
        continue;
      }
      trials.push({ label: cand.label, status: ratio >= RIVER_SHAPE_MIN_AREA_RATIO ? 'used' : 'small', percent });
      found.push({ label: cand.label, polys, ratio, trialIdx: trials.length - 1 });
      if (ratio >= RIVER_SHAPE_MIN_AREA_RATIO) break;
    } catch (e) {
      trials.push({ label: cand.label, status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const pick =
    found.find((f) => f.ratio >= RIVER_SHAPE_MIN_AREA_RATIO) ?? [...found].sort((a, b) => b.ratio - a.ratio)[0];
  if (!pick) return { ring, river: [], refLayer: null, trials };
  for (const f of found) {
    if (f !== pick && trials[f.trialIdx]) trials[f.trialIdx]!.status = 'skipped';
  }
  if (trials[pick.trialIdx]) trials[pick.trialIdx]!.status = 'used';
  return { ring, river: pick.polys, refLayer: pick.label, trials };
}

/* ── PDF ──────────────────────────────────────────────── */

async function findSheetPdf(tab: Tab, key: string): Promise<string | null> {
  const dir = path.join(resolveGgnrDataDir(), 'file_data', riverBasicPlanIndexDefineTable(tab), key);
  try {
    const names = (await fs.readdir(dir))
      .filter(
        (n) =>
          /\.pdf$/i.test(n) && !isServiceFileDataTmpMarkedFileName(n) && !isServiceFileDataSystemJunkFileName(n)
      )
      .sort((a, b) => a.localeCompare(b, 'ko'));
    return names[0] ? path.join(dir, names[0]) : null;
  } catch {
    return null;
  }
}

/**
 * 도면 첫 페이지를 회전 0 으로 렌더.
 * 캔버스는 반드시 pdf.js 자신의 캔버스 생성기로 만든다 — 다른 경로로 불린 @napi-rs/canvas 사본에 그리면
 * pdf.js 가 쓰는 Path2D 와 사본이 달라 «Value is none of these types String, Path» 로 실패한다.
 */
async function renderPdfFirstPage(file: string): Promise<{
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  pageRotate: number;
  /** 글자로 들어 있는 «N» 위치(렌더 픽셀) — 방위표 N 판단 보조 */
  letterPoints: Pt[];
}> {
  type TextItem = { str?: string; transform?: number[]; width?: number };
  type Ctx2d = {
    fillStyle: string;
    fillRect: (x: number, y: number, w: number, h: number) => void;
    getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
  };
  type PdfPage = {
    rotate: number;
    getViewport: (o: { scale: number; rotation: number }) => {
      width: number;
      height: number;
      convertToViewportPoint: (x: number, y: number) => number[];
    };
    render: (o: Record<string, unknown>) => { promise: Promise<void> };
    getTextContent: () => Promise<{ items: TextItem[] }>;
  };
  type PdfDoc = {
    getPage: (n: number) => Promise<PdfPage>;
    destroy: () => Promise<void>;
    canvasFactory: {
      create: (w: number, h: number) => { canvas: { width: number; height: number }; context: Ctx2d };
      destroy: (cc: unknown) => void;
    };
  };
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  };

  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const scale = RENDER_LONG_PX / Math.max(base.width, base.height, 1);
    const vp = page.getViewport({ scale, rotation: 0 });
    const cc = doc.canvasFactory.create(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
    try {
      const ctx = cc.context;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cc.canvas.width, cc.canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const img = ctx.getImageData(0, 0, cc.canvas.width, cc.canvas.height);
      const letterPoints: Pt[] = [];
      try {
        const tc = await page.getTextContent();
        for (const it of tc.items) {
          if (!/^\s*N\s*$/.test(it.str ?? '') || !it.transform) continue;
          const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = it.transform;
          const sw = Math.hypot(a, b) || 1;
          const sh = Math.hypot(c, d) || sw;
          const wid = it.width || sw * 0.7;
          /** 글자 기준점(왼쪽 아래) → 글자 가운데 */
          const ux = e + (a / sw) * wid * 0.5 + (c / sh) * sh * 0.4;
          const uy = f + (b / sw) * wid * 0.5 + (d / sh) * sh * 0.4;
          const [px, py] = vp.convertToViewportPoint(ux, uy);
          if (Number.isFinite(px) && Number.isFinite(py)) letterPoints.push([px!, py!]);
        }
      } catch {
        /* 글자 없음 */
      }
      return {
        rgba: img.data,
        w: cc.canvas.width,
        h: cc.canvas.height,
        pageRotate: Number(page.rotate) || 0,
        letterPoints,
      };
    } finally {
      doc.canvasFactory.destroy(cc);
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/* ── 판정 ─────────────────────────────────────────────── */

type JudgeResult = {
  record: RiverIndexOrientationRecord;
  water?: BinaryGrid;
  ref?: BinaryGrid;
};

async function judgeSheet(tab: Tab, sheet: RiverIndexSheetRow): Promise<JudgeResult> {
  const now = new Date().toISOString();
  const file = await findSheetPdf(tab, sheet.key);
  const empty = (error: string): JudgeResult => ({
    record: {
      autoRotation: 0,
      method: 'none',
      score: 0,
      second: 0,
      confidence: 0,
      scores: [],
      pageRotate: 0,
      fileName: file ? path.basename(file) : '',
      judgedAt: now,
      error,
    },
  });
  if (!file) return empty('색인도 PDF 없음');
  const { ring, river, refLayer, trials } = await loadSheetReference(tab, sheet.ogcFid);
  const frame = ring ? sheetFrameFromRing(ring) : null;
  if (!frame) return empty('색인도 칸 도형 없음');
  const ref = rasterizePolygons(frame, river);
  const img = await renderPdfFirstPage(file);
  const water = extractWaterMask(img.rgba, img.w, img.h);
  const scores = scoreRotations(water, ref);
  const d = decideRotation(scores, img.pageRotate, water, ref);
  /** 방위표 N 이 있으면 무조건 N 을 위로. 하천 모양 비교는 참고값으로만 남긴다 */
  const north = detectNorthArrow(img.rgba, img.w, img.h, { letterPoints: img.letterPoints });
  return {
    record: {
      autoRotation: north ? north.rotation : d.rotation,
      method: north ? 'north' : d.method,
      north: north ?? undefined,
      northShapeConflict: north ? d.method === 'shape' && d.rotation !== north.rotation : undefined,
      score: Number(d.score.toFixed(4)),
      second: Number(d.second.toFixed(4)),
      confidence: Number(d.confidence.toFixed(4)),
      scores: scores.map((s) => ({ rotation: s.rotation, score: Number(s.score.toFixed(4)) })),
      pageRotate: img.pageRotate,
      fileName: path.basename(file),
      judgedAt: now,
      refLayer: refLayer ?? undefined,
      refTrials: trials,
    },
    water,
    ref,
  };
}

/* ── 전체 판정(뒤에서) ────────────────────────────────── */

export type RiverIndexOrientationBatchStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const batchStatus = new Map<Tab, RiverIndexOrientationBatchStatus>();

function statusOf(tab: Tab): RiverIndexOrientationBatchStatus {
  return (
    batchStatus.get(tab) ?? {
      running: false,
      total: 0,
      done: 0,
      failed: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
    }
  );
}

/** missing: 결과 없음·오류, all: 사람 확정 제외 전체, allWithManual: 사람 확정까지 해제하고 전체 */
type BatchMode = 'missing' | 'all' | 'allWithManual';

async function runBatch(tab: Tab, mode: BatchMode): Promise<void> {
  const st = statusOf(tab);
  try {
    const store = await readStore(tab);
    const sheets = (await listIndexSheets(tab)).filter((s) => {
      const prev = store.items[s.key];
      /** 미판정 = 결과 없음 + 이전에 오류로 끝난 장 */
      if (mode === 'missing') return !prev || (Boolean(prev.error) && prev.manualRotation == null);
      if (mode === 'allWithManual') return true;
      return prev?.manualRotation == null;
    });
    const keepManual = mode !== 'allWithManual';
    st.total = sheets.length;
    let pending: Record<string, RiverIndexOrientationRecord> = {};
    const flush = async () => {
      const batch = pending;
      pending = {};
      if (Object.keys(batch).length === 0) return;
      await updateStore(tab, (s) => {
        for (const [k, rec] of Object.entries(batch)) {
          const prev = s.items[k];
          s.items[k] =
            keepManual && prev?.manualRotation != null
              ? { ...rec, manualRotation: prev.manualRotation, manualBy: prev.manualBy, manualAt: prev.manualAt }
              : rec;
        }
      });
    };
    let next = 0;
    const worker = async () => {
      while (next < sheets.length) {
        const sheet = sheets[next++]!;
        try {
          const { record } = await judgeSheet(tab, sheet);
          pending[sheet.key] = record;
          if (record.error) st.failed++;
        } catch (e) {
          st.failed++;
          pending[sheet.key] = {
            autoRotation: 0,
            method: 'none',
            score: 0,
            second: 0,
            confidence: 0,
            scores: [],
            pageRotate: 0,
            fileName: '',
            judgedAt: new Date().toISOString(),
            error: e instanceof Error ? e.message : String(e),
          };
        }
        st.done++;
        if (st.done % BATCH_FLUSH_EVERY === 0) await flush();
        await new Promise<void>((r) => setImmediate(r));
      }
    };
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
    await flush();
  } catch (e) {
    st.error = e instanceof Error ? e.message : String(e);
  } finally {
    st.running = false;
    st.finishedAt = new Date().toISOString();
  }
}

/* ── 서비스 액션 ──────────────────────────────────────── */

/** 상세 화면용 — { 색인도 첨부 키: 최종 방향 } */
export async function getRiverIndexOrientationRotations(params?: {
  tab?: string;
}): Promise<{ rotations: Record<string, RiverIndexRotation> }> {
  if (!(await getSessionUsrId())) return { rotations: {} };
  const store = await readStore(normalizeTab(params?.tab));
  const rotations: Record<string, RiverIndexRotation> = {};
  for (const [k, rec] of Object.entries(store.items)) {
    if (rec.error && rec.manualRotation == null) continue;
    rotations[k] = finalRotation(rec);
  }
  return { rotations };
}

export type RiverIndexOrientationListRow = RiverIndexSheetRow & {
  record: RiverIndexOrientationRecord | null;
  rotation: RiverIndexRotation | null;
};

/** 검토 화면 목록 — 색인도 전체 + 저장 결과 + 진행 상황 */
export async function listRiverIndexOrientations(params?: { tab?: string }): Promise<{
  layer: string;
  rows: RiverIndexOrientationListRow[];
  status: RiverIndexOrientationBatchStatus;
}> {
  await requireMapAdminToolsAccess();
  const tab = normalizeTab(params?.tab);
  const [sheets, store] = await Promise.all([listIndexSheets(tab), readStore(tab)]);
  return {
    layer: riverBasicPlanIndexDefineTable(tab),
    rows: sheets.map((s) => {
      const record = store.items[s.key] ?? null;
      return { ...s, record, rotation: record ? finalRotation(record) : null };
    }),
    status: statusOf(tab),
  };
}

/** 전체 판정 시작 — missing: 결과 없는 장만, all: 사람 확정이 아닌 장 모두, allWithManual: 사람 확정 포함 모두 */
export async function startRiverIndexOrientationBatch(params?: {
  tab?: string;
  mode?: string;
}): Promise<{ status: RiverIndexOrientationBatchStatus }> {
  await requireMapAdminToolsAccess();
  const tab = normalizeTab(params?.tab);
  const cur = statusOf(tab);
  if (cur.running) return { status: cur };
  const st: RiverIndexOrientationBatchStatus = {
    running: true,
    total: 0,
    done: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  batchStatus.set(tab, st);
  const mode: BatchMode =
    params?.mode === 'all' || params?.mode === 'allWithManual' ? params.mode : 'missing';
  void runBatch(tab, mode);
  return { status: st };
}

export async function getRiverIndexOrientationBatchStatus(params?: {
  tab?: string;
}): Promise<{ status: RiverIndexOrientationBatchStatus }> {
  await requireMapAdminToolsAccess();
  return { status: statusOf(normalizeTab(params?.tab)) };
}

/** 한 장만 다시 판정 (사람 확정은 유지) */
export async function judgeRiverIndexOrientation(params?: {
  tab?: string;
  key?: string;
}): Promise<{ record: RiverIndexOrientationRecord | null }> {
  await requireMapAdminToolsAccess();
  const tab = normalizeTab(params?.tab);
  const key = String(params?.key ?? '').trim();
  const sheet = (await listIndexSheets(tab)).find((s) => s.key === key);
  if (!sheet) throw new Error('색인도를 찾을 수 없습니다.');
  const { record } = await judgeSheet(tab, sheet);
  let saved: RiverIndexOrientationRecord | null = null;
  await updateStore(tab, (s) => {
    const prev = s.items[key];
    saved = prev?.manualRotation
      ? { ...record, manualRotation: prev.manualRotation, manualBy: prev.manualBy, manualAt: prev.manualAt }
      : record;
    s.items[key] = saved;
  });
  return { record: saved };
}

/** 사람 확정 — rotation 이 null 이면 확정 해제(자동 판정으로) */
export async function setRiverIndexOrientationManual(params?: {
  tab?: string;
  key?: string;
  rotation?: number | null;
}): Promise<{ record: RiverIndexOrientationRecord | null }> {
  const usrId = await requireMapAdminToolsAccess();
  const tab = normalizeTab(params?.tab);
  const key = String(params?.key ?? '').trim();
  if (!key) throw new Error('색인도를 찾을 수 없습니다.');
  const rot = params?.rotation;
  const manual =
    rot == null ? undefined : ((((Math.round(Number(rot) / 90) * 90) % 360) + 360) % 360 as RiverIndexRotation);
  let saved: RiverIndexOrientationRecord | null = null;
  await updateStore(tab, (s) => {
    const prev: RiverIndexOrientationRecord = s.items[key] ?? {
      autoRotation: 0,
      method: 'none',
      score: 0,
      second: 0,
      confidence: 0,
      scores: [],
      pageRotate: 0,
      fileName: '',
      judgedAt: new Date().toISOString(),
    };
    const next: RiverIndexOrientationRecord = { ...prev };
    if (manual == null) {
      delete next.manualRotation;
      delete next.manualBy;
      delete next.manualAt;
    } else {
      next.manualRotation = manual;
      next.manualBy = usrId;
      next.manualAt = new Date().toISOString();
    }
    s.items[key] = next;
    saved = next;
  });
  return { record: saved };
}

/** 검토 화면이 한 번에 여러 장을 요청해도 서버 렌더는 이만큼씩만 */
const PREVIEW_CONCURRENCY = 3;
let previewActive = 0;
const previewQueue: Array<() => void> = [];

async function withPreviewSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (previewActive >= PREVIEW_CONCURRENCY) {
    await new Promise<void>((resolve) => previewQueue.push(resolve));
  }
  previewActive++;
  try {
    return await fn();
  } finally {
    previewActive--;
    previewQueue.shift()?.();
  }
}

/** 검토용 그림 — 지도 하천 모양 / 판정 방향으로 돌린 도면 수면 (PNG data URL) */
export async function getRiverIndexOrientationPreview(params?: {
  tab?: string;
  key?: string;
  rotation?: number;
}): Promise<{
  refPng: string | null;
  waterPng: string | null;
  /** 겹침 — 지도 하천 파랑, 도면 수면 빨강, 겹친 곳 보라 */
  overlayPng: string | null;
  refLayer: string | null;
  refTrials: RiverShapeLayerTrial[];
  error?: string;
}> {
  await requireMapAdminToolsAccess();
  const tab = normalizeTab(params?.tab);
  const key = String(params?.key ?? '').trim();
  const sheet = (await listIndexSheets(tab)).find((s) => s.key === key);
  if (!sheet) {
    return {
      refPng: null,
      waterPng: null,
      overlayPng: null,
      refLayer: null,
      refTrials: [],
      error: '색인도를 찾을 수 없습니다.',
    };
  }
  const { record, water, ref } = await withPreviewSlot(() => judgeSheet(tab, sheet));
  if (!water || !ref) {
    return {
      refPng: null,
      waterPng: null,
      overlayPng: null,
      refLayer: record.refLayer ?? null,
      refTrials: record.refTrials ?? [],
      error: record.error,
    };
  }
  const stored = (await readStore(tab)).items[key];
  const rot = (params?.rotation ?? (stored ? finalRotation(stored) : record.autoRotation)) as RiverIndexRotation;
  const rotated = rotateAndResample(water, rot, ref.w, ref.h);
  return {
    refPng: await gridsToPng([{ g: ref, color: [37, 99, 235] }]),
    waterPng: await gridsToPng([{ g: rotated, color: [14, 165, 233] }]),
    overlayPng: await gridsToPng([
      { g: ref, color: [59, 130, 246] },
      { g: rotated, color: [239, 68, 68] },
    ]),
    refLayer: record.refLayer ?? null,
    refTrials: record.refTrials ?? [],
  };
}

/** 격자 그림 — 여러 장이면 겹친 칸은 보라색 */
async function gridsToPng(layers: { g: BinaryGrid; color: [number, number, number] }[]): Promise<string> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const base = layers[0]!.g;
  const S = 4;
  const canvas = createCanvas(base.w * S, base.h * S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, base.w * S, base.h * S);
  for (let y = 0; y < base.h; y++) {
    for (let x = 0; x < base.w; x++) {
      const k = y * base.w + x;
      const on = layers.filter((l) => l.g.data[k]);
      if (on.length === 0) continue;
      const c = on.length > 1 ? [126, 34, 206] : on[0]!.color;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x * S, y * S, S, S);
    }
  }
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}
