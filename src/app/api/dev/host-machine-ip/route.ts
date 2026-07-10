import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { describeIpv4 } from '@/lib/clientIpDebug';
import { listHostNicIpv4, pickHostMachinePrivateIpv4 } from '@/lib/hostMachineIpv4';

export const dynamic = 'force-dynamic';

/** localhost 등 WebRTC 실패 시 — 서버 PC의 ipconfig 사설 IPv4 (브라우저·서버 동일 머신) */
export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const ip = pickHostMachinePrivateIpv4();
    const nics = listHostNicIpv4();
    return NextResponse.json({
      ip: ip ?? null,
      nics: nics.map((row) => ({
        adapter: row.adapter,
        address: row.address,
        kind: row.kind,
        internal: row.internal,
      })),
      selected: describeIpv4(ip),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'host ip query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
