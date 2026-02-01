/**
 * DevTest Service
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

/**
 * 데이터베이스 연결 테스트 및 정보 조회
 */
export async function testDatabaseConnection() {
  const results: any = {
    timestamp: new Date().toISOString(),
    connection: null,
    postgis: null,
    tables: null,
    functions: null,
    error: null,
  };

  try {
    // 1. 연결 테스트 및 PostgreSQL 버전 확인
    try {
      const connectionResult = await db.execute(
        sql`SELECT NOW() as current_time, version() as pg_version`
      );
      const row = connectionResult.rows[0] as any;
      results.connection = {
        success: true,
        currentTime: row.current_time,
        pgVersion: row.pg_version,
      };
    } catch (error: any) {
      results.connection = {
        success: false,
        error: error.message || 'Connection failed',
      };
      return results;
    }

    // 2. PostGIS 버전 확인
    try {
      const postgisResult = await db.execute(
        sql`SELECT PostGIS_version() as version`
      );
      const row = postgisResult.rows[0] as any;
      results.postgis = {
        available: true,
        version: row.version,
        enabled: true,
      };
    } catch (error: any) {
      results.postgis = {
        available: false,
        version: null,
        enabled: false,
        error: error.message || 'PostGIS check failed',
      };
    }

    // 3. 테이블 목록 조회
    try {
      const tablesResult = await db.execute(
        sql`
          SELECT 
            table_schema,
            table_name,
            table_type
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `
      );
      results.tables = {
        success: true,
        count: tablesResult.rows.length,
        list: tablesResult.rows as Array<{
          table_schema: string;
          table_name: string;
          table_type: string;
        }>,
      };
    } catch (error: any) {
      results.tables = {
        success: false,
        error: error.message || 'Failed to get tables',
        details: error.stack || undefined,
      };
    }

    return results;
  } catch (error: any) {
    results.error = error.message || 'Unknown error occurred';
    return results;
  }
}

/**
 * Tile 서버 연결 테스트 (GET 요청, 10초 타임아웃)
 */
export async function testTileServe(params: { url?: string }) {
  const url = params?.url?.trim();
  if (!url) {
    return { success: false, error: 'URL이 필요합니다.', status: null, statusText: '' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*' },
    });

    clearTimeout(timeout);

    const success = res.ok;
    return {
      success,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? undefined,
      error: success ? undefined : `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (error: any) {
    const message = error.name === 'AbortError' ? '요청 시간 초과 (10초)' : error.message || '연결 실패';
    return { success: false, error: message, status: null, statusText: '' };
  }
}

/**
 * Feature 서버 연결 테스트 (GET 요청, 10초 타임아웃)
 */
export async function testFeatureServ(params: { url?: string }) {
  const url = params?.url?.trim();
  if (!url) {
    return { success: false, error: 'URL이 필요합니다.', status: null, statusText: '' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, application/geo+json, */*' },
    });

    clearTimeout(timeout);

    const success = res.ok;
    let bodyPreview: string | undefined;
    try {
      const text = await res.text();
      bodyPreview = text.length > 200 ? text.slice(0, 200) + '...' : text;
    } catch {
      bodyPreview = undefined;
    }

    return {
      success,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? undefined,
      bodyPreview: success ? bodyPreview : undefined,
      error: success ? undefined : `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (error: any) {
    const message = error.name === 'AbortError' ? '요청 시간 초과 (10초)' : error.message || '연결 실패';
    return { success: false, error: message, status: null, statusText: '' };
  }
}
