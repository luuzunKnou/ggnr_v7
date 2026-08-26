import { formatDetailScalarValue } from '@/lib/formatDetailScalar';

export type DefineCodeRow = {
  define_code_name?: string;
  define_code_kor_name?: string;
};

export function isDefineFieldCodeType(type: unknown): boolean {
  return String(type ?? '').trim().toUpperCase() === 'CODE';
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
