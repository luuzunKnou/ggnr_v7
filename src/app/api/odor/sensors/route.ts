import { NextResponse } from 'next/server';
import { listSensors } from '@/service/odorSensorService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 악취 센서 목록 — Index 대시보드 기기 상태 */
export async function GET() {
  try {
    const data = await listSensors();
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
