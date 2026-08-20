/** 재난대응시설 상세: 레이어 설정(표시 여부·순서·한글명) 기준 */

export type SafetyFacDefineField = {
  define_field_name?: string;
  define_field_kor_name?: string;
  define_field_show_detail?: unknown;
  define_field_show_title?: unknown;
  define_field_is_key?: unknown;
  define_field_idx?: unknown;
  define_field_max_length?: unknown;
  define_field_type?: unknown;
};

export type DefineCodeRow = {
  define_code_name?: string;
  define_code_kor_name?: string;
};

export function defineFieldFlagTrue(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

export function defineFieldIdx(f: { define_field_idx?: unknown }): number {
  const n = parseInt(String(f.define_field_idx ?? '999999'), 10);
  return Number.isFinite(n) ? n : 999999;
}

export function pickSafetyFacAttr(attrs: Record<string, unknown>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(attrs, field)) return attrs[field];
  const lk = field.toLowerCase();
  for (const rk of Object.keys(attrs)) {
    if (rk.toLowerCase() === lk) return attrs[rk];
  }
  return undefined;
}

function parseMaxLength(v: unknown): number | null {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatAttrVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function isDefineFieldCodeType(f: { define_field_type?: unknown }): boolean {
  return String(f.define_field_type ?? '').trim().toUpperCase() === 'CODE';
}

/** CODE 칸: 코드명과 같으면 한글명. 없으면 원본 */
export function resolveDefineCodeLabel(codes: DefineCodeRow[] | undefined, raw: unknown): string {
  const formatted = formatAttrVal(raw);
  if (formatted === '—' || formatted === '') return formatted;
  if (!codes?.length) return formatted;
  const key = formatted.trim().toLowerCase().replace(/^(-?\d+)\.0+$/, '$1');
  for (const c of codes) {
    const name = String(c.define_code_name ?? '').trim().toLowerCase().replace(/^(-?\d+)\.0+$/, '$1');
    if (name !== key) continue;
    const kor = String(c.define_code_kor_name ?? '').trim();
    return kor || formatted;
  }
  return formatted;
}

/** 상세 표시 칸만 필드 순서대로 */
export function buildSafetyFacDetailRowsFromDefine(
  attrs: Record<string, unknown>,
  fields: SafetyFacDefineField[],
  codesByField?: Record<string, DefineCodeRow[]>
): { label: string; value: string; maxLength: number | null }[] {
  const geomNames = new Set(['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape', 'geojson']);
  return fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim().toLowerCase();
      if (!name || geomNames.has(name)) return false;
      return defineFieldFlagTrue(f.define_field_show_detail);
    })
    .sort((a, b) => defineFieldIdx(a) - defineFieldIdx(b))
    .map((f) => {
      const name = String(f.define_field_name ?? '').trim();
      const label = String(f.define_field_kor_name ?? '').trim() || name;
      const raw = pickSafetyFacAttr(attrs, name);
      const value = isDefineFieldCodeType(f)
        ? resolveDefineCodeLabel(codesByField?.[name.toLowerCase()], raw)
        : formatAttrVal(raw);
      return {
        label,
        value,
        maxLength: parseMaxLength(f.define_field_max_length),
      };
    })
    .filter((r) => Boolean(r.label));
}

/** 제목 칸만 필드 순서대로. 폭염저감은 칸 사이를 하이픈으로 잇는다. */
export function buildSafetyFacTitleFromDefine(
  attrs: Record<string, unknown>,
  fields: SafetyFacDefineField[],
  codesByField: Record<string, DefineCodeRow[]> | undefined,
  table: string
): string {
  const geomNames = new Set(['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape', 'geojson']);
  const parts = fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim().toLowerCase();
      if (!name || geomNames.has(name)) return false;
      return defineFieldFlagTrue(f.define_field_show_title);
    })
    .sort((a, b) => defineFieldIdx(a) - defineFieldIdx(b))
    .map((f) => {
      const name = String(f.define_field_name ?? '').trim();
      const raw = pickSafetyFacAttr(attrs, name);
      const value = isDefineFieldCodeType(f)
        ? resolveDefineCodeLabel(codesByField?.[name.toLowerCase()], raw)
        : formatAttrVal(raw);
      if (value === '—' || !value.trim()) return '';
      return value.trim();
    })
    .filter(Boolean);
  const sep = table === 'sd_heat_mitigation_facility' ? ' - ' : ' ';
  return parts.join(sep);
}
