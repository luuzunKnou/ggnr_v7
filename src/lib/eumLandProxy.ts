/**
 * 토지이음 열람 페이지의 범례·도면 그림은 조회 세션이 있어야 내려온다.
 * iframe에서 직접 열면 그 세션이 빠지므로, 서버가 받아 같은 주소로 넘긴다.
 */

const EUM_ORIGIN = 'https://www.eum.go.kr';
const EUM_PAGE = `${EUM_ORIGIN}/web/ar/lu/luLandDet.jsp`;
const EUM_PLAN_PAGE = `${EUM_ORIGIN}/web/cp/cv/cvUpisDet.jsp`;
const EUM_IMAGE = `${EUM_ORIGIN}/web/ar/lu/images`;
/** 브라우저가 직접 치면 우리 주소가 넘어가 소재지 조회가 빈다. 같은 출처로 받아 토지이음 주소를 붙인다. */
const EUM_RELAY = '/api/land-eum/relay';
const EUM_REFERER = EUM_PLAN_PAGE;
const SESSION_TTL_MS = 10 * 60 * 1000;

type EumSession = { cookie: string; at: number };

const globalSessions = globalThis as typeof globalThis & { __eumLandSessions?: Map<string, EumSession> };
const sessions = globalSessions.__eumLandSessions ?? new Map<string, EumSession>();
globalSessions.__eumLandSessions = sessions;

function pruneSessions() {
  const now = Date.now();
  for (const [key, row] of sessions) {
    if (now - row.at > SESSION_TTL_MS) sessions.delete(key);
  }
}

function rememberSession(prefix: string, cookie: string) {
  if (!prefix || !cookie) return;
  pruneSessions();
  sessions.set(prefix, { cookie, at: Date.now() });
}

export function eumSessionCookie(imageKey: string): string | null {
  const prefix = imageKey.split('-')[0] ?? '';
  const row = sessions.get(prefix);
  if (!row) return null;
  if (Date.now() - row.at > SESSION_TTL_MS) {
    sessions.delete(prefix);
    return null;
  }
  return row.cookie;
}

function cookieHeaderFrom(response: Response): string {
  const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return list
    .map((row) => row.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

/** 사이트 메뉴·주소검색·발급 버튼은 숨기고 열람 내용만 남긴다. */
const EUM_TRIM_STYLE =
  '<style id="ggnr-eum-trim">' +
  '.header,#lnbWrap,.nav_wrap,.bread_crumb,h3.title,.search,.right_bottom,.footer,.footer_top,.footer_menu,.satis{display:none!important}' +
  'tr:has(#present_addr){display:none!important}' +
  'body,#wrap,#m_conts,.container{margin:0!important;padding:0!important;background:#fff!important}' +
  '.contents{margin-top:0!important}' +
  '</style>';

function rewriteLandHtml(html: string): string {
  const next = html
    .replace(/(["'])\.\.\/\.\.\//g, `$1${EUM_RELAY}/`)
    .replace(/(["'(])\/web\//g, `$1${EUM_RELAY}/`)
    .replace(/var context\s*=\s*["']\/web["']/g, `var context="${EUM_RELAY}"`)
    .replace(/(["'])images\?key=/g, '$1/api/land-eum/image?key=');
  if (next.includes('</head>')) return next.replace('</head>', `${EUM_TRIM_STYLE}</head>`);
  return EUM_TRIM_STYLE + next;
}

/** 도시계획도 스크립트의 상대 조회가 우리 중계로 가게 한다. */
function retargetPlanHtml(html: string): string {
  return html.replace('<head>', `<head><base href="${EUM_RELAY}/cp/cv/">`);
}

export async function fetchEumRelay(args: {
  path: string;
  search: string;
  method: 'GET' | 'POST';
  body: ArrayBuffer | null;
  contentType: string | null;
}): Promise<{ status: number; body: ArrayBuffer; contentType: string }> {
  const parts = args.path.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error('잘못된 경로입니다.');
  }
  const response = await fetch(`${EUM_ORIGIN}/web/${parts.join('/')}${args.search}`, {
    method: args.method,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: '*/*',
      Referer: EUM_REFERER,
      Origin: EUM_ORIGIN,
      ...(args.contentType ? { 'Content-Type': args.contentType } : {}),
    },
    body: args.method === 'POST' ? args.body : undefined,
    cache: 'no-store',
    redirect: 'follow',
  });
  return {
    status: response.status,
    body: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function fetchEumLandHtml(pnu: string, view: 'land' | 'plan' = 'land'): Promise<string> {
  const url =
    view === 'plan'
      ? `${EUM_PLAN_PAGE}?pnu=${pnu}`
      : `${EUM_PAGE}?chk=0&isNoScr=script&mode=search&selGbn=umd&s_type=1&sggcd=${pnu.slice(0, 5)}&pnu=${pnu}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error('토지이음 화면을 불러오지 못했습니다.');
  }
  const cookie = cookieHeaderFrom(response);
  const html = Buffer.from(await response.arrayBuffer()).toString('latin1');
  const prefixes = new Set<string>();
  for (const match of html.matchAll(/images\?key=(\d+)-/g)) {
    if (match[1]) prefixes.add(match[1]);
  }
  for (const prefix of prefixes) rememberSession(prefix, cookie);
  const rewritten = rewriteLandHtml(html);
  return view === 'plan' ? retargetPlanHtml(rewritten) : rewritten;
}

export async function fetchEumLandImage(imageKey: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const cookie = eumSessionCookie(imageKey);
  const response = await fetch(`${EUM_IMAGE}?key=${encodeURIComponent(imageKey)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'image/png,image/*,*/*',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error('토지이음 그림을 불러오지 못했습니다.');
  }
  const body = await response.arrayBuffer();
  return { body, contentType: response.headers.get('content-type') || 'image/png' };
}
