import fs from 'node:fs';
import path from 'node:path';

const DEFAULT = 'http://127.0.0.1:8080/geoserver';

/** GEOSERVER_URL → start.ini jetty.http.port → 기본 8080 (00_geoserver_port_helpers.bat 와 동일 우선순위) */
export function resolveGeoServerInternalUrl(): string {
  const fromEnv = process.env.GEOSERVER_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const iniPath = path.join(process.cwd(), 'geoserver_modules', 'geoserver', 'start.ini');
  try {
    if (fs.existsSync(iniPath)) {
      const content = fs.readFileSync(iniPath, 'utf8');
      const match = content.match(/^jetty\.http\.port=(\d+)\s*$/m);
      if (match?.[1] && /^\d+$/.test(match[1])) {
        return `http://127.0.0.1:${match[1]}/geoserver`;
      }
    }
  } catch {
    /* start.ini 읽기 실패 시 기본값 */
  }

  return DEFAULT;
}
