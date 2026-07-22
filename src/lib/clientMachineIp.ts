let cachedIp: string | undefined;

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isUsableHostIpv4(ip: string): boolean {
  if (ip === '0.0.0.0') return false;
  return isPrivateIpv4(ip) && !isLoopbackHost(ip);
}

/** 192.168(실제 LAN) > 10.x > 172.16-31(가상 스위치 등) */
function privateIpv4Rank(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts[0] === 192 && parts[1] === 168) return 0;
  if (parts[0] === 10) return 1;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 2;
  return 3;
}

function pickBestPrivateIpv4(ips: string[]): string | undefined {
  const priv = [...new Set(ips.filter(isUsableHostIpv4))];
  if (priv.length === 0) return undefined;
  priv.sort((a, b) => privateIpv4Rank(a) - privateIpv4Rank(b));
  return priv[0];
}

function extractIpv4FromIceCandidate(candidate: string): string | undefined {
  const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(candidate);
  if (!m) return undefined;
  const ip = m[1];
  if (!isUsableHostIpv4(ip)) return undefined;
  return ip;
}

function candidateType(candidate: string): string | undefined {
  return / typ (\w+)/.exec(candidate)?.[1];
}

function extractIpv4FromSdp(sdp: string): string[] {
  const ips: string[] = [];
  for (const raw of sdp.split('\n')) {
    const line = raw.trim();
    const cMatch = /^c=IN IP4 (\d{1,3}(?:\.\d{1,3}){3})/.exec(line);
    if (cMatch?.[1] && isUsableHostIpv4(cMatch[1])) ips.push(cMatch[1]);
    if (!line.startsWith('a=candidate:')) continue;
    const parts = line.split(/\s+/);
    const ip = parts[4];
    if (ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && isUsableHostIpv4(ip)) ips.push(ip);
  }
  return ips;
}

async function extractIpv4FromGetStats(pc: RTCPeerConnection): Promise<string[]> {
  const ips: string[] = [];
  try {
    const stats = await pc.getStats();
    stats.forEach((report) => {
      if (report.type !== 'local-candidate' && report.type !== 'candidate-pair') return;
      const row = report as RTCStats & { address?: string; ip?: string };
      const addr = row.address ?? row.ip;
      if (addr && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr) && isUsableHostIpv4(addr)) ips.push(addr);
    });
  } catch {
    /* ignore */
  }
  return ips;
}

function readCandidateAddress(candidate: RTCIceCandidate | null): string | undefined {
  if (!candidate) return undefined;
  const row = candidate as RTCIceCandidate & { address?: string };
  const addr = row.address?.trim();
  if (addr && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr) && isUsableHostIpv4(addr)) return addr;
  return undefined;
}

async function fetchHostMachineIpFromServer(): Promise<string | undefined> {
  try {
    const res = await fetch('/api/dev/host-machine-ip', { cache: 'no-store' });
    const json = (await res.json()) as { ip?: string | null };
    if (!res.ok || !json.ip) return undefined;
    return isUsableHostIpv4(json.ip) ? json.ip : undefined;
  } catch {
    return undefined;
  }
}

function collectHostIpv4ViaWebRtc(): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve(undefined);
      return;
    }

    let settled = false;
    const hostIps: string[] = [];

    const finish = async () => {
      if (settled) return;
      settled = true;

      const sdp = pc.localDescription?.sdp ?? '';
      if (sdp) hostIps.push(...extractIpv4FromSdp(sdp));
      hostIps.push(...(await extractIpv4FromGetStats(pc)));

      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(pickBestPrivateIpv4(hostIps));
    };

    const pc = new RTCPeerConnection({ iceServers: [] });

    pc.createDataChannel('');
    pc.onicecandidate = (ev) => {
      const cand = ev.candidate?.candidate ?? '';
      if (!cand) {
        if (ev.candidate === null) void finish();
        return;
      }
      const ip = readCandidateAddress(ev.candidate) ?? extractIpv4FromIceCandidate(cand);
      const typ = candidateType(cand);
      if (ip && typ !== 'srflx' && typ !== 'relay' && typ !== 'prflx') {
        hostIps.push(ip);
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') void finish();
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => void finish());

    setTimeout(() => void finish(), 5000);
  });
}

/** 브라우저 PC 사설 IPv4 (localhost·공인 IP·접속 URL hostname 미사용) */
export async function resolveClientMachineIp(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  if (cachedIp && isUsableHostIpv4(cachedIp)) return cachedIp;

  const rtcIp = await collectHostIpv4ViaWebRtc();
  if (rtcIp && isUsableHostIpv4(rtcIp)) {
    cachedIp = rtcIp;
    return cachedIp;
  }

  const serverNicIp = await fetchHostMachineIpFromServer();
  if (serverNicIp && isUsableHostIpv4(serverNicIp)) {
    cachedIp = serverNicIp;
    return cachedIp;
  }

  cachedIp = undefined;
  return undefined;
}

/** dev 화면 진입 시 미리 조회 — 작업 클릭 전 WebRTC 수집 시간 확보 */
export function prefetchClientMachineIp(): void {
  if (typeof window === 'undefined') return;
  void resolveClientMachineIp();
}
