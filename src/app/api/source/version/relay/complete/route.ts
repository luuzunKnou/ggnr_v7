import { NextRequest, NextResponse } from 'next/server';
import { startNdjsonStreamKeepalive } from '@/lib/ndjsonStreamKeepalive';
import { getSessionUsrId } from '@/lib/auth/guard';
import { completeVersionRelay } from '@/service/sourceVersionRelayService';
import type { ApplySourceProgressEvent } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

type NdjsonProgressLine = ApplySourceProgressEvent & { type: 'progress' };
type NdjsonResultLine = { type: 'result'; ok: true } & Record<string, unknown>;
type NdjsonErrorLine = { type: 'error'; error: string; historyRecorded?: boolean };

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const uploadId = String(body.uploadId ?? '').trim();
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const yieldEventLoop = () => new Promise<void>((r) => setImmediate(r));
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stopKeepalive = startNdjsonStreamKeepalive(controller, encoder);
        const send = async (line: NdjsonProgressLine | NdjsonResultLine | NdjsonErrorLine) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          await yieldEventLoop();
        };
        try {
          const result = await completeVersionRelay({
            uploadId,
            onProgress: async (event) => {
              await send({ type: 'progress', ...event });
            },
          });
          await send({ type: 'result', ...result, ok: true });
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'relay complete failed';
          const historyRecorded =
            err instanceof Error &&
            'historyRecorded' in err &&
            (err as Error & { historyRecorded?: boolean }).historyRecorded === true;
          console.error(`[SourceCodeUpload] relay complete 실패: ${message}`, err);
          try {
            await send({
              type: 'error',
              error: message,
              historyRecorded,
            } as NdjsonErrorLine & { historyRecorded?: boolean });
            controller.close();
          } catch {
            try {
              controller.error(err);
            } catch {
              /* already closed */
            }
          }
        } finally {
          stopKeepalive();
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
    const message = err instanceof Error ? err.message : 'relay complete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
