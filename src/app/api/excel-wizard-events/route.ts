import { NextRequest } from 'next/server';
import { subscribeExcelWizardEvents } from '@/lib/excelWizardEvents';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = (searchParams.get('jobId') ?? '').trim();
  const signal = request.signal;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsub = subscribeExcelWizardEvents((event) => {
        if (jobId && event.jobId !== jobId) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // stream may already be closed
        }
      });
      controller.enqueue(encoder.encode(': connected\n\n'));
      signal?.addEventListener('abort', () => {
        unsub();
        try {
          controller.close();
        } catch {
          // ignore close errors
        }
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
