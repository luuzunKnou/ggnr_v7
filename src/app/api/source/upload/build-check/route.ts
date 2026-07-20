import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { runIsolatedBuildCheck } from '@/service/sourceBuildCheckService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

type NdjsonLogLine = { type: 'log'; line: string };
type NdjsonDoneLine = { type: 'done'; ok: boolean; message: string };
type NdjsonErrorLine = { type: 'error'; error: string };

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    void req;

    const encoder = new TextEncoder();
    const yieldEventLoop = () => new Promise<void>((r) => setImmediate(r));
    const workspaceRoot = process.cwd();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = async (line: NdjsonLogLine | NdjsonDoneLine | NdjsonErrorLine) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          await yieldEventLoop();
        };
        try {
          const result = await runIsolatedBuildCheck(workspaceRoot, async (logLine) => {
            await send({ type: 'log', line: logLine });
          });
          if (!result.ok && result.message === '빌드 확인이 이미 진행 중입니다.') {
            await send({ type: 'error', error: result.message });
            controller.close();
            return;
          }
          await send({ type: 'done', ok: result.ok, message: result.message });
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'build check failed';
          try {
            await send({ type: 'error', error: message });
            controller.close();
          } catch {
            try {
              controller.error(err);
            } catch {
              /* already closed */
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'build check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
