import { NextRequest, NextResponse } from 'next/server';
import * as allServices from '@/service';

/**
 * 중앙 API 게이트웨이
 * 이 파일은 절대 수정하지 않습니다.
 * 모든 API 요청은 이 엔드포인트를 통해 처리됩니다.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const service = searchParams.get('service');
    const action = searchParams.get('action');
    const paramsStr = searchParams.get('params');

    if (!service || !action) {
      return NextResponse.json(
        { success: false, error: 'service and action are required' },
        { status: 400 }
      );
    }

    // 인증 토큰 확인 (구조만, 나중에 구현)
    const authToken = req.headers.get('authorization')?.replace('Bearer ', '');
    // TODO: 인증 로직 추가

    // Service에서 함수 찾기
    const serviceModule = (allServices as any)[service];
    if (!serviceModule) {
      return NextResponse.json(
        { success: false, error: `Service ${service} not found` },
        { status: 404 }
      );
    }

    const targetFn = serviceModule[action];
    if (typeof targetFn !== 'function') {
      return NextResponse.json(
        { success: false, error: `Function ${action} not found in service ${service}` },
        { status: 404 }
      );
    }

    // 파라미터 파싱
    let params = {};
    if (paramsStr) {
      try {
        params = JSON.parse(paramsStr);
      } catch (e) {
        return NextResponse.json(
          { success: false, error: 'Invalid params format' },
          { status: 400 }
        );
      }
    }

    // 함수 실행
    const result = await targetFn(params);

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    // 403 에러 처리
    if (err.status === 403) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', status: 403 },
        { status: 403 }
      );
    }

    const code = err.code;
    const detail = err.detail;
    const message = err.message || 'Unknown error occurred';
    const errorPayload: Record<string, unknown> = { success: false, error: message };
    if (code) errorPayload.code = code;
    if (detail) errorPayload.detail = detail;
    return NextResponse.json(errorPayload, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { service, action, params = {} } = body;

    if (!service || !action) {
      return NextResponse.json(
        { success: false, error: 'service and action are required' },
        { status: 400 }
      );
    }

    // 인증 토큰 확인 (구조만, 나중에 구현)
    const authToken = req.headers.get('authorization')?.replace('Bearer ', '');
    // TODO: 인증 로직 추가

    // Service에서 함수 찾기
    const serviceModule = (allServices as any)[service];
    if (!serviceModule) {
      return NextResponse.json(
        { success: false, error: `Service ${service} not found` },
        { status: 404 }
      );
    }

    const targetFn = serviceModule[action];
    if (typeof targetFn !== 'function') {
      return NextResponse.json(
        { success: false, error: `Function ${action} not found in service ${service}` },
        { status: 404 }
      );
    }

    // 함수 실행
    const result = await targetFn(params);

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    // 403 에러 처리
    if (err.status === 403) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', status: 403 },
        { status: 403 }
      );
    }

    const code = err.code;
    const detail = err.detail;
    const message = err.message || 'Unknown error occurred';
    const errorPayload: Record<string, unknown> = { success: false, error: message };
    if (code) errorPayload.code = code;
    if (detail) errorPayload.detail = detail;
    return NextResponse.json(errorPayload, { status: 500 });
  }
}
