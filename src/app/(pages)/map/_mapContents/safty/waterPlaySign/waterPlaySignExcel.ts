import * as XLSX from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';
import type { PublicLayerAddressPrefixes } from '@/lib/publicLayerSgg';
import { formatWaterPlaySignAddressDisplay } from './waterPlaySignAddressDisplay';

const FONT_NAME = '맑은 고딕';
const TITLE_FONT_NAME = 'HY헤드라인M';
const BORDER_RGB = '000000';
const HEADER_FILL = 'F2F2F2';
/** 데이터 열 개수 (연번~비고) — A열·1행 비우고 B2부터 */
const COL_COUNT = 10;
const COL0 = 1; // B=1 (A열 여백)
const ROW0 = 1; // 2행부터 (1행 여백)
const TITLE_ROW = ROW0; // 제목
const GAP_ROW = ROW0 + 1; // 제목 아래 빈 행
const HEADER_TOP_ROW = ROW0 + 2; // 헤더 시작
const HEADER_SUM_ROW = ROW0 + 5; // 합계 행
/** 헤더 다음(데이터 시작, 0-based) — 이 행 위까지 틀고정 */
const DATA_START_ROW = ROW0 + 6;

type CellStyle = NonNullable<XLSX.CellObject['s']>;
type BorderSide = { style: 'thin' | 'medium' | 'thick'; color: { rgb: string } };

function thinSide(style: 'thin' | 'medium' | 'thick' = 'thin'): BorderSide {
  return { style, color: { rgb: BORDER_RGB } };
}

function thinBorder(): CellStyle['border'] {
  const side = thinSide('thin');
  return { top: side, bottom: side, left: side, right: side };
}

function borderWithBottom(
  bottom: 'thin' | 'medium' | 'thick'
): CellStyle['border'] {
  return {
    top: thinSide('thin'),
    bottom: thinSide(bottom),
    left: thinSide('thin'),
    right: thinSide('thin'),
  };
}

function baseStyle(extra?: CellStyle): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 10, color: { rgb: '000000' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
    ...extra,
  };
}

function styled(v: string | number, style?: CellStyle): XLSX.CellObject {
  return { v, t: typeof v === 'number' ? 'n' : 's', s: baseStyle(style) };
}

/** 수량은 숫자 유지 + 엑셀 쉼표 스타일(#,##0) */
const QTY_NUM_FMT = '#,##0';

function styledQty(v: number, style?: CellStyle): XLSX.CellObject {
  return {
    v,
    t: 'n',
    z: QTY_NUM_FMT,
    s: baseStyle({ ...style, numFmt: QTY_NUM_FMT }),
  };
}

function dashToEmpty(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t || t === '-') return '';
  return t;
}

/** 시도 축약 — 1글자+3글자 (예: 충청북도→충북) */
function abbreviateSido(sido: string): string {
  const t = dashToEmpty(sido);
  if (t.length >= 3) return `${t[0]}${t[2]}`;
  return t;
}

/** 관리지역 위험구역 여부 — '여'만 표시, '부'·빈값은 공백 */
function isWarnigForExcel(v: unknown): string {
  const t = dashToEmpty(v);
  if (!t || t === '부') return '';
  return t;
}

function stripLeadingToken(text: string, token: string): string {
  const t = token.trim();
  if (!t || !text.startsWith(t)) return text;
  return text.slice(t.length).replace(/^\s+/, '').trim();
}

/**
 * 리스트와 동일: 시도·시군구 접두 제거 후 나머지(읍·면·동부터).
 * 목록 접두 + 행 sido/sgg를 반영하고, 안 되면 앞 2토큰 제거.
 */
export function toLocalAddrForExcel(
  item: WaterPlaySignListItem,
  prefixes: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' }
): string {
  let t = formatWaterPlaySignAddressDisplay(item.addr, prefixes);
  if (t === '—') t = '';

  const sido = dashToEmpty(item.sido);
  const sgg = dashToEmpty(item.sgg);
  if (sido) t = stripLeadingToken(t, sido);
  if (sgg) t = stripLeadingToken(t, sgg);
  if (t) return t;

  const raw = dashToEmpty(item.addr);
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length > 2 ? parts.slice(2).join(' ') : raw;
}

/** 읍·면·동 그룹키 — 로컬 주소의 첫 토큰 */
export function eupMyeonDongGroupKey(localAddr: string): string {
  const parts = String(localAddr ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? '';
}

type ExportRow = {
  localAddr: string;
  groupKey: string;
  sido: string;
  sgg: string;
  addrDetail: string;
  gubun: string;
  isWarnig: string;
  safeboxCnt: number | null;
  signCnt: number | null;
  remark: string;
};

function toExportRows(
  items: WaterPlaySignListItem[],
  prefixes: PublicLayerAddressPrefixes
): ExportRow[] {
  const rows: ExportRow[] = items.map((item) => {
    const localAddr = toLocalAddrForExcel(item, prefixes);
    return {
      localAddr,
      groupKey: eupMyeonDongGroupKey(localAddr),
      sido: abbreviateSido(item.sido),
      sgg: dashToEmpty(item.sgg),
      addrDetail: dashToEmpty(item.addrDetail),
      gubun: dashToEmpty(item.gubun),
      isWarnig: isWarnigForExcel(item.isWarnig),
      safeboxCnt: item.safeboxCnt,
      signCnt: item.signCnt,
      remark: dashToEmpty(item.remark),
    };
  });
  rows.sort((a, b) => a.localAddr.localeCompare(b.localAddr, 'ko'));
  return rows;
}

/** 표 외곽(헤더~마지막 데이터)을 굵은 테두리로 */
function applyThickOuterBorder(
  ws: XLSX.WorkSheet,
  r0: number,
  r1: number,
  c0: number,
  c1: number
): void {
  const thick = thinSide('thick');
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const prev = (cell.s?.border ?? {}) as NonNullable<CellStyle['border']>;
      const next: NonNullable<CellStyle['border']> = { ...prev };
      if (r === r0) next.top = thick;
      if (r === r1) next.bottom = thick;
      if (c === c0) next.left = thick;
      if (c === c1) next.right = thick;
      cell.s = { ...(cell.s ?? {}), border: next };
    }
  }
}

function buildSheet(
  items: WaterPlaySignListItem[],
  prefixes: PublicLayerAddressPrefixes
): XLSX.WorkSheet {
  const rows = toExportRows(items, prefixes);
  const merges: XLSX.Range[] = [];
  const ws: XLSX.WorkSheet = {};

  const set = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };
  /** 본문 열(0~9) → 실제 시트 열(B~) */
  const col = (i: number) => COL0 + i;

  const headerFill = { patternType: 'solid' as const, fgColor: { rgb: HEADER_FILL } };
  const headerStyle: CellStyle = {
    font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '000000' } },
    fill: headerFill,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  };

  // 1행·A열 여백 → 제목은 B2, 표는 그 아래
  set(0, 0, styled('', { border: undefined }));
  for (let i = 0; i < COL_COUNT; i++) {
    set(0, col(i), styled('', { border: undefined }));
  }

  set(TITLE_ROW, 0, styled('', { border: undefined }));
  set(
    TITLE_ROW,
    col(0),
    styled('인명구조함 및 표지판 설치 현황', {
      font: { name: TITLE_FONT_NAME, sz: 20, color: { rgb: '000000' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: undefined,
    })
  );
  for (let i = 1; i < COL_COUNT; i++) {
    set(TITLE_ROW, col(i), styled('', { border: undefined }));
  }
  merges.push({
    s: { r: TITLE_ROW, c: col(0) },
    e: { r: TITLE_ROW, c: col(COL_COUNT - 1) },
  });

  set(GAP_ROW, 0, styled('', { border: undefined }));
  for (let i = 0; i < COL_COUNT; i++) {
    set(GAP_ROW, col(i), styled('', { border: undefined }));
  }

  const hTop = [
    '연번',
    '시·도',
    '시·군·구',
    '설치 장소',
    '',
    '',
    '',
    '구조함\n수량',
    '표지판 수량',
    '비고',
  ];
  hTop.forEach((v, i) => set(HEADER_TOP_ROW, col(i), styled(v, headerStyle)));

  const hSub = [
    '',
    '',
    '',
    '주소',
    '상세위치 설명',
    '장소\n구분',
    '관리지역\n위험구역\n여부',
    '',
    '',
    '',
  ];
  hSub.forEach((v, i) => set(HEADER_TOP_ROW + 1, col(i), styled(v, headerStyle)));

  for (let i = 0; i < COL_COUNT; i++) {
    set(HEADER_TOP_ROW + 2, col(i), styled('', headerStyle));
  }

  const safeboxSum = rows.reduce(
    (s, row) => s + (row.safeboxCnt != null && Number.isFinite(row.safeboxCnt) ? row.safeboxCnt : 0),
    0
  );
  const signSum = rows.reduce(
    (s, row) => s + (row.signCnt != null && Number.isFinite(row.signCnt) ? row.signCnt : 0),
    0
  );

  const headerRightStyle: CellStyle = {
    ...headerStyle,
    alignment: { horizontal: 'right', vertical: 'center', wrapText: true },
  };

  for (let i = 0; i < COL_COUNT; i++) {
    if (i === 7) set(HEADER_SUM_ROW, col(i), styledQty(safeboxSum, headerRightStyle));
    else if (i === 8) set(HEADER_SUM_ROW, col(i), styledQty(signSum, headerRightStyle));
    else set(HEADER_SUM_ROW, col(i), styled('', headerStyle));
  }

  for (let rr = HEADER_TOP_ROW; rr <= HEADER_SUM_ROW; rr++) {
    set(rr, 0, styled('', { border: undefined }));
  }

  merges.push(
    { s: { r: HEADER_TOP_ROW, c: col(0) }, e: { r: HEADER_SUM_ROW, c: col(0) } },
    { s: { r: HEADER_TOP_ROW, c: col(1) }, e: { r: HEADER_SUM_ROW, c: col(1) } },
    { s: { r: HEADER_TOP_ROW, c: col(2) }, e: { r: HEADER_SUM_ROW, c: col(2) } },
    { s: { r: HEADER_TOP_ROW, c: col(3) }, e: { r: HEADER_TOP_ROW, c: col(6) } },
    { s: { r: HEADER_TOP_ROW + 1, c: col(3) }, e: { r: HEADER_SUM_ROW, c: col(3) } },
    { s: { r: HEADER_TOP_ROW + 1, c: col(4) }, e: { r: HEADER_SUM_ROW, c: col(4) } },
    { s: { r: HEADER_TOP_ROW + 1, c: col(5) }, e: { r: HEADER_SUM_ROW, c: col(5) } },
    { s: { r: HEADER_TOP_ROW + 1, c: col(6) }, e: { r: HEADER_SUM_ROW, c: col(6) } },
    { s: { r: HEADER_TOP_ROW, c: col(7) }, e: { r: HEADER_TOP_ROW + 2, c: col(7) } },
    { s: { r: HEADER_TOP_ROW, c: col(8) }, e: { r: HEADER_TOP_ROW + 2, c: col(8) } },
    { s: { r: HEADER_TOP_ROW, c: col(9) }, e: { r: HEADER_SUM_ROW, c: col(9) } }
  );

  // 데이터 — 읍·면·동 그룹 끝 행에 굵은 하단선
  let r = DATA_START_ROW;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const next = rows[i + 1];
    const isGroupEnd = !next || next.groupKey !== row.groupKey;
    const cellBorder = borderWithBottom(isGroupEnd ? 'medium' : 'thin');
    const dataStyle: CellStyle = {
      border: cellBorder,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
    const addrStyle: CellStyle = {
      ...dataStyle,
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    };
    const qtyStyle: CellStyle = {
      ...dataStyle,
      alignment: { horizontal: 'right', vertical: 'center', wrapText: true },
    };

    set(r, 0, styled('', { border: undefined }));
    set(r, col(0), styled(i + 1, dataStyle));
    set(r, col(1), styled(row.sido, dataStyle));
    set(r, col(2), styled(row.sgg, dataStyle));
    set(r, col(3), styled(row.localAddr, addrStyle));
    set(r, col(4), styled(row.addrDetail, addrStyle));
    set(r, col(5), styled(row.gubun, dataStyle));
    set(r, col(6), styled(row.isWarnig, dataStyle));
    set(
      r,
      col(7),
      row.safeboxCnt != null && Number.isFinite(row.safeboxCnt)
        ? styledQty(row.safeboxCnt, qtyStyle)
        : styled('', qtyStyle)
    );
    set(
      r,
      col(8),
      row.signCnt != null && Number.isFinite(row.signCnt)
        ? styledQty(row.signCnt, qtyStyle)
        : styled('', qtyStyle)
    );
    set(r, col(9), styled(row.remark, dataStyle));
    r += 1;
  }

  const tableR0 = HEADER_TOP_ROW;
  const tableR1 = Math.max(r - 1, HEADER_SUM_ROW);
  const tableC0 = col(0);
  const tableC1 = col(COL_COUNT - 1);
  applyThickOuterBorder(ws, tableR0, tableR1, tableC0, tableC1);

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 3 }, // A 여백
    { wch: 6 },
    { wch: 8 },
    { wch: 10 },
    { wch: 37 }, // 주소 (≈254px)
    { wch: 32 }, // 상세위치 (≈228px)
    { wch: 8 },
    { wch: 10 },
    { wch: 8 }, // 구조함 수량
    { wch: 8 }, // 표지판 수량 — 구조함과 동일
    { wch: 14 },
  ];
  ws['!rows'] = [
    { hpt: 12 }, // 1행 여백
    { hpt: 32 }, // 제목
    { hpt: 12 },
    { hpt: 20 },
    { hpt: 18 },
    { hpt: 12 },
    { hpt: 18 },
  ];
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: tableR1, c: tableC1 },
  });
  return ws;
}

/** SheetJS는 freeze를 쓰지 않으므로 xlsx zip의 sheetViews에 pane 주입 */
function injectFrozenHeaderRows(xlsxBytes: Uint8Array, ySplit: number, topLeftCell: string): Uint8Array {
  const files = unzipSync(xlsxBytes);
  const paneXml =
    `<sheetViews>` +
    `<sheetView workbookViewId="0">` +
    `<pane ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>` +
    `</sheetView>` +
    `</sheetViews>`;

  for (const name of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) continue;
    const raw = files[name];
    if (!raw) continue;
    let xml = strFromU8(raw);
    if (/<sheetViews[\s\S]*?<\/sheetViews>/.test(xml)) {
      xml = xml.replace(/<sheetViews[\s\S]*?<\/sheetViews>/, paneXml);
    } else if (/<sheetView\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/<sheetViews[^>]*>\s*<sheetView\b[^>]*\/>\s*<\/sheetViews>/, paneXml);
    } else {
      xml = xml.replace(/(<dimension\b[^>]*\/>)/, `$1${paneXml}`);
    }
    files[name] = strToU8(xml);
  }
  return zipSync(files, { level: 6 });
}

function downloadXlsxBytes(data: Uint8Array, filename: string): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 전체 목록을 참고 서식으로 엑셀 저장 (화면 필터와 무관) */
export function exportWaterPlaySignExcel(
  items: WaterPlaySignListItem[],
  prefixes: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' }
): void {
  const wb = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `물놀이표지판_명단_${stamp}.xlsx`;
  XLSX.utils.book_append_sheet(wb, buildSheet(items, prefixes), '설치현황');

  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  const topLeft = XLSX.utils.encode_cell({ r: DATA_START_ROW, c: COL0 });
  const frozen = injectFrozenHeaderRows(new Uint8Array(raw), DATA_START_ROW, topLeft);
  downloadXlsxBytes(frozen, filename);
}
