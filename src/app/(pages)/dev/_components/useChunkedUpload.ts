'use client';

import { useState, useCallback, useRef } from 'react';
import { call } from '@/lib/api';

const API_BASE = typeof window !== 'undefined' ? '' : '';

export type ChunkedUploadState = {
  progress: number;
  status: 'idle' | 'uploading' | 'success' | 'error';
  error: string | null;
  currentChunk: number;
  totalChunks: number;
};

export type UseChunkedUploadReturn = {
  state: ChunkedUploadState;
  upload: (file: File, uploadType: 'tif' | 'las' | 'shp', options?: { shpSavePath?: string }) => Promise<{ savedPath?: string; size?: number } | void>;
  cancel: () => void;
  reset: () => void;
};

const initialState: ChunkedUploadState = {
  progress: 0,
  status: 'idle',
  error: null,
  currentChunk: 0,
  totalChunks: 0,
};

export function useChunkedUpload(): UseChunkedUploadReturn {
  const [state, setState] = useState<ChunkedUploadState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState(initialState);
  }, [cancel]);

  const upload = useCallback(
    async (file: File, uploadType: 'tif' | 'las' | 'shp', options?: { shpSavePath?: string }): Promise<{ savedPath?: string; size?: number } | void> => {
      const hasNonAscii = [...file.name].some((c) => (c.codePointAt(0) ?? 0) > 127);
      if (hasNonAscii) {
        setState((s) => ({ ...s, status: 'error', error: '한글 파일명은 사용할 수 없습니다.' }));
        return;
      }
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
      const fileName = uploadType === 'shp' && options?.shpSavePath ? options.shpSavePath : file.name;
      try {
        const initRes = await call('', 'POST', {
          service: 'uploadService',
          action: 'initChunkedUpload',
          params: {
            uploadType,
            fileName,
            totalSize: file.size,
          },
        });
        const data = initRes?.data ?? initRes;
        const uploadId = data?.uploadId;
        const chunkSize = data?.chunkSize ?? 512 * 1024;
        const expectedChunks = data?.expectedChunks ?? 1;
        if (!uploadId) {
          throw new Error('Init failed: no uploadId');
        }
        const base = `${API_BASE || ''}/api/upload/chunk`;
        for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
          if (signal.aborted) {
            setState((s) => ({ ...s, status: 'idle', error: '취소됨' }));
            return;
          }
          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const blob = file.slice(start, end);
          const url = `${base}?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
          const res = await fetch(url, {
            method: 'POST',
            body: blob,
            signal,
          });
          if (!res.ok) {
            const errText = await res.text();
            let errMsg = `Chunk ${chunkIndex} failed`;
            try {
              const j = JSON.parse(errText);
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
        const completeRes = await call('', 'POST', {
          service: 'uploadService',
          action: 'completeChunkedUpload',
          params: { uploadId },
        });
        const completeData = completeRes?.data ?? completeRes;
        setState((s) => ({
          ...s,
          progress: 100,
          status: 'success',
          error: null,
        }));
        return {
          savedPath: completeData?.savedPath,
          size: completeData?.size,
        };
      } catch (err) {
        if (signal.aborted) {
          setState((s) => ({ ...s, status: 'idle', error: '취소됨' }));
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({
          ...s,
          status: 'error',
          error: message,
        }));
      } finally {
        abortRef.current = null;
      }
    },
    [cancel]
  );

  return { state, upload, cancel, reset };
}
