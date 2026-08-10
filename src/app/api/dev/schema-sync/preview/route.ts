import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getSessionUsrId } from '@/lib/auth/guard';
import type { SchemaSyncPreviewResult } from '@/lib/schemaSyncPreviewTypes';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function emptyPreview(error: string): SchemaSyncPreviewResult {
  return {
    ok: false,
    error,
    counts: { create: 0, drop: 0, delete: 0, alter: 0 },
    items: [],
    warnings: [],
    hasDataLoss: false,
  };
}

/**
 * 병합 직후 디스크 스키마를 별도 tsx 프로세스로 읽어 dry-run 집계.
 * (Next 메모리 캐시와 분리)
 */
async function runPreviewChild(): Promise<SchemaSyncPreviewResult> {
  const script = path.join(process.cwd(), 'scripts', 'drizzle-push-additive.ts');
  const tsxBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const child = spawn(tsxBin, [script, 'preview'], {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(emptyPreview('스키마 미리보기 시간 초과'));
    }, 90_000);

    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => errChunks.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(emptyPreview(e.message || '미리보기 프로세스 실행 실패'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8').trim();
      const errOut = Buffer.concat(errChunks).toString('utf8').trim();
      if (!out) {
        resolve(
          emptyPreview(
            errOut
              ? `미리보기 실패: ${errOut.slice(0, 400)}`
              : `미리보기 실패 (exit=${code ?? '?'})`
          )
        );
        return;
      }
      try {
        const lastLine = out.split(/\r?\n/).filter(Boolean).pop() ?? out;
        const parsed = JSON.parse(lastLine) as SchemaSyncPreviewResult;
        resolve(parsed);
      } catch {
        resolve(emptyPreview('미리보기 JSON 파싱 실패'));
      }
    });
  });
}

/** 최신소스 병합 후 스키마 변경 집계 (안내 모달용) */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const preview = await runPreviewChild();
    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'schema preview failed';
    return NextResponse.json(emptyPreview(message), { status: 500 });
  }
}
