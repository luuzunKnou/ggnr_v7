/**
 * drizzle «Failed query: …» 에서 PostgreSQL cause 메시지를 꺼내 재throw.
 * (API 응답에 실제 원인: relation does not exist, timeout 등이 보이게)
 */
export function rethrowWithPgCause(e: unknown, label: string): never {
  const cause =
    e && typeof e === 'object' && 'cause' in e ? (e as { cause?: unknown }).cause : undefined;
  const causeMsg =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : null;
  const base = e instanceof Error ? e.message : String(e);
  const err = new Error(causeMsg ? `${label}: ${causeMsg}` : `${label}: ${base}`) as Error & {
    cause?: unknown;
    code?: string;
    detail?: string;
  };
  err.cause = cause ?? e;
  if (cause && typeof cause === 'object') {
    if ('code' in cause) err.code = String((cause as { code: unknown }).code);
    if ('detail' in cause) err.detail = String((cause as { detail: unknown }).detail);
  }
  throw err;
}
