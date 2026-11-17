/**
 * 번호판 4개 테이블 GeoServer 발행 (env 선로드)
 * 사용: npx tsx scripts/setup-plate-maint-geoserver.ts
 */
import { loadProjectEnv } from './load-project-env';

loadProjectEnv('ggnr_ad', 'dev');
process.env.GGNR_PROJECT = 'ggnr_ad';
process.env.GGNR_ENV = 'dev';

async function main() {
  const { createOrUpdateGeoServerLayer, applyDefaultStyleToLayer, getLayerTableList } =
    await import('../src/service/devTestService');

  const list = await getLayerTableList();
  console.log(
    'db tables found',
    (list.tables ?? [])
      .filter((t) => t.table.includes('plate') || t.table.includes('maint'))
      .map((t) => `${t.schema}.${t.table}`)
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
