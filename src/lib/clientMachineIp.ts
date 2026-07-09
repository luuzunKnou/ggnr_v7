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

function extractIpv4FromIceCandidate(candidate: string): string | undefined {
  const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(candidate);
  if (!m) return undefined;
  const ip = m[1];
  if (isLoopbackHost(ip)) return undefined;
  return ip;
}

function candidateType(candidate: string): string | undefined {
  return / typ (\w+)/.exec(candidate)?.[1];
}

function getLocalIpv4ViaWebRtc(): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve(undefined);
      return;
    }

    let settled = false;
    const hostIps: string[] = [];
    const srflxIps: string[] = [];

    const finish = (ip?: string) => {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(ip);
    };

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.createDataChannel('');
    pc.onicecandidate = (ev) => {
      const cand = ev.candidate?.candidate ?? '';
      const ip = extractIpv4FromIceCandidate(cand);
      if (!ip) return;
      const typ = candidateType(cand);
      if (typ === 'srflx' || typ === 'prflx') {
        srflxIps.push(ip);
      } else {
        hostIps.push(ip);
      }
    };
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish());

    setTimeout(() => {
      const privateHost = hostIps.find((ip) => isPrivateIpv4(ip));
      finish(privateHost ?? hostIps[0] ?? srflxIps[0]);
    }, 2000);
  });
}

/** 브라우저가 실행 중인 PC의 IPv4 (접속 URL hostname은 사용하지 않음) */
export async function resolveClientMachineIp(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  if (cachedIp) return cachedIp;

  const rtcIp = await getLocalIpv4ViaWebRtc();
  if (rtcIp) {
    cachedIp = rtcIp;
    return cachedIp;
  }

  return undefined;
}
