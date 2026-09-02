/**
 * 도로 업무편람 — layer.rd_work_target_review / layer.rd_hbook_mat
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '@/database/db';
import { rdHbookMat } from '@/database/schema/rd_hbook_mat';
import { rdWorkTargetReview } from '@/database/schema/rd_work_target_review';
import { ensureRoadWorkHandbookTables } from '@/service/ensureLayerAppTables';

const ORGS = new Set(['별도', '대가없음', '과업포함']);
const EXAMPLE_KINDS = new Set([
  'newWiden',
  'zoneArea',
  'newLen5',
  'roadTypeLen',
  'disaster',
  'area30000',
  'cost100',
  'cost50',
  'facilityOrCost',
]);

export type HandbookFormulaDto = {
  kind: string;
  new_km?: number;
  widen_km?: number;
  cost?: number;
  area?: number;
  zones?: Record<string, number>;
  roads?: Record<string, number>;
  eval_area?: number;
  review_area?: number;
  eval_km?: number;
  review_km?: number;
};

export type HandbookReviewDto = {
  no: number;
  name: string;
  law: string;
  criteria: string;
  criteriaItems: string[];
  when: string;
  org: '별도' | '대가없음' | '과업포함';
  note?: string;
  exampleKind?: string;
  formula: HandbookFormulaDto | null;
};

export type HandbookFileDto = {
  name: string;
  src: string;
  url?: string;
};

export type HandbookMaterialDto = {
  id: string;
  chapter: string;
  name: string;
  source: string;
  xmlUrl?: string;
  lawViewUrl?: string;
  notesOnly?: boolean;
  files: HandbookFileDto[];
};

function asOrg(raw: string | null | undefined): HandbookReviewDto['org'] {
  const v = String(raw ?? '').trim();
  return ORGS.has(v) ? (v as HandbookReviewDto['org']) : '별도';
}

function parseFormula(raw: unknown): HandbookFormulaDto | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const kind = String(rec.kind ?? '').trim();
  if (!kind) return null;
  return rec as HandbookFormulaDto;
}

function filesFromMatUrl(title: string, remark: string, matUrl: string | null | undefined): HandbookFileDto[] {
  const urls = String(matUrl ?? '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return [];
  return urls.map((url, i) => ({
    name: urls.length === 1 ? title : `${title} (${i + 1})`,
    src: remark || title,
    url,
  }));
}

function mapReview(row: typeof rdWorkTargetReview.$inferSelect): HandbookReviewDto {
  const formula = parseFormula(row.formula);
  const kind = formula?.kind && EXAMPLE_KINDS.has(formula.kind) ? formula.kind : undefined;
  const items = String(row.tgtContent ?? '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const note = String(row.remark ?? '').trim();
  return {
    no: Number(row.seqNo ?? 0),
    name: String(row.title ?? '').trim(),
    law: String(row.law ?? '').trim(),
    criteria: String(row.criteria ?? '').trim(),
    criteriaItems: items,
    when: String(row.timing ?? '').trim() || '—',
    org: asOrg(row.implOrg),
    ...(note ? { note } : {}),
    ...(kind ? { exampleKind: kind } : {}),
    formula,
  };
}

function mapMaterial(row: typeof rdHbookMat.$inferSelect): HandbookMaterialDto {
  const title = String(row.title ?? '').trim();
  const source = String(row.remark ?? '').trim();
  const xmlUrl = String(row.xmlUrl ?? '').trim();
  const lawViewUrl = String(row.origUrl ?? '').trim();
  const files = filesFromMatUrl(title, source, row.matUrl);
  const notesOnly = files.length === 0 && !xmlUrl && !lawViewUrl;
  return {
    id: String(row.id),
    chapter: String(row.category ?? '').trim(),
    name: title,
    source,
    files,
    ...(xmlUrl ? { xmlUrl } : {}),
    ...(lawViewUrl ? { lawViewUrl } : {}),
    ...(notesOnly ? { notesOnly: true } : {}),
  };
}

export async function listCatalog(): Promise<{
  reviews: HandbookReviewDto[];
  materials: HandbookMaterialDto[];
}> {
  await ensureRoadWorkHandbookTables();
  const [reviewRows, materialRows] = await Promise.all([
    db
      .select()
      .from(rdWorkTargetReview)
      .orderBy(asc(rdWorkTargetReview.seqNo), asc(rdWorkTargetReview.id)),
    db.select().from(rdHbookMat).orderBy(asc(rdHbookMat.seqNo), asc(rdHbookMat.id)),
  ]);
  return {
    reviews: reviewRows.map(mapReview),
    materials: materialRows.map(mapMaterial),
  };
}

export async function getHandbookMaterialXmlUrl(params: {
  id?: string;
}): Promise<{ xmlUrl: string | null }> {
  const id = Number(params?.id ?? '');
  if (!Number.isFinite(id) || id <= 0) return { xmlUrl: null };
  await ensureRoadWorkHandbookTables();
  const rows = await db.select().from(rdHbookMat).where(eq(rdHbookMat.id, id)).limit(1);
  const xmlUrl = String(rows[0]?.xmlUrl ?? '').trim();
  return { xmlUrl: xmlUrl || null };
}
