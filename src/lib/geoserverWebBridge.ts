import { randomBytes } from 'crypto';

/** 스타일 편집 첫 요청에만 붙는 일회용 값. GeoServer 쿼리로 넘기지 않는다. */
export const GEOSERVER_WEB_BRIDGE_PARAM = 'gsbridge';

const TTL_MS = 60_000;
const TOKEN = /^[a-f0-9]{48}$/;

type Entry = { sessionId: string; exp: number };

function jar(): Map<string, Entry> {
  const g = globalThis as typeof globalThis & { __ggnrGsWebBridge?: Map<string, Entry> };
  if (!g.__ggnrGsWebBridge) g.__ggnrGsWebBridge = new Map();
  return g.__ggnrGsWebBridge;
}

export function putGeoserverWebBridge(sessionId: string): string {
  const now = Date.now();
  const map = jar();
  for (const [key, entry] of map) {
    if (entry.exp <= now) map.delete(key);
  }
  const token = randomBytes(24).toString('hex');
  map.set(token, { sessionId, exp: now + TTL_MS });
  return token;
}

export function takeGeoserverWebBridge(token: string): string | null {
  if (!TOKEN.test(token)) return null;
  const map = jar();
  const hit = map.get(token);
  map.delete(token);
  if (!hit || hit.exp <= Date.now() || !hit.sessionId) return null;
  return hit.sessionId;
}

/** 미리 열기·미리 가져오기는 세션을 만들지 않는다. 클릭과 겹치면 쿠키가 반반으로 갈린다. */
export function isSpeculativeRequest(headers: Headers): boolean {
  const purpose = `${headers.get('purpose') ?? ''} ${headers.get('sec-purpose') ?? ''} ${headers.get('sec-fetch-purpose') ?? ''}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true;
  const router = headers.get('next-router-prefetch');
  return router === '1' || router === 'true';
}

export function stripGeoserverWebBridge(search: string): { search: string; token: string | null } {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return { search: '', token: null };
  let token: string | null = null;
  const parts = raw.split('&').filter((part) => {
    if (!part) return false;
    const eq = part.indexOf('=');
    const key = eq >= 0 ? part.slice(0, eq) : part;
    if (key !== GEOSERVER_WEB_BRIDGE_PARAM) return true;
    const value = eq >= 0 ? part.slice(eq + 1) : '';
    try {
      token = decodeURIComponent(value);
    } catch {
      token = value;
    }
    return false;
  });
  return { search: parts.length ? `?${parts.join('&')}` : '', token };
}
