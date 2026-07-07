import type { KrasBodyRecord } from '@/lib/krasLandUseXml';
import type { KrasLandInfoRow } from '@/lib/krasLandXml';
import { zonesFromKrasLandUseRows } from '@/lib/krasLandUseXml';

type JsonRow = Record<string, unknown>;

export type ParcelLandInfoTabData = {
  characteristics: JsonRow[];
  landUses: JsonRow[];
  prices: JsonRow[];
  possessions: JsonRow[];
  source: 'kras' | 'cache' | 'vworld' | 'mixed';
};

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function krasCtypeLabel(ctype: unknown): string {
  const c = toStr(ctype);
  if (c === '1') return '포함';
  if (c === '2') return '저촉';
  if (c === '3') return '접함';
  return c || '-';
}

function dedupeLandUseRows(rows: KrasBodyRecord[]): KrasBodyRecord[] {
  const seen = new Set<string>();
  const out: KrasBodyRecord[] = [];
  for (const row of rows) {
    const key = `${toStr(row.UNAME)}||${toStr(row.CTYPE)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** KRAS 토지대장·토지이용계획 → 우클릭 필지정보 탭 형식 */
export function mapKrasToParcelLandInfoTab(
  landRow: KrasLandInfoRow | null,
  useRows: KrasBodyRecord[]
): ParcelLandInfoTabData {
  const zones = zonesFromKrasLandUseRows(useRows);
  const dedupedUses = dedupeLandUseRows(useRows);

  const characteristics: JsonRow[] = [];
  if (landRow) {
    const row: JsonRow = {};
    const jimok = toStr(landRow.JIMOK_NM) || toStr(landRow.JIMOK);
    if (jimok) row.lndcgrCodeNm = jimok;
    if (toStr(landRow.PAREA)) row.lndpclAr = landRow.PAREA;
    if (zones[0]) row.prposArea1Nm = zones[0];
    if (toStr(landRow.LAND_MOV_RSN_CD_NM)) row.lndMoveResnNm = landRow.LAND_MOV_RSN_CD_NM;
    if (toStr(landRow.LAND_MOV_YMD)) row.lndMoveDe = landRow.LAND_MOV_YMD;
    if (Object.keys(row).length) characteristics.push(row);
  }

  const possessions: JsonRow[] = [];
  if (landRow && (toStr(landRow.OWNER_NM) || toStr(landRow.OWN_GBN_NM))) {
    possessions.push({
      posesnSeCodeNm: toStr(landRow.OWN_GBN_NM) || undefined,
      ownerNm: toStr(landRow.OWNER_NM) || undefined,
      ownerAddr: toStr(landRow.OWNER_ADDR) || undefined,
      cnrsPsnCo: toStr(landRow.SHR_CNT) || undefined,
      ownshipChgDe: toStr(landRow.OWNDYMD) || undefined,
      ownshipChgCauseCodeNm: toStr(landRow.OWN_RGT_CHG_RSN_CD_NM) || undefined,
    });
  }

  const prices: JsonRow[] = [];
  if (landRow && toStr(landRow.PANN_JIGA)) {
    prices.push({ pblntfPclnd: landRow.PANN_JIGA });
  }

  const landUses: JsonRow[] = dedupedUses.map((row) => ({
    prposAreaDstrcCodeNm: toStr(row.UNAME) || undefined,
    cnflcAtNm: krasCtypeLabel(row.CTYPE),
    registDt: toStr(row.LAWNM) || undefined,
  }));

  return {
    characteristics,
    landUses,
    prices,
    possessions,
    source: 'kras',
  };
}

export function hasParcelLandInfoTabData(data: ParcelLandInfoTabData): boolean {
  return (
    data.characteristics.length > 0 ||
    data.landUses.length > 0 ||
    data.prices.length > 0 ||
    data.possessions.length > 0
  );
}

export function emptyParcelLandInfoTab(source: ParcelLandInfoTabData['source'] = 'vworld'): ParcelLandInfoTabData {
  return {
    characteristics: [],
    landUses: [],
    prices: [],
    possessions: [],
    source,
  };
}
