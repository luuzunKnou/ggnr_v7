import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

function absorbSetCookies(jar: Map<string, string>, res: Response) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchWithJar(url: string, jar: Map<string, string>, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const cookie = cookieHeader(jar);
  if (cookie) headers.set('Cookie', cookie);
  // Node 기본 언어가 영어라 세션이 영어로 고정된다. 관리 화면 기본은 한글.
  headers.set('Accept-Language', 'ko-KR,ko;q=0.9');
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  absorbSetCookies(jar, res);
  return res;
}

/** GeoServer 관리 화면용 세션. 웹 체인은 폼 로그인만 받고, 첫 화면에서 세션 아이디를 한 번 더 바꾼다. */
export async function createGeoServerWebSession(): Promise<string> {
  const base = getGeoServerInternalBase();
  const user = process.env.GEOSERVER_USER ?? 'admin';
  const pass = process.env.GEOSERVER_PASSWORD ?? 'geoserver';
  const jar = new Map<string, string>();

  await fetchWithJar(`${base}/web/`, jar);

  const login = await fetchWithJar(`${base}/j_spring_security_check`, jar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: user, password: pass }).toString(),
  });
  const location = login.headers.get('location') ?? '';
  if (login.status < 300 || login.status >= 400 || /error=true|GeoServerLoginPage/i.test(location)) {
    throw new Error('GeoServer 로그인에 실패했습니다.');
  }

  let url = `${base}/web/`;
  let html = '';
  for (let i = 0; i < 5; i++) {
    const res = await fetchWithJar(url, jar);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next || /error=true|GeoServerLoginPage/i.test(next)) break;
      url = new URL(next, url).href;
      continue;
    }
    html = await res.text();
    break;
  }
  const sessionId = jar.get('JSESSIONID');
  if (!sessionId || !html.includes('j_spring_security_logout')) {
    throw new Error('GeoServer 로그인에 실패했습니다.');
  }
  return sessionId;
}
