/**
 * 클라이언트 API 유틸리티
 */

const API_BASE_URL = '/api';

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
  const url = API_BASE_URL + api;

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
      api = `${api}?${params.toString()}`;
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
        return Promise.reject({
          status: response.status,
          message: response.status === 401 ? 'Unauthorized' : 'Forbidden',
        });
      }

      return response.text().then((text) => {
        let json: any;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          const err = {
            status: response.status,
            message: 'Response is not JSON',
            body: text?.slice(0, 300),
          };
          console.error('API call error:', err);
          return Promise.reject(err);
        }
        if (!response.ok) {
          if (response.status !== 401 && response.status !== 403) {
            const isEmptyObject =
              json != null &&
              typeof json === 'object' &&
              !Array.isArray(json) &&
              Object.keys(json as Record<string, unknown>).length === 0;
            const payload =
              json && typeof json === 'object'
                ? {
                    url,
                    method,
                    httpStatus: response.status,
                    httpStatusText: response.statusText,
                    ...(json as Record<string, unknown>),
                    ...(isEmptyObject ? { bodyTextSnippet: text?.slice(0, 300) } : {}),
                  }
                : { httpStatus: response.status, httpStatusText: response.statusText, body: json };
            // Next 개발 오버레이에서 객체가 {}처럼 보이는 경우가 있어 문자열도 함께 로깅
            console.error('API call error', payload);
            try {
              console.error('API call error (string)', JSON.stringify(payload));
            } catch {
              // ignore
            }
          }
          const rejectVal =
            json && typeof json === 'object'
              ? { ...(json as Record<string, unknown>), httpStatus: response.status }
              : { httpStatus: response.status, error: String(json) };
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
      const msg = error?.message ?? error?.error ?? (typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error));
      console.error('API call error:', msg);
      if (typeof error === 'object' && error !== null) {
        try {
          console.error('API call error (object)', error);
          console.error('API call error (json)', JSON.stringify(error));
        } catch {
          // ignore
        }
      } else {
        console.error('API call error (raw)', error);
      }
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
