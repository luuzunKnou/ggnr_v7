/**
 * 파이프라인 단계 이벤트 브로드캐스트 (SSE 구독자에게 전달).
 * pipelineService에서 STEP_START / RESULT 파싱 시 broadcast 호출.
 */
export type PipelineStepEvent = {
  path: string;
  step: 'ecef' | 'pnts';
  status: 'start' | 'ok' | 'fail';
};

type Listener = (event: PipelineStepEvent) => void;
const listeners = new Set<Listener>();

export function subscribePipelineEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastPipelineStep(event: PipelineStepEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (e) {
      console.warn('[pipelineEvents] listener error:', e);
    }
  });
}
