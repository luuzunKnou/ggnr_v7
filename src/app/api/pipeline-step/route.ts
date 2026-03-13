import { NextRequest } from 'next/server';
import { broadcastPipelineStep } from '@/lib/pipelineEvents';

/**
 * POST: 파이프라인 단계 알림 (Python에서 완료 시 호출).
 * body: { path: string, step: 'geotiff'|'ecef'|'pnts', status: 'start'|'ok'|'fail' }
 * SSE 구독자에게 브로드캐스트하여 UI 아이콘 갱신.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const path = typeof body?.path === 'string' ? body.path.replace(/\\/g, '/') : '';
    const step = body?.step;
    const status = body?.status;
    if (!path || !['geotiff', 'ecef', 'pnts'].includes(step) || !['start', 'ok', 'fail'].includes(status)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid path/step/status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    broadcastPipelineStep({ path, step, status });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.warn('[pipeline-step] POST error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
