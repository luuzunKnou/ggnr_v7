import { NextRequest, NextResponse } from 'next/server';
import { SERP_TYPE_READ } from '@/database/schema/serp_map';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getConsoleMenuLevel } from '@/lib/consoleMenuAccess/client';
import { loadConsoleMenuLevels } from '@/lib/consoleMenuAccess/server';
import { getBasePath } from '@/lib/basePath';
import { createGeoServerWebSession } from '@/lib/geoserverWebLogin';
import {
  geoserverSessionCookie,
  isSecurePublicRequest,
  publicOriginFromRequest,
} from '@/lib/geoserverWebProxy';

export const dynamic = 'force-dynamic';

const STYLE_NAME = /^[A-Za-z0-9_.:-]{1,200}$/;

async function styleEditorAccess(): Promise<401 | 403 | null> {
  const usrId = await getSessionUsrId();
  if (!usrId) return 401;
  const levels = await loadConsoleMenuLevels(usrId);
  const dev = getConsoleMenuLevel(levels, 'dev', 'layerManager');
  const sys = getConsoleMenuLevel(levels, 'sysManager', 'layerManager');
  if (dev >= SERP_TYPE_READ || sys >= SERP_TYPE_READ) return null;
  return 403;
}

/** 레이어 관리에서 GeoServer 스타일 편집으로 바로 연다. 앱 세션이 있을 때만 GeoServer에 로그인한다. */
export async function GET(req: NextRequest) {
  const denied = await styleEditorAccess();
  if (denied) {
    const message = denied === 401 ? '로그인이 필요합니다.' : '레이어 관리 권한이 없습니다.';
    return new NextResponse(message, {
      status: denied,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const name = (req.nextUrl.searchParams.get('name') ?? '').trim();
  if (!STYLE_NAME.test(name)) {
    return new NextResponse('스타일 이름이 올바르지 않습니다.', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const sessionId = await createGeoServerWebSession();
    const target = new URL(
      `${getBasePath()}/geoserver/web/wicket/bookmarkable/org.geoserver.wms.web.data.StyleEditPage`,
      publicOriginFromRequest(req)
    );
    target.searchParams.set('name', name);
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        'Cache-Control': 'no-store',
        'Set-Cookie': geoserverSessionCookie(sessionId, isSecurePublicRequest(req)),
      },
    });
  } catch {
    return new NextResponse('GeoServer 스타일 화면을 열지 못했습니다.', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
