'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';

export type TypeCheckFetchResult = {
  ok: boolean;
  output: string;
  cancelled?: boolean;
};

type NdjsonLine = {
  type?: string;
  line?: string;
  ok?: boolean;
  message?: string;
  error?: string;
  cancelled?: boolean;
};

/** `/api/source/upload/build-check` NDJSON 스트림으로 타입 검사 실행 */
export async function fetchWorkspaceTypeCheck(
  signal?: AbortSignal,
  onLog?: (line: string) => void
): Promise<TypeCheckFetchResult> {
  const res = await fetch('/api/source/upload/build-check', {
    method: 'POST',
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `타입 검사 실패 (${res.status})`);
  }
  if (!res.body) {
    throw new Error('응답 본문이 없습니다.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneOk = false;
  let doneMessage = '';
  let cancelled = false;
  let streamError: string | null = null;

  const handleNdjsonLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: NdjsonLine;
    try {
      parsed = JSON.parse(trimmed) as NdjsonLine;
    } catch {
      return;
    }
    if (parsed.type === 'log' && parsed.line) {
      onLog?.(parsed.line);
    } else if (parsed.type === 'done') {
      doneOk = parsed.ok === true;
      doneMessage = parsed.message ?? '';
      cancelled = parsed.cancelled === true;
    } else if (parsed.type === 'error') {
      streamError = parsed.error ?? 'unknown';
      onLog?.(`오류: ${streamError}`);
    }
  };

  while (true) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, output: '사용자가 취소했습니다.', cancelled: true };
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleNdjsonLine(line);
    }
  }
  if (buffer.trim()) {
    handleNdjsonLine(buffer);
  }

  if (streamError && !doneMessage) {
    return { ok: false, output: streamError };
  }
  if (cancelled) {
    return { ok: false, output: doneMessage || '사용자가 취소했습니다.', cancelled: true };
  }
  return { ok: doneOk, output: doneMessage };
}

export function TypeCheckErrorModal({
  output,
  onProceed,
  onAbort,
}: {
  output: string;
  onProceed: () => void;
  onAbort: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-3xl flex-col rounded border bg-background p-4 shadow-lg">
        <div className="mb-2 text-sm font-medium">타입 오류 발견</div>
        <textarea
          readOnly
          className="mb-3 w-full resize-none rounded border bg-muted/30 p-2 font-mono text-xs"
          style={{ height: 500 }}
          value={output}
          title="타입 오류 메시지"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" title="중단" onClick={onAbort} className="cursor-pointer">
            중단
          </Button>
          <Button type="button" title="진행" onClick={onProceed} className="cursor-pointer">
            진행
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 타입 검사 → 오류 시 진행/중단 모달.
 * - passed: tsc 통과
 * - continued: 오류 있으나 사용자가 진행
 * - aborted: 취소/중단
 */
export type TypeCheckGateOutcome = 'passed' | 'continued' | 'aborted';

export function useTypeCheckGate() {
  const [checking, setChecking] = useState(false);
  const [errorOutput, setErrorOutput] = useState<string | null>(null);
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const closeModal = useCallback((proceed: boolean) => {
    setErrorOutput(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(proceed);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runGate = useCallback(
    async (opts?: {
      signal?: AbortSignal;
      onLog?: (line: string) => void;
    }): Promise<TypeCheckGateOutcome> => {
      abortRef.current?.abort();
      const local = new AbortController();
      abortRef.current = local;

      const onAbortFromOuter = () => local.abort();
      opts?.signal?.addEventListener('abort', onAbortFromOuter, { once: true });

      setChecking(true);
      try {
        opts?.onLog?.('타입 검사 시작 (npx tsc --noEmit)...');
        const result = await fetchWorkspaceTypeCheck(local.signal, opts?.onLog);
        if (result.cancelled || local.signal.aborted || opts?.signal?.aborted) {
          opts?.onLog?.('타입 검사가 취소되었습니다.');
          return 'aborted';
        }
        if (result.ok) {
          opts?.onLog?.('타입 검사 통과');
          return 'passed';
        }
        opts?.onLog?.('타입 오류 발견 — 진행 여부 확인');
        const proceed = await new Promise<boolean>((resolve) => {
          resolveRef.current = resolve;
          setErrorOutput(result.output || '타입 오류가 발생했습니다.');
        });
        return proceed ? 'continued' : 'aborted';
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          opts?.onLog?.('타입 검사가 취소되었습니다.');
          return 'aborted';
        }
        const msg = e instanceof Error ? e.message : String(e);
        opts?.onLog?.(`타입 검사 오류: ${msg}`);
        const proceed = await new Promise<boolean>((resolve) => {
          resolveRef.current = resolve;
          setErrorOutput(msg);
        });
        return proceed ? 'continued' : 'aborted';
      } finally {
        opts?.signal?.removeEventListener('abort', onAbortFromOuter);
        if (abortRef.current === local) abortRef.current = null;
        setChecking(false);
      }
    },
    []
  );

  const modal =
    errorOutput != null ? (
      <TypeCheckErrorModal
        output={errorOutput}
        onProceed={() => closeModal(true)}
        onAbort={() => closeModal(false)}
      />
    ) : null;

  return { checking, runGate, abort, modal };
}
