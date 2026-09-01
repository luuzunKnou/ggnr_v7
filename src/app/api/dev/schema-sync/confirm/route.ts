import { NextRequest } from 'next/server';
import { startNdjsonStreamKeepalive } from '@/lib/ndjsonStreamKeepalive';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  confirmPendingSchemaApply,
  type ApplySourceProgressEvent,
} from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

type NdjsonProgressLine = ApplySourceProgressEvent & { type: 'progress' };
type NdjsonResultLine = { type: 'result'; ok: true } & Record<string, unknown>;
type NdjsonErrorLine = { type: 'error'; error: string };

/** 스키마 안내 모달 [진행] — live commit·재기동 예약 (NDJSON 스트림·keepalive) */
export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { pendingId?: string };
    const pendingId = typeof body.pendingId === 'string' ? body.pendingId.trim() : '';
    if (!pendingId) {
      return Response.json({ ok: false, error: 'pendingId가 필요합니다.' }, { status: 400 });
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
          const result = await confirmPendingSchemaApply({
            pendingId,
            requestedBy: String(usrId),
            onProgress: async (event) => {
              await send({ type: 'progress', ...event });
            },
          });
          if (!result.ok) {
            await send({ type: 'error', error: result.error ?? 'schema confirm failed' });
            controller.close();
            return;
          }
          await send({ type: 'result', ...result, ok: true });
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'schema confirm failed';
          console.error(`[SourceCodeUpload] schema confirm 실패: ${message}`, err);
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
    const message = err instanceof Error ? err.message : 'schema confirm failed';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
