import { NextRequest } from 'next/server';
import { subscribePipelineEvents } from '@/lib/pipelineEvents';

/**
 * GET: Server-Sent Events. 파이프라인 단계 시작/완료 시 이벤트 푸시.
 * EventSource('/api/pipeline-events') 로 연결.
 */
export async function GET(request: NextRequest) {
  const signal = request.signal;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsub = subscribePipelineEvents((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // stream already closed
        }
      });
      controller.enqueue(encoder.encode(': connected\n\n'));
      signal?.addEventListener('abort', () => {
        unsub();
        try {
          controller.close();
        } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-cache',
      Connection: 'keep-alive',
    },
  });
}
