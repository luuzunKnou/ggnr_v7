/**
 * define_layer 필드명(define_field_name)과 DB row 키가 대소문자만 다를 때
 * row에서 값을 안전하게 조회하기 위한 유틸.
 */

/** defineLayer 체크 플래그 (true / 'true' / '1') */
export function isDefineFieldFlagTrue(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

/**
 * row에서 fieldName에 해당하는 값을 대소문자 구분 없이 키 매칭하여 반환.
 */
export function getRowValueByField(row: Record<string, unknown>, fieldName: string): unknown {
  const key = String(fieldName);
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  const found = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return found != null ? row[found] : undefined;
}

function snakeToCamel(fieldName: string): string {
  return fieldName.replace(/_([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

/** define_field_name(snake) ↔ 서비스 camelCase 행 모두 조회 */
export function getRowValueByDefineField(row: Record<string, unknown>, fieldName: string): unknown {
  const direct = getRowValueByField(row, fieldName);
  if (direct !== undefined) return direct;
  const camel = snakeToCamel(fieldName);
  if (camel !== fieldName) {
    const camelVal = getRowValueByField(row, camel);
    if (camelVal !== undefined) return camelVal;
  }
  const compact = fieldName.replace(/_/g, '').toLowerCase();
  const found = Object.keys(row).find((k) => k.replace(/_/g, '').toLowerCase() === compact);
  return found != null ? row[found] : undefined;
}

const GEOM_DEFINE_FIELD_NAMES = new Set([
  'geom',
  'geometry',
  'the_geom',
  'wkb_geometry',
  'shape',
  'geojson',
]);

export function isGeomLikeDefineFieldName(name: string | null | undefined): boolean {
  return GEOM_DEFINE_FIELD_NAMES.has(String(name ?? '').trim().toLowerCase());
}

export type DefineFieldLike = {
  define_field_name?: string | null;
  define_field_kor_name?: string | null;
  define_field_idx?: string | number | null;
  define_field_show_list?: unknown;
  define_field_type?: string | null;
};

export function defineFieldIdxNum(f: DefineFieldLike): number {
  const n = parseInt(String(f.define_field_idx ?? '999999'), 10);
  return Number.isFinite(n) ? n : 999999;
}

/** define_field_show_list=true, geom 제외, define_field_idx 순 */
export function selectDefineLayerListFields(fields: DefineFieldLike[]): DefineFieldLike[] {
  return [...fields]
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim();
      if (!name) return false;
      if (isGeomLikeDefineFieldName(name)) return false;
      return isDefineFieldFlagTrue(f.define_field_show_list);
    })
    .sort((a, b) => defineFieldIdxNum(a) - defineFieldIdxNum(b));
}

/** define_field_is_key 로 지정된 컬럼명으로 행 키값 추출 */
export function getRowKey(row: Record<string, unknown>, keyFieldName: string | null): string | number | null {
  if (!keyFieldName) return null;
  const v = getRowValueByField(row, keyFieldName);
  if (v == null || v === '') return null;
  return typeof v === 'number' ? v : String(v);
}

const NUMBER_COLUMN_FIELD_NAMES = new Set(['ogc_fid', 'id']);

function isOgcFidOrIdField(fieldName: string | null | undefined): boolean {
  return NUMBER_COLUMN_FIELD_NAMES.has(String(fieldName ?? '').trim().toLowerCase());
}

/** ogc_fid·id 한글명이 ogc_fid/id/번호일 때만 목록 고정 폭 적용 */
function isNumberColumnKorLabel(korName?: string | null | undefined): boolean {
  const kor = String(korName ?? '').trim();
  if (!kor) return false;
  if (kor === '번호') return true;
  const lower = kor.toLowerCase();
  return lower === 'ogc_fid' || lower === 'id';
}

/** 목록 고정 폭 대상(ogc_fid·id + 한글명 ogc_fid/id/번호) */
export function isNumberColumnField(
  fieldName: string | null | undefined,
  korName?: string | null | undefined
): boolean {
  return isOgcFidOrIdField(fieldName) && isNumberColumnKorLabel(korName);
}

/** ogc_fid·id 필드명 여부 */
export function isOgcFidOrIdFieldName(fieldName: string | null | undefined): boolean {
  return isOgcFidOrIdField(fieldName);
}

/** keyField를 목록 맨 앞으로 */
export function orderDefineFieldsWithKeyFirst<T extends { define_field_name?: string | null }>(
  fields: T[],
  keyFieldName: string | null | undefined
): T[] {
  if (!keyFieldName) return fields;
  const keyLower = keyFieldName.trim().toLowerCase();
  const idx = fields.findIndex(
    (f) => String(f.define_field_name ?? '').trim().toLowerCase() === keyLower
  );
  if (idx <= 0) return fields;
  const next = [...fields];
  const [keyField] = next.splice(idx, 1);
  return [keyField, ...next];
}

/**
 * 목록·상세 표시용 한글 라벨.
 * ogc_fid·id 는 설정에 한글명이 없거나 영문 그대로일 때 «번호»로 표시.
 */
export function getDefineFieldDisplayLabel(
  fieldName: string | null | undefined,
  korName?: string | null | undefined
): string {
  const name = String(fieldName ?? '').trim();
  const kor = String(korName ?? '').trim();
  const lower = name.toLowerCase();
  if (isOgcFidOrIdField(name) && (!kor || kor.toLowerCase() === lower)) {
    return '번호';
  }
  return kor || name;
}
