/** KRAS XML(LAND_INFO) 파싱 — v6 linkList/KRAS000002 응답용 */

export type KrasLandInfoRow = Record<string, string>;

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m?.[1]?.trim() ?? '';
}

/** XML 본문에서 LAND_INFO 블록별 필드 맵 추출 */
export function parseKrasLandInfoRows(xml: string): KrasLandInfoRow[] {
  if (!xml?.trim()) return [];
  const blocks = xml.match(/<LAND_INFO>[\s\S]*?<\/LAND_INFO>/gi) ?? [];
  const tags = [
    'ADM_SECT_CD',
    'LAND_LOC_CD',
    'LEDG_GBN',
    'BOBN',
    'BUBN',
    'JIMOK',
    'JIMOK_NM',
    'PAREA',
    'OWNER_NM',
    'OWN_GBN',
    'OWN_GBN_NM',
    'PANN_JIGA',
    'GRD',
    'GRD_YMD',
    'LAND_MOV_RSN_CD',
    'LAND_MOV_RSN_CD_NM',
    'LAND_MOV_YMD',
    'SHR_CNT',
    'OWNER_ADDR',
    'OWNDYMD',
    'OWN_RGT_CHG_RSN_CD_NM',
  ];
  return blocks.map((block) => {
    const row: KrasLandInfoRow = {};
    for (const tag of tags) row[tag] = pickTag(block, tag);
    return row;
  });
}

export function buildPnuFromKrasRow(row: KrasLandInfoRow): string {
  const adm = row.ADM_SECT_CD ?? '';
  const loc = row.LAND_LOC_CD ?? '';
  const ledg = row.LEDG_GBN ?? '';
  const bobn = row.BOBN ?? '';
  const bubn = row.BUBN ?? '';
  const pnu = `${adm}${loc}${ledg}${bobn}${bubn}`;
  return /^\d{19}$/.test(pnu) ? pnu : '';
}
