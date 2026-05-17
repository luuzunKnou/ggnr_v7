import { NextRequest } from 'next/server';
import { proxyVworldGet } from '@/lib/vworldProxy';

export async function GET(req: NextRequest) {
  return proxyVworldGet(req, 'https://api.vworld.kr/ned/data/getLandCharacteristics');
}
