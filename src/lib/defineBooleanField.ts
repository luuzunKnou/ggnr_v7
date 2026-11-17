/**
 * define_field_type BOOLEAN ↔ 실제 PG 컬럼 타입에 따른 체크박스·저장값 판별.
 * DB 스키마 변경 없이 앱에서 형변환하는 쪽이 이득(마이그레이션 불필요).
 */
import {
  isDefineFieldBooleanType,
  parseDefineBooleanValue,
} from '@/lib/defineLayerCodeDisplay'

export function normalizePgDataType(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

/** information_schema.data_type / udt_name */
export function isPgBooleanDataType(dataType: unknown): boolean {
  const t = normalizePgDataType(dataType)
  return t === 'boolean' || t === 'bool'
}

export function isPgTextDataType(dataType: unknown): boolean {
  const t = normalizePgDataType(dataType)
  return (
    t === 'text' ||
    t === 'character varying' ||
    t === 'varchar' ||
    t === 'character' ||
    t === 'char' ||
    t === 'citext'
  )
}

/**
 * 체크박스 UI 여부.
 * - define이 BOOLEAN이 아니면 false
 * - 컬럼 타입 미확인(로딩 전)이면 true (boolean·varchar 모두 체크 UI)
 * - DB boolean 또는 varchar/text면 true
 * - 그 외(number 등)면 false — 텍스트 입력 유지
 */
export function shouldUseBooleanCheckbox(
  defineFieldType: unknown,
  pgDataType?: unknown,
  typesReady = false
): boolean {
  if (!isDefineFieldBooleanType(defineFieldType)) return false
  if (!typesReady) return true
  const t = normalizePgDataType(pgDataType)
  if (!t) return true
  return isPgBooleanDataType(t) || isPgTextDataType(t)
}

/** 폼 draft·API changes용 — 'true' | 'false' (서버가 boolean 컬럼이면 TRUE/FALSE로 캐스팅) */
export function booleanDraftValue(raw: unknown): string {
  return parseDefineBooleanValue(raw) ? 'true' : 'false'
}

/** 보고서·표시용 여/부 (빈 값은 empty) */
export function formatBooleanYeobu(
  raw: unknown,
  empty = '—'
): string {
  if (raw == null) return empty
  if (typeof raw === 'string' && raw.trim() === '') return empty
  return parseDefineBooleanValue(raw) ? '여' : '부'
}
