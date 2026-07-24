/** 한강홍수통제소(HRFCO) 에러코드 분류 */

export type HrfcoErrorClass = 'provider' | 'ours';

export const HRFCO_UI_MESSAGE = {
  provider: '현재 제공처 상태가 원활하지 않습니다.',
  ours: '연계 실패',
} as const;

const HRFCO_CODE_DESC: Record<number, string> = {
  900: '인증키가 유효하지 않습니다.',
  910: 'Time Type 파라미터 입력 형식이 잘못 되었습니다.',
  920: '잘못된 관측소 코드입니다.',
  930: '잘못된 날짜 형식입니다.',
  940: 'API 인증에 실패 하였습니다.',
  941: '미 승인 인증키 입니다.',
  942: '차단된 인증키 입니다.',
  943: '휴면 인증키 입니다.',
  944: '삭제된 인증키 입니다.',
  990: '검색된 자료가 없습니다.',
  400: '서버가 요청의 구문을 인식하지 못했습니다.',
  401: '이 요청은 인증이 필요합니다.',
  403: '서버에서 요청을 거부하고 있습니다.',
  404: '요청하신 주소를 서버에서 찾을 수 없습니다.',
  500: '서버 오류입니다.',
  501: '서버 오류입니다.',
  502: '서버 오류입니다.',
  503: '서버 오류입니다.',
};

const PROVIDER_CODES = new Set([500, 501, 502, 503]);

export function describeHrfcoCode(code: number): string {
  return HRFCO_CODE_DESC[code] ?? `알 수 없는 오류(${code})`;
}

export function classifyHrfcoCode(code: number): HrfcoErrorClass {
  return PROVIDER_CODES.has(code) ? 'provider' : 'ours';
}

/** 응답 JSON/문자열에서 HRFCO 스타일 코드 추출 */
export function extractHrfcoCode(raw: unknown, httpStatus?: number): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && HRFCO_CODE_DESC[n] != null) return n;
    const m = /["']?(?:result|code|errorCode|errcode)["']?\s*[:=]\s*["']?(\d{3})/i.exec(raw);
    if (m) return Number(m[1]);
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['result', 'code', 'errorCode', 'errcode', 'RESULT', 'CODE']) {
      if (o[key] != null) {
        const n = Number(o[key]);
        if (Number.isFinite(n)) return n;
      }
    }
    if (o.content != null && typeof o.content === 'object' && !Array.isArray(o.content)) {
      return extractHrfcoCode(o.content, httpStatus);
    }
  }
  if (httpStatus != null && HRFCO_CODE_DESC[httpStatus] != null) return httpStatus;
  return null;
}

export type FloodApiErrorBody = {
  error: string;
  errorClass: HrfcoErrorClass;
  code?: number;
  uiMessage: string;
};

export function buildFloodErrorBody(
  code: number | null,
  fallbackClass: HrfcoErrorClass,
  detail?: string
): FloodApiErrorBody {
  if (code != null) {
    const errorClass = classifyHrfcoCode(code);
    const desc = describeHrfcoCode(code);
    return {
      error: detail ? `${desc} (${detail})` : desc,
      errorClass,
      code,
      uiMessage: HRFCO_UI_MESSAGE[errorClass],
    };
  }
  return {
    error: detail ?? HRFCO_UI_MESSAGE[fallbackClass],
    errorClass: fallbackClass,
    uiMessage: HRFCO_UI_MESSAGE[fallbackClass],
  };
}

export function logFloodError(
  path: string,
  body: FloodApiErrorBody,
  url?: string
): void {
  const urlPart = url ? ` url=${url}` : '';
  const line = `[flood] ${body.errorClass === 'provider' ? 'provider unavailable' : 'client/config error'} path=${path}${urlPart} code=${body.code ?? '-'} ${body.error}`;
  if (body.errorClass === 'provider') {
    console.warn(line);
  } else {
    console.error(line);
  }
}
