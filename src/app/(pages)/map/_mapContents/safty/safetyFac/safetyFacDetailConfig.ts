/** 재난대응시설 상세: 레이어 설정(표시 여부·순서·한글명) 기준 */

import {
  resolveShelterMidLabel,
  resolveShelterSubLabel,
} from './safetyFacShelterTypeLabels';

export type SafetyFacDetailRow = {
  label: string;
  value: string;
  maxLength: number | null;
};

type SafetyFacOperPair = {
  begin: string;
  end: string;
  timeFormat: 'cold' | 'heat';
};

/** 테이블별 커스텀 필드: name 이후 고정 순서로 삽입 */
type SafetyFacOrderedField = {
  field: string;
  labelOverride?: string;
  format?: 'datetime' | 'date8' | 'shelterMid' | 'shelterSub' | 'shelterClass';
  /** shelterSub·shelterClass — 중분류 필드명 */
  midField?: string;
};

type SafetyFacDetailLayout = {
  name?: string;
  address?: string;
  detailAddress?: string;
  personnel?: string;
  remark?: string;
  operPairs?: SafetyFacOperPair[];
  /** 명칭→주소→운영시간→인원→비고 다음, 나머지 전에 삽입할 고정 행 */
  extraFields?: SafetyFacOrderedField[];
  /** 나머지 필드 뒤 최하단에 삽입 */
  tailFields?: SafetyFacOrderedField[];
  /** address·detailAddress·personnel·remark 대신 전체 순서를 직접 지정 */
  orderedFields?: SafetyFacOrderedField[];
};

const GEOM_FIELD_NAMES = new Set([
  'geom',
  'geometry',
  'the_geom',
  'wkb_geometry',
  'shape',
  'geojson',
]);

const SAFETY_FAC_DETAIL_LAYOUT: Record<string, SafetyFacDetailLayout> = {
  sd_cold_wave_shelter: {
    name: 'reare_nm',
    address: 'rona_daddr',
    detailAddress: 'daddr',
    personnel: 'utztn_psblty_tnop',
    remark: 'rmrk',
    operPairs: [
      { begin: 'wkdy_oper_bgng_hr', end: 'wkdy_oper_end_hr', timeFormat: 'cold' },
      { begin: 'sndy_oper_bgng_hr', end: 'sndy_oper_end_hr', timeFormat: 'cold' },
      { begin: 'stdy_oper_bgng_hr', end: 'stdy_oper_end_hr', timeFormat: 'cold' },
      { begin: 'lhldy_oper_bgng_hr', end: 'lhldy_oper_end_hr', timeFormat: 'cold' },
    ],
    extraFields: [
      { field: 'fclty_sclas', labelOverride: '시설분류', format: 'shelterClass', midField: 'fclt_type' },
      { field: 'yr' },
      { field: 'inpt_hr', format: 'datetime' },
      { field: 'mdfcn_hr', format: 'datetime' },
    ],
  },
  sd_heat_wave_shelter: {
    name: 'rstr_nm',
    address: 'rn_dtl_adres',
    detailAddress: 'dtl_adres',
    personnel: 'use_psbl_nmpr',
    remark: 'rm',
    operPairs: [
      { begin: 'wkday_oper_begin_time', end: 'wkday_oper_end_time', timeFormat: 'heat' },
      { begin: 'wkend_hday_oper_begin_time', end: 'wkend_hday_oper_end_time', timeFormat: 'heat' },
    ],
    extraFields: [
      { field: 'fclty_sclas', labelOverride: '시설분류', format: 'shelterClass', midField: 'fclty_ty' },
    ],
    tailFields: [
      { field: 'year' },
      { field: 'inpt_time', format: 'datetime' },
      { field: 'modf_time', format: 'datetime' },
    ],
  },
  sd_heat_mitigation_facility: {
    orderedFields: [
      { field: 'mng_no' },
      { field: 'dong_cd' },
      { field: 'stdg_cd' },
      { field: 'jibun_addr' },
      { field: 'addr' },
      { field: 'yr' },
      { field: 'instl_dt', format: 'date8' },
    ],
  },
  sd_earthquake_outdoor_evac_site: {
    orderedFields: [
      { field: 'vt_acmdfclty_nm' },
      { field: 'arcd' },
      { field: 'bdong_cd' },
      { field: 'hdong_cd' },
      { field: 'eqk_acmdfclty_adres' },
      { field: 'telno' },
    ],
  },
  sd_tsunami_emergency_evac_site: {
    orderedFields: [
      { field: 'shnt_place_nm' },
      { field: 'arcd' },
      { field: 'bdong_cd' },
      { field: 'hdong_cd' },
      { field: 'rn_dtl_adres' },
      { field: 'telno' },
    ],
  },
  sd_mois_displaced_temp_housing: {
    orderedFields: [
      { field: 'acmdfclty_sn' },
      { field: 'vt_acmdfclty_nm' },
      { field: 'korean_ctprvn_nm' },
      { field: 'hdong_cd' },
      { field: 'bdong_cd' },
      { field: 'sgg_rn' },
      { field: 'dtl_adres' },
    ],
  },
};

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

function isRawEmpty(v: unknown): boolean {
  if (v == null || v === '') return true;
  const s = String(v).trim();
  return s === '' || s === '—';
}

function fieldLabel(field: SafetyFacDefineField | undefined, fallback: string): string {
  return String(field?.define_field_kor_name ?? '').trim() || fallback;
}

function formatFieldValue(
  field: SafetyFacDefineField | undefined,
  raw: unknown,
  codesByField?: Record<string, DefineCodeRow[]>
): string {
  if (!field) return formatAttrVal(raw);
  const name = String(field.define_field_name ?? '').trim();
  return isDefineFieldCodeType(field)
    ? resolveDefineCodeLabel(codesByField?.[name.toLowerCase()], raw)
    : formatAttrVal(raw);
}

/** 한파 6자리·무더위 4자리 운영시간 → HH:mm */
export function formatSafetyFacOperTime(raw: unknown, timeFormat: 'cold' | 'heat'): string {
  if (isRawEmpty(raw)) return '';
  const s = String(raw).trim();
  if (s.includes(':')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;
  if (timeFormat === 'heat') {
    const d = digits.padStart(4, '0').slice(-4);
    return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
  }
  const d = digits.padStart(6, '0');
  const hhmm = d.slice(0, 4);
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

/** «평일 운영시작 시간» → «평일 운영시간» */
function deriveOperTimeLabel(beginKorName: string): string {
  return beginKorName
    .trim()
    .replace(/(시작|종료)\s*시간?$/, '시간')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFieldByName(fields: SafetyFacDefineField[]): Map<string, SafetyFacDefineField> {
  const map = new Map<string, SafetyFacDefineField>();
  for (const f of fields) {
    const name = String(f.define_field_name ?? '').trim().toLowerCase();
    if (name) map.set(name, f);
  }
  return map;
}

function appendMappedFieldRow(
  rows: SafetyFacDetailRow[],
  fieldName: string | undefined,
  attrs: Record<string, unknown>,
  fieldByName: Map<string, SafetyFacDefineField>,
  codesByField: Record<string, DefineCodeRow[]> | undefined,
  consumed: Set<string>
): void {
  if (!fieldName) return;
  const key = fieldName.toLowerCase();
  consumed.add(key);
  const field = fieldByName.get(key);
  const raw = pickSafetyFacAttr(attrs, fieldName);
  if (isRawEmpty(raw)) return;
  const value = formatFieldValue(field, raw, codesByField);
  if (value === '—' || !value.trim()) return;
  rows.push({
    label: fieldLabel(field, fieldName),
    value,
    maxLength: parseMaxLength(field?.define_field_max_length),
  });
}

function appendOperTimeRows(
  rows: SafetyFacDetailRow[],
  operPairs: SafetyFacOperPair[] | undefined,
  attrs: Record<string, unknown>,
  fieldByName: Map<string, SafetyFacDefineField>,
  consumed: Set<string>
): void {
  if (!operPairs?.length) return;
  for (const pair of operPairs) {
    const beginKey = pair.begin.toLowerCase();
    const endKey = pair.end.toLowerCase();
    consumed.add(beginKey);
    consumed.add(endKey);
    const beginField = fieldByName.get(beginKey);
    const beginRaw = pickSafetyFacAttr(attrs, pair.begin);
    const endRaw = pickSafetyFacAttr(attrs, pair.end);
    if (isRawEmpty(beginRaw) && isRawEmpty(endRaw)) continue;
    const label = deriveOperTimeLabel(fieldLabel(beginField, pair.begin));
    const start = isRawEmpty(beginRaw) ? '—' : formatSafetyFacOperTime(beginRaw, pair.timeFormat);
    const end = isRawEmpty(endRaw) ? '—' : formatSafetyFacOperTime(endRaw, pair.timeFormat);
    rows.push({
      label,
      value: `${start} ~ ${end}`,
      maxLength: null,
    });
  }
}

/** `YYYY-MM-DD HH:mm:ss` (밀리초 제거) */
function formatSafetyFacDateTime(raw: unknown): string {
  if (isRawEmpty(raw)) return formatAttrVal(raw);
  const s = String(raw).trim();
  // ISO 형식 → 밀리초 제거
  const m = s.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  if (m) return m[1].replace('T', ' ');
  return s;
}

/** `YYYYMMDD` → `YYYY-MM-DD` */
function formatSafetyFacInstallDate(raw: unknown): string {
  if (isRawEmpty(raw)) return formatAttrVal(raw);
  const s = String(raw).trim();
  if (s.includes('-')) return s.slice(0, 10);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return s;
}

function appendExtraFieldRows(
  rows: SafetyFacDetailRow[],
  extraFields: SafetyFacOrderedField[] | undefined,
  attrs: Record<string, unknown>,
  fieldByName: Map<string, SafetyFacDefineField>,
  codesByField: Record<string, DefineCodeRow[]> | undefined,
  consumed: Set<string>
): void {
  if (!extraFields?.length) return;
  for (const ef of extraFields) {
    if (ef.format === 'shelterClass') {
      const midField = ef.midField ?? '';
      const subField = ef.field;
      if (midField) consumed.add(midField.toLowerCase());
      consumed.add(subField.toLowerCase());
      const midRaw = midField ? pickSafetyFacAttr(attrs, midField) : undefined;
      const subRaw = pickSafetyFacAttr(attrs, subField);
      if (isRawEmpty(midRaw) && isRawEmpty(subRaw)) continue;
      const midLabel = isRawEmpty(midRaw) ? '' : resolveShelterMidLabel(midRaw);
      const subLabel = isRawEmpty(subRaw) ? '' : resolveShelterSubLabel(midRaw, subRaw);
      const value = [midLabel, subLabel].filter(Boolean).join(' > ');
      if (!value) continue;
      rows.push({
        label: ef.labelOverride ?? '시설분류',
        value,
        maxLength: null,
      });
      continue;
    }

    const key = ef.field.toLowerCase();
    consumed.add(key);
    const field = fieldByName.get(key);
    const raw = pickSafetyFacAttr(attrs, ef.field);
    const label = ef.labelOverride ?? fieldLabel(field, ef.field);

    let value: string;
    if (ef.format === 'shelterMid') {
      value = isRawEmpty(raw) ? '—' : resolveShelterMidLabel(raw);
    } else if (ef.format === 'shelterSub') {
      const midRaw = ef.midField ? pickSafetyFacAttr(attrs, ef.midField) : undefined;
      value = isRawEmpty(raw) ? '—' : resolveShelterSubLabel(midRaw, raw);
    } else if (ef.format === 'datetime') {
      value = isRawEmpty(raw) ? '—' : formatSafetyFacDateTime(raw);
    } else if (ef.format === 'date8') {
      value = isRawEmpty(raw) ? '—' : formatSafetyFacInstallDate(raw);
    } else {
      value = formatFieldValue(field, raw, codesByField);
    }

    if (!value || value === '—') continue;
    rows.push({ label, value, maxLength: parseMaxLength(field?.define_field_max_length) });
  }
}

/** 상세 Table: 명칭·주소·운영시간·인원·비고 우선, 나머지는 define_field_idx 순 */
export function buildSafetyFacCustomDetailRows(
  table: string,
  attrs: Record<string, unknown>,
  fields: SafetyFacDefineField[],
  codesByField?: Record<string, DefineCodeRow[]>
): SafetyFacDetailRow[] {
  const layout = SAFETY_FAC_DETAIL_LAYOUT[table];
  if (!layout) {
    return buildSafetyFacDetailRowsFromDefine(attrs, fields, codesByField);
  }

  const fieldByName = buildFieldByName(fields);
  const consumed = new Set<string>();
  const rows: SafetyFacDetailRow[] = [];

  // orderedFields가 있으면 해당 순서로만 출력
  if (layout.orderedFields?.length) {
    appendExtraFieldRows(rows, layout.orderedFields, attrs, fieldByName, codesByField, consumed);
    // 나머지 show_detail 필드
    const remaining = fields
      .filter((f) => {
        const name = String(f.define_field_name ?? '').trim().toLowerCase();
        if (!name || GEOM_FIELD_NAMES.has(name) || consumed.has(name)) return false;
        return defineFieldFlagTrue(f.define_field_show_detail);
      })
      .sort((a, b) => defineFieldIdx(a) - defineFieldIdx(b));
    for (const f of remaining) {
      const name = String(f.define_field_name ?? '').trim();
      const raw = pickSafetyFacAttr(attrs, name);
      const value = formatFieldValue(f, raw, codesByField);
      rows.push({ label: fieldLabel(f, name), value, maxLength: parseMaxLength(f.define_field_max_length) });
    }
    return rows.filter((r) => Boolean(r.label));
  }

  appendMappedFieldRow(rows, layout.name, attrs, fieldByName, codesByField, consumed);
  appendMappedFieldRow(rows, layout.address, attrs, fieldByName, codesByField, consumed);
  appendMappedFieldRow(rows, layout.detailAddress, attrs, fieldByName, codesByField, consumed);
  appendOperTimeRows(rows, layout.operPairs, attrs, fieldByName, consumed);
  appendMappedFieldRow(rows, layout.personnel, attrs, fieldByName, codesByField, consumed);
  appendMappedFieldRow(rows, layout.remark, attrs, fieldByName, codesByField, consumed);
  appendExtraFieldRows(rows, layout.extraFields, attrs, fieldByName, codesByField, consumed);

  if (layout.tailFields?.length) {
    for (const tf of layout.tailFields) {
      consumed.add(tf.field.toLowerCase());
      if (tf.midField) consumed.add(tf.midField.toLowerCase());
    }
  }

  const remaining = fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim().toLowerCase();
      if (!name || GEOM_FIELD_NAMES.has(name) || consumed.has(name)) return false;
      return defineFieldFlagTrue(f.define_field_show_detail);
    })
    .sort((a, b) => defineFieldIdx(a) - defineFieldIdx(b));

  for (const f of remaining) {
    const name = String(f.define_field_name ?? '').trim();
    const raw = pickSafetyFacAttr(attrs, name);
    const value = formatFieldValue(f, raw, codesByField);
    rows.push({
      label: fieldLabel(f, name),
      value,
      maxLength: parseMaxLength(f.define_field_max_length),
    });
  }

  appendExtraFieldRows(rows, layout.tailFields, attrs, fieldByName, codesByField, consumed);

  return rows.filter((r) => Boolean(r.label));
}

/** 상세 표시 칸만 필드 순서대로 */
export function buildSafetyFacDetailRowsFromDefine(
  attrs: Record<string, unknown>,
  fields: SafetyFacDefineField[],
  codesByField?: Record<string, DefineCodeRow[]>
): SafetyFacDetailRow[] {
  return fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim().toLowerCase();
      if (!name || GEOM_FIELD_NAMES.has(name)) return false;
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
  const parts = fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '').trim().toLowerCase();
      if (!name || GEOM_FIELD_NAMES.has(name)) return false;
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
