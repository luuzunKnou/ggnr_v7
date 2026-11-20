import { normalizeDefineFieldType } from '@/lib/defineLayerFieldTypeNormalize';
import { formatDetailScalarValue } from '@/lib/formatDetailScalar';

export type DefineCodeRow = {
  define_code_name?: string;
  define_code_kor_name?: string;
};

export function isDefineFieldCodeType(type: unknown): boolean {
  return String(type ?? '').trim().toUpperCase() === 'CODE';
}

export function isDefineFieldBooleanType(type: unknown): boolean {
  return normalizeDefineFieldType(type) === 'BOOLEAN';
}

/** DB·폼 값 → 체크 여부 (true/t/1/y 등) */
export function parseDefineBooleanValue(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw == null) return false;
  if (typeof raw === 'number') return raw !== 0 && Number.isFinite(raw);
  const s = String(raw).trim().toLowerCase();
  if (!s) return false;
  if (
    s === 'false' ||
    s === 'f' ||
    s === '0' ||
    s === 'n' ||
    s === 'no' ||
    s === 'off'
  ) {
    return false;
  }
  return (
    s === 'true' ||
    s === 't' ||
    s === '1' ||
    s === 'y' ||
    s === 'yes' ||
    s === 'on'
  );
}

function normalizeCodeKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

/** CODE 칸: 코드표 한글명. 없으면 원문(천단위 없음) */
export function resolveDefineCodeLabel(
  codes: DefineCodeRow[] | undefined,
  raw: unknown,
  empty = '-'
): string {
  const formatted = formatDetailScalarValue(raw, { empty, asLiteral: true });
  if (formatted === empty || formatted === '') return formatted;
  if (!codes?.length) return formatted;
  const key = normalizeCodeKey(formatted);
  for (const c of codes) {
    const name = normalizeCodeKey(String(c.define_code_name ?? ''));
    if (name !== key) continue;
    const kor = String(c.define_code_kor_name ?? '').trim();
    return kor || formatted;
  }
  return formatted;
}

export function formatDefineFieldDisplayValue(
  raw: unknown,
  fieldType: unknown,
  codes: DefineCodeRow[] | undefined,
  empty = '-'
): string {
  if (isDefineFieldCodeType(fieldType)) {
    return resolveDefineCodeLabel(codes, raw, empty);
  }
  return formatDetailScalarValue(raw, { empty, fieldType });
}
