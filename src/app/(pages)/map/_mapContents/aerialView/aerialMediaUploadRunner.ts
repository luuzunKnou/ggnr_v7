/**
 * 사진·동영상 청크 업로드 — 컴포넌트 마운트와 무관하게 백그라운드 유지.
 * 진행률은 aerialUploadProgressStore, 완료는 subscribe 로 전달.
 */

import { call } from '@/lib/api';
import type { AerialKind } from './aerialMediaTypes';
import {
  beginClientUploadJob,
  completeClientUploadJob,
  failClientUploadJob,
  updateClientUploadJob,
} from './aerialUploadProgressStore';

export type AerialMediaUploadItem = {
  wuKey: number;
  fileName: string;
  locationLabel: string | null;
  sizeLabel: string;
  format: string;
  previewKind: 'image' | 'video' | 'tif' | 'panorama';
};

export type AerialMediaUploadStartParams = {
  kind: AerialKind;
  folderName: string;
  workName: string;
  files: File[];
  srKey?: number;
  wuKey?: number;
  linkedRequestId?: string;
};

export type AerialMediaUploadCompleteEvent = {
  kind: AerialKind;
  folderName: string;
  workName: string;
  wuKey?: number;
  linkedRequestId?: string;
  items: AerialMediaUploadItem[];
  fileCount: number;
  error?: string;
  aborted?: boolean;
};

type CompleteListener = (event: AerialMediaUploadCompleteEvent) => void;

const listeners = new Set<CompleteListener>();
const controllers = new Map<string, AbortController>();

function jobKey(kind: AerialKind, folderName: string): string {
  return `${kind}::${folderName}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    if (o.error && typeof o.error === 'object') {
      const nested = o.error as { message?: unknown };
      if (typeof nested.message === 'string' && nested.message) return nested.message;
    }
  }
  if (typeof err === 'string' && err) return err;
  return '업로드에 실패했습니다.';
}

function emitComplete(event: AerialMediaUploadCompleteEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeAerialMediaUploadComplete(listener: CompleteListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAerialMediaUploading(kind: AerialKind, folderName: string): boolean {
  return controllers.has(jobKey(kind, folderName));
}

/** 명시적 중단만. 창 닫기에서는 호출하지 않는다. */
export function cancelAerialMediaUpload(kind: AerialKind, folderName: string): void {
  const key = jobKey(kind, folderName);
  const c = controllers.get(key);
  if (!c) return;
  c.abort();
  controllers.delete(key);
  failClientUploadJob({ kind, folderName, dismiss: true });
}

/**
 * 백그라운드 업로드 시작. Promise는 완료까지 await 가능하나,
 * UI는 반환 직후 닫아도 업로드는 계속된다.
 */
export function startAerialMediaUpload(
  params: AerialMediaUploadStartParams
): Promise<AerialMediaUploadCompleteEvent> {
  const { kind, folderName, workName, files, srKey, wuKey, linkedRequestId } = params;
  const key = jobKey(kind, folderName);

  if (files.length === 0) {
    const empty: AerialMediaUploadCompleteEvent = {
      kind,
      folderName,
      workName,
      wuKey,
      linkedRequestId,
      items: [],
      fileCount: 0,
      error: '파일을 선택하세요.',
    };
    return Promise.resolve(empty);
  }

  if (controllers.has(key)) {
    const busy: AerialMediaUploadCompleteEvent = {
      kind,
      folderName,
      workName,
      wuKey,
      linkedRequestId,
      items: [],
      fileCount: 0,
      error: '이 작업단위는 이미 업로드 중입니다. 목록에서 진행률을 확인하세요.',
    };
    return Promise.resolve(busy);
  }

  const abort = new AbortController();
  controllers.set(key, abort);
  const signal = abort.signal;

  beginClientUploadJob({
    kind,
    folderName,
    workName,
    fileTotal: files.length,
    currentFileName: files[0]?.name ?? '',
  });

  const run = async (): Promise<AerialMediaUploadCompleteEvent> => {
    const items: AerialMediaUploadItem[] = [];
    let resolvedWuKey = wuKey;

    try {
      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) throw new Error('취소됨');
        const file = files[i];
        updateClientUploadJob({
          kind,
          folderName,
          fileIndex: i + 1,
          fileTotal: files.length,
          currentFileName: file.name,
          chunkIndex: 0,
          chunkTotal: 0,
        });

        const initRes = await call('', 'POST', {
          service: 'aerialUploadService',
          action: 'initMediaUpload',
          params: {
            kind,
            folderName,
            fileName: file.name,
            totalSize: file.size,
            ...(resolvedWuKey != null ? { wuKey: resolvedWuKey } : {}),
            ...(srKey != null ? { srKey } : {}),
          },
        });
        if (!initRes?.success) {
          throw new Error(
            typeof initRes?.error === 'string'
              ? initRes.error
              : (initRes?.error as { message?: string } | undefined)?.message ||
                  '업로드 초기화에 실패했습니다.'
          );
        }
        const initData = (initRes.data ?? initRes) as {
          uploadId?: string;
          chunkSize?: number;
          expectedChunks?: number;
          wuKey?: number;
        };
        const uploadId = initData.uploadId;
        const chunkSize = initData.chunkSize ?? 512 * 1024;
        const expectedChunks = initData.expectedChunks ?? 1;
        if (initData.wuKey != null) resolvedWuKey = initData.wuKey;
        if (!uploadId) throw new Error('uploadId가 없습니다.');

        for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
          if (signal.aborted) throw new Error('취소됨');
          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const blob = file.slice(start, end);
          const url = `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
          const res = await fetch(url, { method: 'POST', body: blob, signal });
          if (!res.ok) {
            const errText = await res.text();
            let errMsg = `청크 ${chunkIndex + 1} 전송 실패`;
            try {
              const j = JSON.parse(errText) as { error?: string };
              if (j?.error) errMsg = j.error;
            } catch {
              if (errText) errMsg = errText.slice(0, 200);
            }
            throw new Error(errMsg);
          }
          updateClientUploadJob({
            kind,
            folderName,
            fileIndex: i + 1,
            fileTotal: files.length,
            currentFileName: file.name,
            chunkIndex: chunkIndex + 1,
            chunkTotal: expectedChunks,
          });
        }

        const completeRes = await call('', 'POST', {
          service: 'aerialUploadService',
          action: 'completeMediaUpload',
          params: {
            uploadId,
            kind,
            folderName,
            workName,
            ...(resolvedWuKey != null ? { wuKey: resolvedWuKey } : {}),
            ...(srKey != null ? { srKey } : {}),
          },
        });
        if (!completeRes?.success) {
          throw new Error(
            typeof completeRes?.error === 'string'
              ? completeRes.error
              : (completeRes?.error as { message?: string } | undefined)?.message ||
                  '파일 등록에 실패했습니다.'
          );
        }
        const completeData = (completeRes.data ?? completeRes) as {
          item?: AerialMediaUploadItem;
        };
        if (completeData.item) items.push(completeData.item);
      }

      /** 드론영상·항공영상: 업로드 직후 변환 큐 */
      if ((kind === 'ortho' || kind === 'satellite') && items.length > 0 && !signal.aborted) {
        updateClientUploadJob({
          kind,
          folderName,
          fileIndex: files.length,
          fileTotal: files.length,
          currentFileName: kind === 'satellite' ? '자체항공영상 등록 중…' : '타일 변환 중…',
          chunkIndex: 0,
          chunkTotal: 0,
          percent: 80,
        });
        const convertRes = await call('', 'POST', {
          service: 'aerialOrthoService',
          action: kind === 'satellite' ? 'convertSatelliteWorkUnit' : 'convertOrthoWorkUnit',
          params: {
            kind,
            folderName,
            ...(resolvedWuKey != null ? { wuKey: resolvedWuKey } : {}),
          },
        });
        if (!convertRes?.success) {
          throw new Error(
            typeof convertRes?.error === 'string'
              ? convertRes.error
              : (convertRes?.error as { message?: string } | undefined)?.message ||
                  (kind === 'satellite'
                    ? '자체항공영상 등록에 실패했습니다.'
                    : '타일 변환에 실패했습니다.')
          );
        }
        updateClientUploadJob({
          kind,
          folderName,
          fileIndex: files.length,
          fileTotal: files.length,
          currentFileName: kind === 'satellite' ? '자체항공영상 등록 완료' : '변환 완료',
          chunkIndex: 1,
          chunkTotal: 1,
          percent: 99,
        });
      }

      completeClientUploadJob({
        kind,
        folderName,
        workName,
        fileTotal: files.length,
      });

      const done: AerialMediaUploadCompleteEvent = {
        kind,
        folderName,
        workName,
        wuKey: resolvedWuKey,
        linkedRequestId,
        items,
        fileCount: items.length,
      };
      emitComplete(done);
      return done;
    } catch (err) {
      const message = errorMessage(err);
      const aborted = signal.aborted;
      if (aborted) {
        failClientUploadJob({ kind, folderName, dismiss: true });
      } else {
        failClientUploadJob({ kind, folderName });
      }
      const failed: AerialMediaUploadCompleteEvent = {
        kind,
        folderName,
        workName,
        wuKey: resolvedWuKey,
        linkedRequestId,
        items,
        fileCount: items.length,
        error: message,
        aborted,
      };
      if (!aborted) emitComplete(failed);
      return failed;
    } finally {
      controllers.delete(key);
    }
  };

  return run();
}
