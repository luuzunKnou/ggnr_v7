import { notifyAuthRequired } from '@/lib/authRequiredEvent';
import { withBasePath } from '@/lib/basePath';

/** 호출 시점에 basePath 반영 (모듈 로드 시점 고정 방지). trailingSlash 대비 /api/ */
function apiBaseUrl(): string {
  return withBasePath('/api');
}

/**
 * 인증 토큰 가져오기 (나중에 구현)
 */
function getAuthToken(): string {
  // TODO: localStorage 또는 cookie에서 토큰 가져오기
  if (typeof window !== 'undefined') {
    // 예시: localStorage.getItem('authToken')
    return '';
  }
  return '';
}

/**
 * 세션 클리어 (나중에 구현)
 */
function clearSession(): void {
  // TODO: 세션 클리어 로직
  if (typeof window !== 'undefined') {
    // localStorage.clear();
    // window.location.href = '/login';
  }
}

/** Next 오버레이가 객체를 {}로 보여 한 줄 문자열만 남긴다. */
function logApiCallError(info: Record<string, unknown>): void {
  try {
    console.error('API call error', JSON.stringify(info));
  } catch {
    console.error('API call error', String(info?.message ?? info?.error ?? 'unknown'));
  }
}

function requestMeta(request?: any): { service?: string; action?: string } {
  if (!request || typeof request !== 'object') return {};
  const service = request.service != null ? String(request.service) : undefined;
  const action = request.action != null ? String(request.action) : undefined;
  return {
    ...(service ? { service } : {}),
    ...(action ? { action } : {}),
  };
}

/**
 * 기본 API 호출 함수
 */
export function call(
  api: string,
  method: 'GET' | 'POST',
  request?: any,
  requestOptions?: { signal?: AbortSignal }
): Promise<any> {
  const authToken = getAuthToken();
  const meta = requestMeta(request);
  let url = apiBaseUrl() + api;

  const fetchOptions: RequestInit = {
    method,
    cache: 'no-store',
    credentials: 'include',
    signal: requestOptions?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { Authorization: `Bearer ${authToken}` }),
    },
  };

  if (request) {
    if (method === 'GET') {
      // GET 요청은 URL 파라미터로 전달
      const params = new URLSearchParams();
      if (typeof request === 'object') {
        Object.keys(request).forEach((key) => {
          if (request[key] !== undefined && request[key] !== null) {
            params.append(key, typeof request[key] === 'object' ? JSON.stringify(request[key]) : String(request[key]));
          }
        });
      }
      url = `${apiBaseUrl()}${api}?${params.toString()}`;
    } else {
      // POST 요청은 body로 전달
      if (typeof request === 'object') {
        fetchOptions.body = JSON.stringify(request);
      } else {
        fetchOptions.body = request;
      }
    }
  }

  return fetch(url, fetchOptions)
    .then((response) => {
      if (response.status === 401 || response.status === 403) {
        clearSession();
        if (response.status === 401) notifyAuthRequired();
        const err = new Error(
          response.status === 401 ? '로그인이 필요합니다.' : '권한이 없습니다.'
        ) as Error & { status: number };
        err.status = response.status;
        return Promise.reject(err);
      }

      return response.text().then((text) => {
        let json: any;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          const err = {
            ...meta,
            url,
            method,
            httpStatus: response.status,
            message: 'Response is not JSON',
            bodyTextSnippet: text?.slice(0, 300),
            __apiLogged: true,
          };
          logApiCallError(err);
          return Promise.reject(err);
        }
        if (!response.ok) {
          const isEmptyObject =
            json != null &&
            typeof json === 'object' &&
            !Array.isArray(json) &&
            Object.keys(json as Record<string, unknown>).length === 0;
          const payload =
            json && typeof json === 'object'
              ? {
                  ...meta,
                  url,
                  method,
                  httpStatus: response.status,
                  httpStatusText: response.statusText,
                  ...(json as Record<string, unknown>),
                  ...(isEmptyObject ? { bodyTextSnippet: text?.slice(0, 300) } : {}),
                  __apiLogged: true,
                }
              : {
                  ...meta,
                  url,
                  method,
                  httpStatus: response.status,
                  httpStatusText: response.statusText,
                  body: json,
                  __apiLogged: true,
                };
          logApiCallError(payload);
          const rejectVal =
            json && typeof json === 'object'
              ? { ...(json as Record<string, unknown>), httpStatus: response.status, __apiLogged: true }
              : { httpStatus: response.status, error: String(json), __apiLogged: true };
          return Promise.reject(rejectVal);
        }
        return json;
      });
    })
    .catch((error) => {
      if (error?.name === 'AbortError') {
        return Promise.reject(error);
      }
      if (error?.status === 401 || error?.status === 403) {
        return Promise.reject(error);
      }
      // then 절에서 이미 남긴 HTTP/파싱 오류는 재로깅하지 않음 (Next Issues 중복 방지)
      if (error && typeof error === 'object' && (error as { __apiLogged?: boolean }).__apiLogged) {
        return Promise.reject(error);
      }
      const msg =
        error?.message ??
        error?.error ??
        (typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error));
      logApiCallError({ ...meta, url, method, message: msg });
      return Promise.reject(error);
    });
}

/**
 * 데이터 추가
 */
export function callInsert(
  api: string,
  param: any,
  successFunction?: (response: any) => void,
  handleOpen?: () => void,
  errorFunction?: (error: any) => void
): void {
  call(api, 'POST', param)
    .then((response) => {
      if (response.message === 'OK' || response.success) {
        if (typeof successFunction === 'function') successFunction(response);
        if (typeof handleOpen === 'function') handleOpen();
      }
    })
    .catch((response) => {
      if (typeof errorFunction === 'function') errorFunction(response);
      console.error('Insert error:', response);
    });
}

/**
 * 데이터 수정
 */
export function callUpdate(
  api: string,
  param: any,
  successFunction?: (response: any) => void,
  handleOpen?: () => void,
  errorFunction?: (error: any) => void
): void {
  call(api, 'POST', param)
    .then((response) => {
      if (response.message === 'OK' || response.success) {
        if (typeof successFunction === 'function') successFunction(response);
        if (typeof handleOpen === 'function') handleOpen();
      }
    })
    .catch((response) => {
      if (typeof errorFunction === 'function') errorFunction(response);
      console.error('Update error:', response);
    });
}

/**
 * 데이터 삭제
 */
export function callDelete(
  api: string,
  param: any,
  successFunction?: () => void,
  handleOpen?: () => void,
  errorFunction?: () => void,
  confirmRequired: boolean = true
): void {
  if (!confirmRequired || window.confirm('정말로 삭제하시겠습니까?')) {
    call(api, 'POST', param)
      .then((response) => {
        if (response.message === 'OK' || response.success) {
          if (typeof successFunction === 'function') successFunction();
          if (typeof handleOpen === 'function') handleOpen();
        }
      })
      .catch((response) => {
        if (typeof errorFunction === 'function') errorFunction();
        console.error('Delete error:', response);
      });
  }
}

/**
 * 동기식 API 호출 (나중에 필요시 구현)
 */
export function asyncCall(api: string, method: 'GET' | 'POST', request?: any): any {
  // TODO: 동기식 호출 구현 (jQuery 대신 다른 방법 사용)
  console.warn('asyncCall is not implemented yet');
  return null;
}
