import os from 'node:os';

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isUsableIpv4(ip: string): boolean {
  if (ip === '0.0.0.0') return false;
  if (ip.startsWith('127.')) return false;
  return isPrivateIpv4(ip);
}

/** 192.168 > 10.x > 172.16-31 */
function privateIpv4Rank(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts[0] === 192 && parts[1] === 168) return 0;
  if (parts[0] === 10) return 1;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 2;
  return 3;
}

export type HostNicRow = {
  adapter: string;
  address: string;
  internal: boolean;
};

export function listHostNicIpv4(): HostNicRow[] {
  const rows: HostNicRow[] = [];
  const nets = os.networkInterfaces();
  for (const [adapter, entries] of Object.entries(nets)) {
    for (const net of entries ?? []) {
      const family = net.family;
      const isV4 = family === 'IPv4' || (family as string | number) === 4;
      if (!isV4 || !net.address) continue;
      rows.push({
        adapter,
        address: net.address,
        internal: Boolean(net.internal),
      });
    }
  }
  return rows;
}

/** 서버(= localhost 접속 시 같은 PC)의 ipconfig 사설 IPv4 */
export function pickHostMachinePrivateIpv4(): string | undefined {
  const candidates = listHostNicIpv4()
    .filter((row) => !row.internal && isUsableIpv4(row.address))
    .map((row) => row.address);

  const unique = [...new Set(candidates)];
  unique.sort((a, b) => privateIpv4Rank(a) - privateIpv4Rank(b));
  return unique[0];
}
