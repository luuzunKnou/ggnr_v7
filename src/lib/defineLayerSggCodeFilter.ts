export const SGG_CODE_PREFIX_LEN = 5

const LEGAL_OR_ADMIN_DONG_KOR = new Set(['법정동', '행정동'])
const LEGAL_OR_ADMIN_DONG_FIELD = new Set(['bjd_cde', 'hjd_cde'])

export function normalizeSggPrefix(sggCode: unknown): string {
  const digits = String(sggCode ?? '').replace(/\D/g, '')
  return digits.slice(0, SGG_CODE_PREFIX_LEN)
}

/** 레이어설정 코드 목록에서 법정동·행정동 필드인지 */
export function isLegalOrAdminDongField(fieldName: unknown, korName: unknown): boolean {
  const kor = String(korName ?? '').trim()
  if (LEGAL_OR_ADMIN_DONG_KOR.has(kor)) return true
  const name = String(fieldName ?? '').trim().toLowerCase()
  return LEGAL_OR_ADMIN_DONG_FIELD.has(name)
}

export function codeMatchesSggPrefix(codeName: unknown, sggPrefix: string): boolean {
  if (!sggPrefix || sggPrefix.length < SGG_CODE_PREFIX_LEN) return false
  const digits = String(codeName ?? '').replace(/\D/g, '')
  return digits.startsWith(sggPrefix)
}

export function filterCodesBySggPrefix<T extends { define_code_name?: unknown }>(
  codes: T[],
  sggPrefix: string
): T[] {
  if (!sggPrefix || sggPrefix.length < SGG_CODE_PREFIX_LEN) return codes
  return codes.filter((c) => codeMatchesSggPrefix(c.define_code_name, sggPrefix))
}

/** 화면의 시군구 목록과 나머지 시군구 원본을 합친다. 다른 시군구 값은 유지 */
export function mergeSggFilteredCodesForSave<T extends { define_code_name?: unknown }>(
  originalAll: T[],
  editedVisible: T[],
  sggPrefix: string
): T[] {
  if (!sggPrefix || sggPrefix.length < SGG_CODE_PREFIX_LEN) return editedVisible
  const others = originalAll.filter((c) => !codeMatchesSggPrefix(c.define_code_name, sggPrefix))
  return [...others, ...editedVisible]
}
