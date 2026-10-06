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
      'x-kakao-proxy-error': encodeURIComponent(message),
    },
  });
}

function logSnippet(body: string): string {
  return body.replace(/appkey=[^&\s'"]+/gi, 'appkey=(hidden)').replace(/\s+/g, ' ').slice(0, 180);
}

/** 카카오 지도 SDK 프록시 — upstream Referer 를 dggs.kr 로 고정 */
export async function GET(req: NextRequest) {
  try {
    const { KAKAO_MAP_API_KEY: kakaoApiKey } = getMapConfig();
    if (!kakaoApiKey) {
      console.error('[kakao/maps-sdk] 단계=키없음');
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

    if (!upstreamRes.ok) {
      console.error(
        `[kakao/maps-sdk] 단계=카카오응답 status=${upstreamRes.status} body=${logSnippet(body)}`
      );
      return new NextResponse(body, {
        status: upstreamRes.status,
        headers: {
          'content-type': JS_CONTENT_TYPE,
          'cache-control': 'no-cache',
          'x-kakao-proxy-error': encodeURIComponent(`카카오 응답 ${upstreamRes.status}`),
        },
      });
    }

    console.info(`[kakao/maps-sdk] 단계=전달완료 status=${upstreamRes.status} bytes=${body.length}`);
    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: {
        'content-type': JS_CONTENT_TYPE,
        'cache-control': 'no-cache',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kakao/maps-sdk] 단계=카카오접속실패 ${message}`);
    return jsErrorResponse('카카오 지도 SDK 프록시 오류가 발생했습니다.', 500);
  }
}
