/** Excel 마법사 `.log`(uiLines)용 요약·실패 줄 포맷 */

export function formatProcessDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}분 ${rem}초`;
}

export function buildExcelWizardMetaLines(p: {
  operatorLabel: string;
  startedAtLabel: string;
  tableEng: string;
  tableKor: string;
  writeMode: string;
  keyFieldLabel: string;
  geometryType: string;
  parcelAddressMode: string;
  objectAddressMode?: string;
  sourcePath?: string | null;
}): string[] {
  const lines = [
    '======== 처리 요약(시작) ========',
    `실행자: ${p.operatorLabel}`,
    `시작: ${p.startedAtLabel}`,
    `테이블: ${p.tableEng} (${p.tableKor || '-'})`,
    `모드: ${p.writeMode}`,
    `키필드: ${p.keyFieldLabel || '(없음)'}`,
    `도형타입: ${p.geometryType}`,
    `필지주소: ${p.parcelAddressMode}`,
  ];
  if (p.objectAddressMode) lines.push(`물건지주소: ${p.objectAddressMode}`);
  if (p.sourcePath?.trim()) lines.push(`파일: ${p.sourcePath.trim()}`);
  lines.push('========', '');
  return lines;
}

export function buildExcelWizardClosingLines(p: {
  endedAtLabel: string;
  durationLabel: string;
  extractCount: number;
  coordOk: number;
  coordFail: number;
  pnuAttempt: number;
  pnuOk: number;
  jijukOk: number;
  jijukNull: number;
  insertCount: number;
  defineResult: string;
  geoserverResult: string;
  fieldMapResult?: string;
}): string[] {
  const lines = [
    '',
    '======== 단계별 건수 ========',
    `주소 추출: ${p.extractCount}건`,
    `좌표 획득: 성공 ${p.coordOk} / 실패 ${p.coordFail}`,
    `PNU 폴백: 시도 ${p.pnuAttempt} / 성공 ${p.pnuOk}`,
    `지적 매칭: 성공 ${p.jijukOk} / 미매칭 ${p.jijukNull}`,
    `DB 삽입: ${p.insertCount}행`,
    '',
    '======== 후처리 ========',
    `레이어 정의: ${p.defineResult}`,
    `GeoServer: ${p.geoserverResult}`,
  ];
  if (p.fieldMapResult) lines.push(`필드명 맵: ${p.fieldMapResult}`);
  lines.push(`종료: ${p.endedAtLabel}`, `소요: ${p.durationLabel}`, '========');
  return lines;
}

export function formatGeocodeFailLine(f: {
  row: number;
  key: string;
  rawCell: string;
  address: string;
  reason: string;
}): string {
  const keyPart = f.key.trim() ? `키=${f.key.trim()}` : '키=(없음)';
  const raw = f.rawCell.trim() ? f.rawCell.trim().slice(0, 120) : '(없음)';
  return `  · 행 ${f.row} | ${keyPart} | 원본=${raw} | 주소=${f.address}: ${f.reason}`;
}
