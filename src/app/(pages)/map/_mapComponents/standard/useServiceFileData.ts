'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** serviceList.config 의 ser_eng (예: dataQuery, riverBasicPlan, complaint) */
export type ServiceFileDataSerEng = string;

export type ServiceFileDataRow = { name: string; size: number; modified?: string };

export function isImageServiceFileName(name: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
}

export function isPdfServiceFileName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

export function serviceFileDataDownloadUrl(
  serEng: ServiceFileDataSerEng,
  layerSegment: string,
  keyValue: string | number,
  fileName: string
): string {
  const rel = `file_data/${layerSegment}/${keyValue}/${fileName}`;
  const qs = new URLSearchParams({
    serEng: serEng.trim(),
    path: rel,
  });
  return `/api/service-files/download?${qs.toString()}`;
}

/** 해당 폴더 전체를 ZIP으로 한 번에 다운로드 (파일명: 타임스탬프_표시명 첨부파일.zip) */
export function serviceFileDataZipDownloadUrl(
  serEng: ServiceFileDataSerEng,
  layerSegment: string,
  keyValue: string | number,
  options?: { layerDisplayName?: string }
): string {
  const qs = new URLSearchParams({
    serEng: serEng.trim(),
    layer: layerSegment.trim(),
    key: String(keyValue),
  });
  const name = options?.layerDisplayName?.trim();
  if (name) qs.set('label', name);
  return `/api/service-files/download-zip?${qs.toString()}`;
}

/** 동일 출처 인증 쿠키가 포함된 GET으로 파일 다운로드 트리거 */
export function triggerServiceFileDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 소프트 삭제(rename → *.tmp). 성공 시 true */
export async function requestServiceFileDataDelete(params: {
  serEng: ServiceFileDataSerEng;
  layerSegment: string;
  keyValue: string | number;
  fileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/service-files/delete', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serEng: params.serEng.trim(),
      layer: params.layerSegment.trim(),
      key: String(params.keyValue),
      fileName: params.fileName,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : '삭제에 실패했습니다.' };
  }
  return { ok: true };
}

/**
 * file_data/{layer}/{key}/ 목록 조회.
 * @param serEng - 호출 화면이 속한 서비스의 ser_eng (권한 검사에 사용)
 */
export function useServiceFileData(params: {
  serEng: ServiceFileDataSerEng;
  enabled: boolean;
  layerSegment: string | null;
  keyValue: string | number | null;
  /** 업로드 완료 등 목록 재조회용 */
  refreshNonce?: number;
}): { files: ServiceFileDataRow[]; loading: boolean; error: string | null } {
  const [files, setFiles] = useState<ServiceFileDataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ser = params.serEng.trim();
    if (
      !params.enabled ||
      !ser ||
      !params.layerSegment ||
      params.keyValue == null ||
      params.keyValue === ''
    ) {
      setFiles([]);
      setError(null);
      setLoading(false);
      return;
    }
    const layer = params.layerSegment.trim();
    const key = String(params.keyValue);
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      serEng: ser,
      layer,
      key,
    });
    fetch(`/api/service-files?${qs.toString()}`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(typeof j?.error === 'string' ? j.error : '목록을 불러오지 못했습니다');
        }
        return r.json() as Promise<{ files?: ServiceFileDataRow[] }>;
      })
      .then((data) => {
        if (!cancelled) setFiles(Array.isArray(data.files) ? data.files : []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다');
          setFiles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.enabled, params.serEng, params.layerSegment, params.keyValue, params.refreshNonce ?? 0]);

  return { files, loading, error };
}

export type ServiceFileChunkUploadState = {
  progress: number;
  status: 'idle' | 'uploading' | 'success' | 'error';
  error: string | null;
  currentChunk: number;
  totalChunks: number;
};

const chunkUploadInitial: ServiceFileChunkUploadState = {
  progress: 0,
  status: 'idle',
  error: null,
  currentChunk: 0,
  totalChunks: 0,
};

/**
 * file_data 청크 업로드 (init → /api/upload/chunk → complete).
 */
export function useServiceFileChunkedUpload(): {
  state: ServiceFileChunkUploadState;
  upload: (params: {
    file: File;
    serEng: ServiceFileDataSerEng;
    layerSegment: string;
    keyValue: string | number;
  }) => Promise<{ savedPath?: string; size?: number; error?: string } | void>;
  cancel: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<ServiceFileChunkUploadState>(chunkUploadInitial);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState(chunkUploadInitial);
  }, [cancel]);

  const upload = useCallback(
    async (params: {
      file: File;
      serEng: ServiceFileDataSerEng;
      layerSegment: string;
      keyValue: string | number;
    }) => {
      cancel();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      setState({
        progress: 0,
        status: 'uploading',
        error: null,
        currentChunk: 0,
        totalChunks: 0,
      });
      const ser = params.serEng.trim();
      const layer = params.layerSegment.trim();
      const key = String(params.keyValue);
      try {
        const initRes = await fetch('/api/service-files/upload/init', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serEng: ser,
            layer,
            key,
            fileName: params.file.name,
            totalSize: params.file.size,
          }),
          signal,
        });
        const initJson = (await initRes.json().catch(() => ({}))) as {
          error?: string;
          uploadId?: string;
          chunkSize?: number;
          expectedChunks?: number;
        };
        if (!initRes.ok) {
          throw new Error(typeof initJson.error === 'string' ? initJson.error : '업로드 시작 실패');
        }
        const uploadId = initJson.uploadId;
        const chunkSize = initJson.chunkSize ?? 512 * 1024;
        const expectedChunks = initJson.expectedChunks ?? 1;
        if (!uploadId) throw new Error('업로드 세션을 만들 수 없습니다.');

        const base = '/api/upload/chunk';
        for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
          if (signal.aborted) {
            const msg = '취소됨';
            setState((s) => ({ ...s, status: 'idle', error: msg }));
            return { error: msg };
          }
          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, params.file.size);
          const blob = params.file.slice(start, end);
          const url = `${base}?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
          const res = await fetch(url, { method: 'POST', body: blob, signal });
          if (!res.ok) {
            const errText = await res.text();
            let errMsg = `청크 ${chunkIndex} 실패`;
            try {
              const j = JSON.parse(errText) as { error?: string };
              if (j?.error) errMsg = j.error;
            } catch {
              if (errText) errMsg = errText.slice(0, 200);
            }
            throw new Error(errMsg);
          }
          setState((s) => ({
            ...s,
            progress: Math.round(((chunkIndex + 1) / expectedChunks) * 100),
            currentChunk: chunkIndex + 1,
            totalChunks: expectedChunks,
          }));
        }

        const completeRes = await fetch('/api/service-files/upload/complete', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId }),
          signal,
        });
        const completeJson = (await completeRes.json().catch(() => ({}))) as {
          error?: string;
          savedPath?: string;
          size?: number;
        };
        if (!completeRes.ok) {
          throw new Error(typeof completeJson.error === 'string' ? completeJson.error : '병합 실패');
        }
        setState((s) => ({
          ...s,
          progress: 100,
          status: 'success',
          error: null,
        }));
        return { savedPath: completeJson.savedPath, size: completeJson.size };
      } catch (err) {
        if (signal.aborted) {
          const msg = '취소됨';
          setState((s) => ({ ...s, status: 'idle', error: msg }));
          return { error: msg };
        }
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({
          ...s,
          status: 'error',
          error: message,
        }));
        return { error: message };
      } finally {
        abortRef.current = null;
      }
    },
    [cancel]
  );

  return { state, upload, cancel, reset };
}
