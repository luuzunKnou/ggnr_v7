/**
 * 엑셀 시트를 header: 1~3행으로 읽어 컬럼 키·데이터 행을 만든다.
 * 병합 셀은 같은 행에서 빈 칸을 왼쪽 값으로 채운 뒤 처리한다.
 * 시트 하단의 완전 빈 행은 제거한다(키 중복·행 수 집계에 포함되지 않도록).
 */

/**
 * SheetJS `sheet_to_json` 기본값은 raw:true라 날짜가 일련번호 숫자로 들어온다.
 * raw:false + dateNF로 셀 서식에 가까운 문자열을 쓰고, read 시 cellDates:true와 함께 쓰는 것을 권장한다.
 */
export const SHEET_TO_JSON_HEADER1_DISPLAY = {
  header: 1,
  defval: '',
  raw: false,
  dateNF: 'yyyy-mm-dd',
} as const;

/** 로컬 달력 기준 YYYY-MM-DD (날짜 셀이 JS Date로 남는 경우 보조) */
export function formatDateLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** sheet_to_json 2차원 결과에서 Date를 문자열로 통일 */
export function coerceExcelDateCellsInAoa(data: unknown[][]): void {
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v instanceof Date && !Number.isNaN(v.getTime())) {
        row[c] = formatDateLocalYmd(v);
      }
    }
  }
}

export type ExcelMatrixParseResult = {
  headers: string[];
  rows: Record<string, unknown>[];
  samples: Record<string, unknown[]>;
  /** 타이틀(헤더)이 1행만인지 */
  hasSingleTitleRow: boolean;
};

/** 헤더 열이 아닌 데이터 열 기준으로, 행에 하나라도 의미 있는 값이 있는지 */
function rowHasAnyCellValue(row: Record<string, unknown>, headerKeys: string[]): boolean {
  for (const h of headerKeys) {
    const v = row[h];
    if (v == null || v === '') continue;
    if (typeof v === 'number') return !Number.isNaN(v);
    if (typeof v === 'boolean') return true;
    if (String(v).trim() !== '') return true;
  }
  return false;
}

function trimTrailingEmptyRows(rows: Record<string, unknown>[], headerKeys: string[]): void {
  while (rows.length > 0 && !rowHasAnyCellValue(rows[rows.length - 1]!, headerKeys)) {
    rows.pop();
  }
}

function carryMergedHeaderRow(row: unknown[], colCount: number): string[] {
  const carried: string[] = [];
  for (let j = 0; j < colCount; j++) {
    const v = String(row[j] ?? '').trim();
    carried.push(v || (j > 0 ? carried[j - 1] : ''));
  }
  return carried;
}

function uniquifyHeaderNames(baseNames: string[]): string[] {
  const used = new Set<string>();
  return baseNames.map((raw, j) => {
    let base = (raw.trim() || `col_${j}`) || `col_${j}`;
    let name = base;
    let n = 1;
    while (used.has(name)) {
      n += 1;
      name = `${base}_${n}`;
    }
    used.add(name);
    return name;
  });
}

/**
 * @param data XLSX sheet_to_json(..., SHEET_TO_JSON_HEADER1_DISPLAY 등) 결과
 * @param titleRowLines 1: 첫 행만 헤더, 2: 첫 두 행 합침, 3: 첫 세 행 합침
 */
export function parseExcelMatrix(data: unknown[][], titleRowLines: 1 | 2 | 3): ExcelMatrixParseResult {
  if (!data || data.length === 0) {
    throw new Error('데이터가 없습니다.');
  }
  if (titleRowLines === 2 && data.length < 2) {
    throw new Error('타이틀을 2행으로 선택했는데 시트에 헤더를 포함해 최소 2줄이 필요합니다.');
  }
  if (titleRowLines === 3 && data.length < 3) {
    throw new Error('타이틀을 3행으로 선택했는데 시트에 헤더를 포함해 최소 3줄이 필요합니다.');
  }

  const row0 = (data[0] ?? []) as unknown[];
  const row1 = titleRowLines >= 2 ? ((data[1] ?? []) as unknown[]) : [];
  const row2 = titleRowLines === 3 ? ((data[2] ?? []) as unknown[]) : [];
  const colCount = Math.max(
    row0.length,
    titleRowLines >= 2 ? row1.length : 0,
    titleRowLines === 3 ? row2.length : 0,
    1
  );

  let headerStrings: string[];
  if (titleRowLines === 1) {
    const carried = carryMergedHeaderRow(row0, colCount);
    headerStrings = uniquifyHeaderNames(carried.map((raw, j) => (raw.trim() || `col_${j}`) || `col_${j}`));
  } else if (titleRowLines === 2) {
    const c0 = carryMergedHeaderRow(row0, colCount);
    const c1 = carryMergedHeaderRow(row1, colCount);
    const combined = [];
    for (let j = 0; j < colCount; j++) {
      const a = (c0[j] ?? '').trim();
      const b = (c1[j] ?? '').trim();
      let base: string;
      if (a && b) {
        base = a === b ? a : `${a} ${b}`;
      } else {
        base = (a || b || `col_${j}`).trim() || `col_${j}`;
      }
      combined.push(base);
    }
    headerStrings = uniquifyHeaderNames(combined);
  } else {
    const c0 = carryMergedHeaderRow(row0, colCount);
    const c1 = carryMergedHeaderRow(row1, colCount);
    const c2 = carryMergedHeaderRow(row2, colCount);
    const combined = [];
    for (let j = 0; j < colCount; j++) {
      const a = (c0[j] ?? '').trim();
      const b = (c1[j] ?? '').trim();
      const c = (c2[j] ?? '').trim();
      const parts = [a, b, c].filter((p) => p.length > 0);
      let base: string;
      if (parts.length === 0) {
        base = `col_${j}`;
      } else if (parts.length === 1) {
        base = parts[0]!;
      } else {
        const uniq: string[] = [];
        for (const p of parts) {
          if (uniq.length === 0 || uniq[uniq.length - 1] !== p) uniq.push(p);
        }
        base = uniq.join(' ');
      }
      combined.push(base);
    }
    headerStrings = uniquifyHeaderNames(combined);
  }

  const headerKeys = headerStrings.map((h, j) => h || `col_${j}`);

  const rows: Record<string, unknown>[] = [];
  for (let i = titleRowLines; i < data.length; i++) {
    const row = data[i] as unknown[];
    const obj: Record<string, unknown> = {};
    headerStrings.forEach((h, j) => {
      const key = h || `col_${j}`;
      obj[key] = row[j] ?? '';
    });
    rows.push(obj);
  }

  trimTrailingEmptyRows(rows, headerKeys);
  if (rows.length === 0) {
    throw new Error('타이틀 아래에 유효한 데이터 행이 없습니다. 빈 행만 있거나 시트가 비어 있습니다.');
  }

  const samples: Record<string, unknown[]> = {};
  headerStrings.forEach((h, j) => {
    const key = h || `col_${j}`;
    samples[key] = rows.slice(0, 3).map((r) => r[key]);
  });

  return {
    headers: headerStrings,
    rows,
    samples,
    hasSingleTitleRow: titleRowLines === 1,
  };
}
