/**
 * data_dir/styles 내 심볼 URL을 start.ini·GEOSERVER_URL 포트 기준 절대 URL로 통일.
 * start-geoserver.bat·npm run geoserver:sync-symbol-urls 에서 호출.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rewriteGeoServerSymbolUrlsInStyleText } from '../src/lib/geoserverSymbolPath';
import { resolveGeoServerInternalUrl } from './resolve-geoserver-url';

const STYLES_DIR = path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');

function main(): void {
  const geoserverBase = resolveGeoServerInternalUrl();
  console.log(`[sync-symbol-urls] GeoServer base: ${geoserverBase}`);

  if (!fs.existsSync(STYLES_DIR)) {
    console.warn(`[sync-symbol-urls] styles dir not found: ${STYLES_DIR}`);
    process.exit(0);
  }

  const entries = fs.readdirSync(STYLES_DIR, { withFileTypes: true });
  let changed = 0;

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!/\.(css|sld)$/i.test(ent.name)) continue;
    if (/^tmp/i.test(ent.name)) continue;

    const filePath = path.join(STYLES_DIR, ent.name);
    const before = fs.readFileSync(filePath, 'utf8');
    const after = rewriteGeoServerSymbolUrlsInStyleText(before, geoserverBase);
    if (after === before) continue;

    fs.writeFileSync(filePath, after, 'utf8');
    changed += 1;
    console.log(`[sync-symbol-urls] updated ${ent.name}`);
  }

  console.log(`[sync-symbol-urls] done (${changed} file(s) changed)`);
}

main();
