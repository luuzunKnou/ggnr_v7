import type { OccupationLedgerFieldMap } from '@/lib/occupationLedgerBinding';

/** 반칸에서 말줄임이 날 길이 — 보상편입·공사대장과 동일 기준 */
const ATTR_FULL_WIDTH_MIN_LEN = 12;

function lower(v: string | undefined): string {
  return String(v ?? '').trim().toLowerCase();
}

/** 점용장소·비고·주소·점용명 등은 항상 한 줄 */
function occupationRoleFields(fields: OccupationLedgerFieldMap) {
  return {
    place: lower(fields.placeField),
    purpose: lower(fields.purposeField),
    remark: lower(fields.remarkField),
    ownerAddr: lower(fields.ownerAddrField),
    name: lower(fields.nameField),
    area: lower(fields.areaField),
    start: lower(fields.startField),
    end: lower(fields.endField),
  };
}

export function isOccupationLedgerAttrFullWidth(
  fieldLower: string,
  fields: OccupationLedgerFieldMap,
  displayText: string,
  options?: { areaEditing?: boolean }
): boolean {
  const roles = occupationRoleFields(fields);
  if (fieldLower === 'geom') return true;
  if (roles.place && fieldLower === roles.place) return true;
  if (roles.purpose && fieldLower === roles.purpose) return true;
  if (roles.remark && fieldLower === roles.remark) return true;
  if (roles.ownerAddr && fieldLower === roles.ownerAddr) return true;
  if (roles.name && fieldLower === roles.name) return true;
  if (roles.area && fieldLower === roles.area && options?.areaEditing) return true;
  /** 긴 문구도 한 줄에 두 칸 — 시작·종료는 항상 같은 행 */
  if (roles.start && fieldLower === roles.start) return false;
  if (roles.end && fieldLower === roles.end) return false;

  const t = String(displayText ?? '').trim();
  if (t && t !== '—' && [...t].length >= ATTR_FULL_WIDTH_MIN_LEN) return true;
  return false;
}

export function isOccupationLedgerExtraFullWidth(value: string): boolean {
  const t = String(value ?? '').trim();
  if (!t || t === '—') return false;
  return [...t].length >= ATTR_FULL_WIDTH_MIN_LEN;
}
