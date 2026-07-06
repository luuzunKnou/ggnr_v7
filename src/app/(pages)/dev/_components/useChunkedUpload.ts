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

/** 다중 파일 업로드 시 현재 파일 청크 진행률을 반영한 전체 % (fileIndex: 0-based) */
export function folderUploadOverallPercent(fileIndex: number, fileTotal: number, chunkPercent: number): number {
  if (fileTotal <= 0) return 0;
  return Math.min(100, Math.round(((fileIndex + chunkPercent / 100) / fileTotal) * 100));
}

export type UseChunkedUploadReturn = {
  state: ChunkedUploadState;
  upload: (
    file: File,
    uploadType: 'tif' | 'las' | 'shp' | 'excel' | 'fileData' | 'satelliteTif' | 'source' | 'fileManager',
    options?: {
      shpSavePath?: string;
      fileDataSavePath?: string;
      satelliteTifSavePath?: string;
      sourceSavePath?: string;
      fileManagerSavePath?: string;
    }
  ) => Promise<{ savedPath?: string; size?: number; error?: string } | void>;
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
    async (
      file: File,
      uploadType: 'tif' | 'las' | 'shp' | 'excel' | 'fileData' | 'satelliteTif' | 'source' | 'fileManager',
      options?: {
        shpSavePath?: string;
        fileDataSavePath?: string;
        satelliteTifSavePath?: string;
        sourceSavePath?: string;
        fileManagerSavePath?: string;
      }
    ): Promise<{ savedPath?: string; size?: number; error?: string } | void> => {
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
      const fileName =
        uploadType === 'shp' && options?.shpSavePath
          ? options.shpSavePath
          : uploadType === 'fileData' && options?.fileDataSavePath
            ? options.fileDataSavePath
            : uploadType === 'satelliteTif' && options?.satelliteTifSavePath
              ? options.satelliteTifSavePath.replace(/\\/g, '/')
              : uploadType === 'source' && options?.sourceSavePath
                ? options.sourceSavePath.replace(/\\/g, '/')
              : uploadType === 'fileManager' && options?.fileManagerSavePath
                ? options.fileManagerSavePath.replace(/\\/g, '/')
              : file.name;
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
            const msg = '취소됨';
            setState((s) => ({ ...s, status: 'idle', error: msg }));
            return { error: msg };
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
