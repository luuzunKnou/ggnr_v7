/** 필지분석 DB·API 오류를 화면용 한국어로 변환 (PG 원문·깨진 문자 노출 방지) */
export function toParcelAnalyzeUserError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? '');
  const trimmed = text.trim();
  if (!trimmed) return '분석 결과를 가져오지 못했습니다.';

  if (/statement timeout|canceling statement/i.test(trimmed)) {
    return '분석 영역이 넓어 조회 시간이 초과되었습니다. 영역을 줄여 다시 시도하세요.';
  }
  if (/permission denied|superuser|42501|must be owner/i.test(trimmed)) {
    return '필지 분석 DB 권한이 없습니다. 지적·토지속성 테이블 조회 권한을 확인하세요.';
  }
  if (/relation .* does not exist|42P01/i.test(trimmed)) {
    return '필지 분석에 필요한 DB 테이블이 없습니다. 지적 레이어·스키마 설정을 확인하세요.';
  }
  if (/connect|ECONNREFUSED|password authentication|28P01/i.test(trimmed)) {
    return 'DB에 연결할 수 없습니다. 연결 설정을 확인하세요.';
  }

  const printable = trimmed.replace(/[^\t\n\r\x20-\x7E\uAC00-\uD7A3]/g, '').trim();
  if (!printable || printable.length > 120 || printable !== trimmed) {
    return '필지 분석 조회 중 오류가 발생했습니다. DB·GeoServer 설정을 확인하세요.';
  }

  return printable;
}
