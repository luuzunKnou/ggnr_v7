/**
 * CLI: 앱 포트 LISTENING PID 강제 해제 (자기·부모 PID 제외)
 * 사용: npx tsx scripts/force-free-port.ts [port]
 */
import { forceFreePort } from '../src/service/geoserverProcessService';

const port = Number(process.argv[2] || process.env.PORT || 3000);
const safe = Number.isFinite(port) && port > 0 ? Math.floor(port) : 3000;
const r = forceFreePort(safe);
console.log(
  `[force-free-port] port=${safe} killed=[${r.killed.join(',')}] errors=${r.errors.length} skippedProtected=[${r.skippedProtected.join(',')}]`
);
process.exit(0);
