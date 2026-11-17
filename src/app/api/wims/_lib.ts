import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  isWimsConfigured,
  isWimsConnectionFailure,
  WimsNotConfiguredError,
  WimsUnreachableError,
} from '@/lib/wimsOracle';
import type { WimsListQuery, WimsPair, WimsStatQuery } from '@/lib/wimsTypes';

export async function requireUser(): Promise<NextResponse | null> {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  return null;
}

/** WIMS_INFO 없으면 Oracle 시도 전에 막는다. */
export function requireWimsConfigured(): NextResponse | null {
  if (isWimsConfigured()) return null;
  return NextResponse.json(
    {
      error: '수용가 정보 연결 정보가 없습니다.',
      code: 'not_configured',
    },
    { status: 503 }
  );
}

export function wimsError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : '';
  console.error('[wims]', message || err);

  if (err instanceof WimsNotConfiguredError || message.includes('WIMS 연결 정보')) {
    return NextResponse.json(
      { error: '수용가 정보 연결 정보가 없습니다.', code: 'not_configured' },
      { status: 503 }
    );
  }
  if (err instanceof WimsUnreachableError || isWimsConnectionFailure(err)) {
    return NextResponse.json(
      {
        error: '서비스 제공에 문제가 있습니다.',
        code: 'db_unreachable',
      },
      { status: 502 }
    );
  }
  return NextResponse.json(
    { error: '수용가 정보를 조회하지 못했습니다.', code: 'query_failed' },
    { status: 502 }
  );
}

function asPairs(value: unknown): WimsPair[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      const row = item as { customerNo?: unknown; meterNo?: unknown };
      return {
        customerNo: String(row?.customerNo ?? ''),
        meterNo: String(row?.meterNo ?? ''),
      };
    })
    .filter((pair) => pair.customerNo || pair.meterNo);
}

function asKeys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item ?? '')).filter(Boolean);
}

export function readListQuery(body: Record<string, unknown>): WimsListQuery {
  return {
    pairs: asPairs(body.pairs),
    customerNo: body.customerNo == null ? undefined : String(body.customerNo),
    meterNo: body.meterNo == null ? undefined : String(body.meterNo),
    gojikind: body.gojikind == null ? undefined : String(body.gojikind),
    jocode: body.jocode == null ? undefined : String(body.jocode),
    searchKeyword: body.searchKeyword == null ? undefined : String(body.searchKeyword),
    searchKeys: asKeys(body.searchKeys),
    page: Number(body.page) || 1,
    pageSize: Number(body.pageSize) || undefined,
  };
}

export function readStatQuery(body: Record<string, unknown>): WimsStatQuery {
  return {
    pairs: asPairs(body.pairs),
    customerNo: body.customerNo == null ? undefined : String(body.customerNo),
    meterNo: body.meterNo == null ? undefined : String(body.meterNo),
    startYmd: body.startYmd == null ? undefined : String(body.startYmd),
    endYmd: body.endYmd == null ? undefined : String(body.endYmd),
  };
}
