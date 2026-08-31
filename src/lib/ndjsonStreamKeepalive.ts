/** 게이트·리버스 프록시 유휴(~60초) — 작은 NDJSON만으로는 버퍼 flush가 안 되는 경우 대비 */
export const NDJSON_STREAM_KEEPALIVE_MS = 15_000;
export const NDJSON_STREAM_KEEPALIVE_PAD_BYTES = 2048;

/** 클라이언트는 type=keepalive 를 무시. 주기적으로 패딩 포함 청크 전송 */
export function startNdjsonStreamKeepalive(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  intervalMs: number = NDJSON_STREAM_KEEPALIVE_MS
): () => void {
  const timer = setInterval(() => {
    try {
      const line = JSON.stringify({
        type: 'keepalive',
        _pad: ' '.repeat(NDJSON_STREAM_KEEPALIVE_PAD_BYTES),
      });
      controller.enqueue(encoder.encode(`${line}\n`));
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
