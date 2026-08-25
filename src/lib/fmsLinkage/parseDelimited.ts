/** FMS Ð 구분자 (U+00D0) */
export const FMS_DELIMITER = '\u00D0';

export const FMS_FACILITY_COLUMNS = [
  'facil_no',
  'facil_nm',
  'mng_no',
  'mng_main_cd',
  'permit_org_cd',
  'facil_owner',
  'route_class',
  'route_detail',
  'facil_class',
  'facil_gbn',
  'facil_kind',
  'facil_desc_cd',
  'addr_sido',
  'addr_gugun',
  'addr_dong',
  'addr_detail',
  'cpl_ymd',
  'temp_ymd',
  'rsp_to_ymd',
  'design_ymd_from',
  'design_ymd_to',
  'designer_nm',
  'const_ymd_from',
  'const_ymd_to',
  'constractor_cd',
  'constractor_nm',
  'const_amt',
  'spv_ymd_from',
  'spv_ymd_to',
  'supervisor_nm',
  'const_order_cd',
  'const_order_nm',
  'const_nm',
  'const_spvsr_nm',
  'dsn_book_st_yn',
  'eq_dsn_app_yn',
  'gam_reason_cd',
  'whl_pht_file_ct',
  'etc_pht_file_ct',
  'upper_no',
  'lnk_facil_no',
  'etc_remark',
] as const;

export const FMS_INSPECTION_COLUMNS = [
  'facil_no',
  'dign_seq',
  'start_ymd',
  'end_ymd',
  'dign_gbn',
  'regular_gbn',
  'rep_engineer_nm',
  'dign_amt',
  'state_grade',
  'dign_content',
  'amend_content',
  'wrt_ymd',
  'wrt_person_nm',
] as const;

export type FmsParsedRow = Record<string, string>;

/**
 * 2차 다운로드 raw → identifier 필터 후 행 목록.
 * headers: fms_identifier_header.col_name 순서
 */
export function parseFmsDelimitedData(
  rawData: string,
  identifier: string,
  headers: string[]
): FmsParsedRow[] {
  const id = String(identifier ?? '').trim();
  const result: FmsParsedRow[] = [];
  const text = String(rawData ?? '').trim();
  if (!text) return result;

  if (!text.includes(FMS_DELIMITER)) {
    console.warn(
      `[fms-parse] delimiter missing identifier=${id} — charset(FMS_DOWNLOAD_CHARSET) 확인`
    );
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tokens = trimmed.split(FMS_DELIMITER);
    if (tokens.length < 2) continue;

    const lineIdentifier = tokens[0]!.trim();
    if (id && lineIdentifier.toLowerCase() !== id.toLowerCase()) continue;

    const row: FmsParsedRow = { identifier: lineIdentifier };
    for (let i = 1; i < tokens.length; i++) {
      const header = headers[i - 1];
      const key = header ? header.toLowerCase() : `col_${i}`;
      row[key] = (tokens[i] ?? '').trim();
    }
    result.push(row);
  }

  return result;
}
