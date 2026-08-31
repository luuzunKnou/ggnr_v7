import { NextRequest } from 'next/server';
import { startNdjsonStreamKeepalive } from '@/lib/ndjsonStreamKeepalive';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import { includeNodeModulesFromProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { normalizeRestartMode } from '@/service/sourceVersionService';
import {
  applyGnmsSourceZipOnServer,
  type GnmsProxyProgressEvent,
} from '@/service/gnmsSourceFetchService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

type NdjsonProgressLine = GnmsProxyProgressEvent & { type: 'progress' };
type NdjsonResultLine = { type: 'result'; ok: true } & Record<string, unknown>;
type NdjsonErrorLine = { type: 'error'; error: string; historyRecorded?: boolean };

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const folder = String(body.folder ?? '').trim();
    const isLatest = body.isLatest === true || folder === 'latest';
    if (!isLatest && !folder) {
      return Response.json({ error: 'folder가 필요합니다' }, { status: 400 });
    }
    const restart = body.restart === true;
    const restartMode = normalizeRestartMode(body.restartMode);
    const profile = body.packageProfile === 'open' ? 'open' : 'closed';
    const includeNodeModules = includeNodeModulesFromProfile(profile);
    const versionLabel = typeof body.versionLabel === 'string' ? body.versionLabel : undefined;
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    const clientIp = pickClientIpFromRequest(req, bodyIp);

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
          const result = await applyGnmsSourceZipOnServer({
            isLatest,
            folder: isLatest ? folder || 'latest' : folder,
            includeNodeModules,
            requestedBy: String(usrId),
            clientIp,
            restart,
            restartMode,
            versionLabel,
            signal: req.signal,
            onProgress: async (event) => {
              await send({ type: 'progress', ...event });
            },
          });
          await send({ type: 'result', ...result, ok: true });
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'GNMS 적용 실패';
          const historyRecorded =
            err instanceof Error &&
            'historyRecorded' in err &&
            (err as Error & { historyRecorded?: boolean }).historyRecorded === true;
          console.error(`[SourceCodeUpload] GNMS apply 실패: ${message}`, err);
          try {
            await send({ type: 'error', error: message, historyRecorded });
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
    const message = err instanceof Error ? err.message : 'GNMS 적용 실패';
    return Response.json({ error: message }, { status: 500 });
  }
}
