import { NextRequest, NextResponse } from 'next/server';
import { getMapConfig } from '@/service/configService';
import { searchJusoAddress } from '@/lib/jusoAddrLink';

/**
 * 행정안전부 도로명주소 검색 — VWorld 실패 시 클라이언트 폴백
 * GET ?keyword=…&size=5
 */
export async function GET(req: NextRequest) {
  try {
    const keyword = String(req.nextUrl.searchParams.get('keyword') ?? '').trim();
    const sizeRaw = Number(req.nextUrl.searchParams.get('size') ?? '5');
    const maxResults = Number.isFinite(sizeRaw) ? Math.min(Math.max(Math.floor(sizeRaw), 1), 20) : 5;

    if (!keyword) {
      return NextResponse.json({ items: [] }, { status: 200, headers: { 'cache-control': 'no-store' } });
    }

    const map = getMapConfig();
    const confmKey = map.JUSO_CONFM_KEY;
    if (!confmKey) {
      return NextResponse.json(
        { items: [], error: 'JUSO_CONFM_KEY not configured' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }

    const items = await searchJusoAddress({
      keyword,
      confmKey,
      coordConfmKey: map.JUSO_COORD_CONFM_KEY || confmKey,
      vworldKey: map.VWORLD_API_KEY,
      maxResults,
    });

    return NextResponse.json(
      { items },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'juso search failed';
    return NextResponse.json({ items: [], error: message }, { status: 502 });
  }
}
