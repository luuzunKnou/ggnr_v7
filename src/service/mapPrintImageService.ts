import { randomUUID } from 'node:crypto';

const TTL_MS = 60_000;
const MAX_BYTES = 40 * 1024 * 1024;

type Entry = {
  buf: Buffer;
  fileName: string;
  expiresAt: number;
};

const store = new Map<string, Entry>();

function purgeExpired(now = Date.now()): void {
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}

function sanitizeFileName(name: string): string {
  const raw = String(name || 'map-image.png').trim() || 'map-image.png';
  const base = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
}

/** PNG 바이트를 일회성 다운로드용으로 보관하고 id 반환 */
export function storeMapPrintPng(bytes: Uint8Array | ArrayBuffer, fileName: string): string {
  purgeExpired();
  const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  if (buf.length < 32) {
    throw Object.assign(new Error('이미지 데이터가 비어 있습니다.'), { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    throw Object.assign(new Error('이미지 용량이 너무 큽니다.'), { status: 413 });
  }
  // PNG signature
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw Object.assign(new Error('PNG 형식이 아닙니다.'), { status: 400 });
  }
  const id = randomUUID();
  store.set(id, {
    buf,
    fileName: sanitizeFileName(fileName),
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

/** id로 꺼내며 즉시 삭제(일회성) */
export function takeMapPrintPng(id: string): { buf: Buffer; fileName: string } | null {
  purgeExpired();
  const key = String(id || '').trim();
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  return { buf: entry.buf, fileName: entry.fileName };
}
