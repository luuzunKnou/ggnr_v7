import https from 'https';
import http from 'http';
import { URL } from 'url';

/** 자체서명 SSL 허용 HTTPS/HTTP POST (v6 NextGenLinkageReceiver 동일) */
export async function postNextGenJson(params: {
  url: string;
  ifId: string;
  srcOrgCd: string;
  srcSysCd: string;
  body: string;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
}): Promise<string> {
  const connectTimeoutMs = params.connectTimeoutMs ?? 10_000;
  const readTimeoutMs = params.readTimeoutMs ?? 30_000;
  const u = new URL(params.url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Accept-Charset': 'UTF-8',
          'Content-Type': 'application/json;charset=UTF-8',
          IF_ID: params.ifId,
          SRC_ORG_CD: params.srcOrgCd,
          SRC_SYS_CD: params.srcSysCd,
          'Content-Length': Buffer.byteLength(params.body, 'utf8'),
        },
        rejectUnauthorized: false,
        timeout: connectTimeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      }
    );
    req.setTimeout(readTimeoutMs, () => {
      req.destroy(new Error(`NextGen read timeout ${readTimeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(params.body, 'utf8');
    req.end();
  });
}
