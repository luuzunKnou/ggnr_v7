import { NextRequest, NextResponse } from 'next/server';
import { getMapConfig } from '@/service/configService';

const JS_CONTENT_TYPE = 'application/javascript; charset=UTF-8';
const KAKAO_SDK_UPSTREAM = 'https://dapi.kakao.com/v2/maps/sdk.js';
const KAKAO_REFERER = 'https://dggs.kr/';

function jsErrorResponse(message: string, status: number) {
  return new NextResponse(`console.error(${JSON.stringify(message)});`, {
    status,
    headers: {
      'content-type': JS_CONTENT_TYPE,
      'cache-control': 'no-cache',
    },
  });
}

/** 카카오 지도 SDK 프록시 — upstream Referer 를 dggs.kr 로 고정 */
export async function GET(req: NextRequest) {
  try {
    const { KAKAO_MAP_API_KEY: kakaoApiKey } = getMapConfig();
    if (!kakaoApiKey) {
      console.error('[kakao/maps-sdk] KAKAO_MAP_API_KEY가 설정되어 있지 않습니다.');
      return jsErrorResponse('카카오 API 키가 설정되어 있지 않습니다.', 500);
    }

    const autoload = req.nextUrl.searchParams.get('autoload') ?? 'false';
    const upstreamUrl = new URL(KAKAO_SDK_UPSTREAM);
    upstreamUrl.searchParams.set('appkey', kakaoApiKey);
    upstreamUrl.searchParams.set('autoload', autoload);

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Referer: KAKAO_REFERER,
        'User-Agent': 'Mozilla/5.0',
        Accept: '*/*',
      },
    });

    const body = await upstreamRes.text();

    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: {
        'content-type': JS_CONTENT_TYPE,
        'cache-control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[kakao/maps-sdk] proxy error', error);
    return jsErrorResponse('카카오 지도 SDK 프록시 오류가 발생했습니다.', 500);
  }
}
