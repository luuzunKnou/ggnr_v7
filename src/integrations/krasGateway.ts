/**
 * 토지행정망(KRAS)·공시지가(KOREPS) 게이트웨이 내려받기.
 * GET 쿼리, POST 본문. 웹페이지·오류 XML·연결 실패는 예외.
 */
import { KRAS_DOWNLOAD_TIMEOUT_MS } from '@/integrations/krasLayerSync.config';
import { getLandLinkageConfig } from '@/service/configService';

export type KrasConn = {
  url: string;
  key: string;
  sgg: string;
};

export function krasBaseUrl(): string | null {
  const cfg = getLandLinkageConfig();
  if (!cfg.krasIp || !cfg.krasPort) return null;
  const pathPart = cfg.krasPath.startsWith('/') ? cfg.krasPath : `/${cfg.krasPath}`;
  return `http://${cfg.krasIp}:${cfg.krasPort}${pathPart === '/' ? '' : pathPart}`;
}

export function krasRequestUrl(base: string, query: string): string {
  const root = base.replace(/\/+$/, '') || base;
  const q = query.replace(/^\?/, '');
  return `${root}?${q}`;
}

export function redactKrasUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('conn_sys_id')) u.searchParams.set('conn_sys_id', '***');
    return u.toString();
  } catch {
    return url.replace(/conn_sys_id=[^&]*/i, 'conn_sys_id=***');
  }
}

export function requireKrasConn(): KrasConn {
  const cfg = getLandLinkageConfig();
  const url = krasBaseUrl();
  if (!url || !cfg.krasKey || !cfg.sggCode) {
    throw new Error('토지행정망 접속정보(키·주소·시군구 코드)가 없습니다.');
  }
  return { url, key: cfg.krasKey, sgg: cfg.sggCode };
}

export function buildKrasQuery(opts: {
  key: string;
  queryId: string;
  sgg: string;
  extra?: Record<string, string>;
}): string {
  const qs = new URLSearchParams();
  qs.set('conn_sys_id', opts.key);
  qs.set('conn_svc_id', opts.queryId);
  qs.set('adm_sect_cd', opts.sgg);
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v) qs.set(k, v);
  }
  return qs.toString();
}

function errorCauseText(e: unknown): string {
  if (!(e instanceof Error)) return String(e ?? '');
  const withCause = e as Error & { cause?: unknown };
  if (withCause.cause instanceof Error) {
    const c = withCause.cause as Error & { code?: string };
    return [c.code, c.message].filter(Boolean).join(' ');
  }
  if (withCause.cause && typeof withCause.cause === 'object' && 'code' in withCause.cause) {
    return String((withCause.cause as { code: string }).code);
  }
  return e.message;
}

export function formatDownloadError(e: unknown, url: string): string {
  const shown = redactKrasUrl(url);
  if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))) {
    return `내려받기 시간 초과 (${shown})`;
  }
  const text = errorCauseText(e);
  const blob = `${e instanceof Error ? e.message : String(e)} ${text}`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET/i.test(blob)) {
    return `행망에 연결할 수 없습니다 (${shown})${text ? ` — ${text}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** 연결·인증처럼 나머지도 무조건 실패할 오류 — 다음 레이어로 넘어가지 않음 */
export function shouldStopAll(msg: string): boolean {
  return /행망에 연결할 수 없습니다|내려받기 시간 초과|접속정보|HTTP 401|HTTP 403|HTTP 404|HTTP 5\d\d|인증|권한 없|도형 대신 웹 페이지|웹 페이지가 내려왔습니다/.test(
    msg
  );
}

function isHtmlWelcomeBody(buf: Buffer, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const head = buf.subarray(0, Math.min(buf.length, 800)).toString('utf8');
  if (/<!DOCTYPE html/i.test(head) || /<html[\s>]/i.test(head)) return true;
  if (/Licensed to the Apache Software Foundation/i.test(head)) return true;
  return false;
}

function looksLikeXml(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 400)).toString('utf8');
  return /<\?xml|<RESPONSE[\s>]|<HEADER[\s>]/i.test(sample);
}

/** 오류 XML이면 안내 문구. 성공 XML(코드 0000)은 allowSuccessXml일 때 통과. */
export function krasXmlFaultMessage(buf: Buffer, allowSuccessXml = false): string | null {
  if (!looksLikeXml(buf)) return null;
  const xml = buf.toString('utf8');
  const code = xml.match(/<CODE>([\s\S]*?)<\/CODE>/i)?.[1]?.trim() ?? '';
  const msg = xml.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/i)?.[1]?.trim() ?? '';
  if (allowSuccessXml && (code === '0000' || /^success$/i.test(msg))) return null;
  if (msg) return `행망 응답: ${msg}`;
  return `행망 XML 오류: ${xml.replace(/\s+/g, ' ').slice(0, 120)}`;
}

function resolveSameOriginRedirect(fromUrl: string, location: string): string | null {
  const loc = location.trim();
  if (!loc) return null;
  try {
    const next = new URL(loc, fromUrl);
    const from = new URL(fromUrl);
    if (next.host !== from.host) return null;
    return next.toString();
  } catch {
    return null;
  }
}

const HTML_ENDPOINT_MSG = '도형 대신 웹 페이지가 내려왔습니다';

export type FetchKrasBytesOpts = {
  method?: 'GET' | 'POST';
  body?: string;
  allowSuccessXml?: boolean;
  timeoutMs?: number;
  hop?: number;
};

export async function fetchKrasBytes(url: string, opts: FetchKrasBytesOpts = {}): Promise<Buffer> {
  const method = opts.method ?? 'GET';
  const hop = opts.hop ?? 0;
  const shown = redactKrasUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? KRAS_DOWNLOAD_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'manual',
        headers:
          method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            : undefined,
        body: method === 'POST' ? (opts.body ?? '') : undefined,
      });
    } catch (e) {
      throw new Error(formatDownloadError(e, url));
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '';
      const next = resolveSameOriginRedirect(url, loc);
      if (hop < 1 && next && next !== url && method === 'GET') {
        return fetchKrasBytes(next, { ...opts, hop: hop + 1 });
      }
      throw new Error(`${HTML_ENDPOINT_MSG} (${shown} → ${loc || res.status})`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${shown})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1) throw new Error('빈 파일');
    if (isHtmlWelcomeBody(buf, res.headers.get('content-type'))) {
      throw new Error(`${HTML_ENDPOINT_MSG} (${shown})`);
    }
    const xmlErr = krasXmlFaultMessage(buf, opts.allowSuccessXml === true);
    if (xmlErr) throw new Error(xmlErr);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export function korepsQueryUrl(): string | null {
  const cfg = getLandLinkageConfig();
  if (!cfg.korepsIp || !cfg.korepsPort) return null;
  const base = cfg.korepsPath.startsWith('/')
    ? cfg.korepsPath
    : cfg.korepsPath
      ? `/${cfg.korepsPath}`
      : '';
  const withSlash = base.endsWith('/') ? base.slice(0, -1) : base;
  return `http://${cfg.korepsIp}:${cfg.korepsPort}${withSlash}`;
}

export function requireKorepsConn(): { url: string; key: string; sgg: string } {
  const cfg = getLandLinkageConfig();
  const base = korepsQueryUrl();
  if (!base || !cfg.korepsKey || !cfg.sggCode) {
    throw new Error('공시지가 접속정보(키·주소·시군구 코드)가 없습니다.');
  }
  return { url: base, key: cfg.korepsKey, sgg: cfg.sggCode };
}
