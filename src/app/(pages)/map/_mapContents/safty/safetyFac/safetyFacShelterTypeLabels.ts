/** 한파·무더위쉼터 시설유형 중·소분류 코드 → 한글명 (소스 하드코딩) */

const MID_LABELS: Record<string, string> = {
  '001': '공공시설',
  '002': '야외시설',
  '003': '특정계층이용시설',
  '004': '생활밀착민간시설',
};

const SUB_LABELS: Record<string, string> = {
  '001-001': '공공청사',
  '001-002': '복지·문화·체육시설',
  '001-003': '스마트쉼터',
  '001-004': '기타',
  '002-001': '공원',
  '002-002': '정자·파고라 등',
  '003-001': '회원이용시설',
  '003-002': '특수근로자 쉼터',
  '003-003': '기타',
  '004-001': '금융기관',
  '004-002': '유통·판매·서비스시설',
  '004-003': '민간문화·체육시설',
  '004-004': '의료시설',
  '004-005': '종교시설',
  '004-006': '기타',
};

function pad3(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^0+/, '') || '0';
  return s.padStart(3, '0');
}

export function resolveShelterMidLabel(midCode: unknown): string {
  const key = pad3(midCode);
  return MID_LABELS[key] ?? String(midCode ?? '');
}

export function resolveShelterSubLabel(midCode: unknown, subCode: unknown): string {
  const mk = pad3(midCode);
  const sk = pad3(subCode);
  return SUB_LABELS[`${mk}-${sk}`] ?? String(subCode ?? '');
}
