import { spawn, type ChildProcess } from 'node:child_process';
import { decodeChildOutput } from '@/lib/decodeChildOutput';

export type TypeCheckProgressCallback = (line: string) => void;

export type TypeCheckResult = {
  ok: boolean;
  /** 성공 메시지 또는 tsc 오류 전문(모달·로그용) */
  message: string;
  cancelled?: boolean;
};

/** @deprecated TypeCheckResult 사용 */
export type BuildCheckResult = TypeCheckResult;
/** @deprecated TypeCheckProgressCallback 사용 */
export type BuildCheckProgressCallback = TypeCheckProgressCallback;

let typeCheckInflight = false;

export function isTypeCheckInflight(): boolean {
  return typeCheckInflight;
}

/** @deprecated isTypeCheckInflight 사용 */
export function isBuildCheckInflight(): boolean {
  return typeCheckInflight;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid == null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

/**
 * 현재 워크스페이스에서 `npx tsc --noEmit` 실행.
 * 원본 파일은 변경하지 않는다.
 */
export async function runWorkspaceTypeCheck(
  workspaceRoot: string,
  onLine?: TypeCheckProgressCallback,
  signal?: AbortSignal
): Promise<TypeCheckResult> {
  if (typeCheckInflight) {
    return { ok: false, message: '타입 검사가 이미 진행 중입니다.' };
  }
  throwIfAborted(signal);
  typeCheckInflight = true;

  try {
    onLine?.('npx tsc --noEmit 시작...');
    return await new Promise<TypeCheckResult>((resolve) => {
      if (signal?.aborted) {
        resolve({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
        return;
      }

      const usedCmdShell = process.platform === 'win32';
      const child = spawn('npx', ['tsc', '--noEmit'], {
        cwd: workspaceRoot,
        shell: true,
        windowsHide: true,
        env: process.env,
      });
      let output = '';
      let settled = false;

      const finish = (result: TypeCheckResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const onAbort = () => {
        killProcessTree(child);
        finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      const emitLines = (buf: Buffer) => {
        const text = decodeChildOutput(buf, usedCmdShell);
        output += text;
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trimEnd();
          if (trimmed) onLine?.(trimmed);
        }
      };
      child.stdout?.on('data', emitLines);
      child.stderr?.on('data', emitLines);
      child.on('error', (err) => {
        if (signal?.aborted) {
          finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
          return;
        }
        finish({ ok: false, message: err.message });
      });
      child.on('close', (code) => {
        if (signal?.aborted) {
          finish({ ok: false, message: '사용자가 취소했습니다.', cancelled: true });
          return;
        }
        const trimmed = output.trim();
        if ((code ?? 1) === 0) {
          finish({ ok: true, message: trimmed || '타입 검사 통과' });
          return;
        }
        finish({
          ok: false,
          message: trimmed || `npx tsc --noEmit 실패 (code=${code})`,
        });
      });
    });
  } catch (e: unknown) {
    if (isAbortError(e) || signal?.aborted) {
      return { ok: false, message: '사용자가 취소했습니다.', cancelled: true };
    }
    throw e;
  } finally {
    typeCheckInflight = false;
  }
}

/** @deprecated runWorkspaceTypeCheck 사용 */
export async function runIsolatedBuildCheck(
  workspaceRoot: string,
  onLine?: TypeCheckProgressCallback,
  signal?: AbortSignal
): Promise<TypeCheckResult> {
  return runWorkspaceTypeCheck(workspaceRoot, onLine, signal);
}
