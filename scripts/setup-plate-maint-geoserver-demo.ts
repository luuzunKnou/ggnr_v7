/**
 * 번호판 4개 테이블 → 안동 시연 GeoServer 발행
 * 사용: npx tsx scripts/setup-plate-maint-geoserver-demo.ts
 */
import { loadProjectEnv } from './load-project-env';

loadProjectEnv('ggnr_ad', 'demo');
process.env.GGNR_PROJECT = 'ggnr_ad';
process.env.GGNR_ENV = 'demo';
process.env.GEOSERVER_URL = 'http://192.168.126.64:8090/geoserver';

async function main() {
  const { createOrUpdateGeoServerLayer, applyDefaultStyleToLayer } = await import(
    '../src/service/devTestService'
  );

  const names = [
    'building_number_plate',
    'road_name_plate_maint',
    'basic_number_plate_maint',
    'temp_housing_plate_maint',
  ];

  for (const name of names) {
    const layerRes = await createOrUpdateGeoServerLayer({ layerName: name });
    console.log(`[layer] ${name}:`, layerRes.success ? 'ok' : layerRes.error);
    if (!layerRes.success) continue;
    const styleRes = await applyDefaultStyleToLayer({ layerName: name });
    console.log(
      `[style] ${name}:`,
      styleRes.success ? 'ok' : 'error' in styleRes ? styleRes.error : 'fail'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
