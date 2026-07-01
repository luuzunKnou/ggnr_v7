import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { loadUserAccess } from '@/lib/auth/access';
import { isSuperUser } from '@/lib/auth/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const snap = await loadUserAccess(id);
  return NextResponse.json({
    permKeys: snap.permKeys,
    privateSerLevel: snap.privateSerLevel,
    privateSysKeys: snap.privateSysKeys,
    consoleMenuLevel: snap.consoleMenuLevel,
    isSuperUser: isSuperUser(id),
  });
}
