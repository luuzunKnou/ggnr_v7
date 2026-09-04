import * as XLSX from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { RadiationShelterListItem } from '@/service/radiationShelterService';
import type { PublicLayerAddressPrefixes } from '@/lib/publicLayerSgg';

const FONT_NAME = '맑은 고딕';
const TITLE_FONT_NAME = 'HY헤드라인M';
const BORDER_RGB = '000000';
const HEADER_FILL = 'F2F2F2';
/** 연번·시설명·주소·수용인원·비고 */
const COL_COUNT = 5;
const COL0 = 1; // B열부터 (A열 여백)
const ROW0 = 1; // 2행부터 (1행 여백)
const TITLE_ROW = ROW0;
const GAP_ROW = ROW0 + 1;
/** 4행(1-based): n개소, 수용인원 총 n명 */
const SUMMARY_ROW = ROW0 + 2;
/** 5행(1-based)부터 표 헤더 */
const HEADER_ROW = ROW0 + 3;
const DATA_START_ROW = HEADER_ROW + 1;

type CellStyle = NonNullable<XLSX.CellObject['s']>;
type BorderSide = { style: 'thin' | 'medium' | 'thick'; color: { rgb: string } };

function thinSide(style: 'thin' | 'medium' | 'thick' = 'thin'): BorderSide {
  return { style, color: { rgb: BORDER_RGB } };
}

function thinBorder(): CellStyle['border'] {
  const side = thinSide('thin');
  return { top: side, bottom: side, left: side, right: side };
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

function dashToEmpty(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t || t === '-') return '';
  return t;
}

type ExportRow = {
  ftnNm: string;
  addr: string;
  actcTnop: number | null;
  remark: string;
};

function toExportRows(items: RadiationShelterListItem[]): ExportRow[] {
  const rows: ExportRow[] = items.map((item) => ({
    ftnNm: dashToEmpty(item.ftnNm),
    // 화면 목록은 시도·시군구 접두를 숨기지만, 명단은 주소 전체
    addr: dashToEmpty(item.addr),
    actcTnop: item.actcTnop,
    remark: dashToEmpty(item.remark),
  }));
  rows.sort((a, b) => {
    const byAddr = a.addr.localeCompare(b.addr, 'ko');
    if (byAddr !== 0) return byAddr;
    return a.ftnNm.localeCompare(b.ftnNm, 'ko');
  });
  return rows;
}

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
  items: RadiationShelterListItem[],
  prefixes: PublicLayerAddressPrefixes
): XLSX.WorkSheet {
  const rows = toExportRows(items);
  const merges: XLSX.Range[] = [];
  const ws: XLSX.WorkSheet = {};

  const set = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };
  const col = (i: number) => COL0 + i;

  const placeCount = rows.length;
  const capacitySum = rows.reduce(
    (s, row) => s + (row.actcTnop != null && Number.isFinite(row.actcTnop) ? row.actcTnop : 0),
    0
  );
  const sgg = String(prefixes.sggName ?? '').trim();
  const title = sgg
    ? `${sgg} 방사선비상계획구역 구호소 현황`
    : '방사선비상계획구역 구호소 현황';
  const summary = `${placeCount}개소, 수용인원 총 ${capacitySum.toLocaleString('ko-KR')}명`;

  const headerFill = { patternType: 'solid' as const, fgColor: { rgb: HEADER_FILL } };
  const headerStyle: CellStyle = {
    font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: '000000' } },
    fill: headerFill,
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  };

  set(0, 0, styled('', { border: undefined }));
  for (let i = 0; i < COL_COUNT; i++) {
    set(0, col(i), styled('', { border: undefined }));
  }

  set(TITLE_ROW, 0, styled('', { border: undefined }));
  set(
    TITLE_ROW,
    col(0),
    styled(title, {
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

  set(SUMMARY_ROW, 0, styled('', { border: undefined }));
  set(
    SUMMARY_ROW,
    col(0),
    styled(summary, {
      font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: '000000' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: undefined,
    })
  );
  for (let i = 1; i < COL_COUNT; i++) {
    set(SUMMARY_ROW, col(i), styled('', { border: undefined }));
  }
  merges.push({
    s: { r: SUMMARY_ROW, c: col(0) },
    e: { r: SUMMARY_ROW, c: col(COL_COUNT - 1) },
  });

  const headers = ['연번', '시설명', '주소', '수용인원', '비고'];
  set(HEADER_ROW, 0, styled('', { border: undefined }));
  headers.forEach((v, i) => set(HEADER_ROW, col(i), styled(v, headerStyle)));

  let r = DATA_START_ROW;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const dataStyle: CellStyle = {
      border: thinBorder(),
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
    const leftStyle: CellStyle = {
      ...dataStyle,
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    };

    set(r, 0, styled('', { border: undefined }));
    set(r, col(0), styled(i + 1, dataStyle));
    set(r, col(1), styled(row.ftnNm, leftStyle));
    set(r, col(2), styled(row.addr, leftStyle));
    set(
      r,
      col(3),
      styled(
        row.actcTnop != null && Number.isFinite(row.actcTnop) ? row.actcTnop : '',
        dataStyle
      )
    );
    set(r, col(4), styled(row.remark, leftStyle));
    r += 1;
  }

  const tableR0 = HEADER_ROW;
  const tableR1 = Math.max(r - 1, HEADER_ROW);
  const tableC0 = col(0);
  const tableC1 = col(COL_COUNT - 1);
  applyThickOuterBorder(ws, tableR0, tableR1, tableC0, tableC1);

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 3 },
    { wch: 6 },
    { wch: 28 },
    { wch: 36 },
    { wch: 10 },
    { wch: 18 },
  ];
  ws['!rows'] = [
    { hpt: 12 },
    { hpt: 32 },
    { hpt: 12 },
    { hpt: 20 },
    { hpt: 22 },
  ];
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: tableR1, c: tableC1 },
  });
  return ws;
}

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
export function exportRadiationShelterExcel(
  items: RadiationShelterListItem[],
  prefixes: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' }
): void {
  const wb = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `방사선대피소_명단_${stamp}.xlsx`;
  XLSX.utils.book_append_sheet(wb, buildSheet(items, prefixes), '구호소현황');

  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  const topLeft = XLSX.utils.encode_cell({ r: DATA_START_ROW, c: COL0 });
  const frozen = injectFrozenHeaderRows(new Uint8Array(raw), DATA_START_ROW, topLeft);
  downloadXlsxBytes(frozen, filename);
}
