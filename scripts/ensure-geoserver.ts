/**
 * CLI: GeoServer ensure (헬스 → 필요 시 stop/start → ready)
 * 사용: npx tsx scripts/ensure-geoserver.ts
 */
import { ensureGeoServerRunning } from '../src/service/geoserverProcessService';

async function main(): Promise<void> {
  const r = await ensureGeoServerRunning({ forceRestart: false });
  console.log(`[ensure-geoserver] success=${r.success} action=${r.action}${r.error ? ` error=${r.error}` : ''}`);
  process.exit(r.success ? 0 : 1);
}

main().catch((e) => {
  console.error('[ensure-geoserver]', e instanceof Error ? e.message : e);
  process.exit(1);
});
