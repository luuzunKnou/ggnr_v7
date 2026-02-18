/**
 * define_layer 필드명(define_field_name)과 DB row 키가 대소문자만 다를 때
 * row에서 값을 안전하게 조회하기 위한 유틸.
 */

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
