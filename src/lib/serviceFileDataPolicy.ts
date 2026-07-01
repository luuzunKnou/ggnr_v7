/**
 * file_data API 호출 시 ser_eng 검증.
 * serviceList에 등록된 ser_eng + 향후 확장용 예약 코드만 허용합니다.
 */
import { getServiceList } from '@/service/configService';

/** 설정에 없어도 파일 API를 쓸 ser_eng (게시판 등 추후 모듈) */
const SERVICE_FILE_DATA_EXTRA_SER_ENG = new Set<string>(['board', 'notice']);

const SER_ENG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

function configuredSerEngSet(): Set<string> {
  const set = new Set<string>();
  for (const s of getServiceList().ser) {
    const e = String(s.ser_eng ?? '').trim();
    if (e) set.add(e);
  }
  return set;
}

/** 쿼리/바디의 serEng가 파일 API에 사용 가능한지 검사 후 정규화된 값 반환 */
export function parseSerEngForServiceFileData(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || !SER_ENG_PATTERN.test(t)) return null;
  if (SERVICE_FILE_DATA_EXTRA_SER_ENG.has(t)) return t;
  if (configuredSerEngSet().has(t)) return t;
  return null;
}
