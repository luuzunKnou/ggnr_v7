import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectEnv } from './load-project-env';

async function main() {
  loadProjectEnv('river_yd', 'dev');
  process.env.GEOSERVER_URL = 'http://127.0.0.1:8090/geoserver';
  const { geoserverFetch } = await import('../src/integrations/core');
  const css = readFileSync(
    join(process.cwd(), 'geoserver_modules/data_dir/styles/river_d_plan_jb_lm.css'),
    'utf8'
  );
  const res = await geoserverFetch('/rest/styles/river_d_plan_jb_lm', {
    method: 'PUT',
    body: css,
    contentType: 'application/vnd.geoserver.geocss+css; charset=UTF-8',
  });
  console.log('PUT status', res.status);
  console.log('PUT body', await res.text());

  const ft = await geoserverFetch(
    '/rest/workspaces/ggnr/datastores/postgres_layer/featuretypes/river_d_plan_jb_lm.json'
  );
  console.log('FT status', ft.status);
  if (ft.ok) {
    const j = (await ft.json()) as {
      featureType?: { attributes?: { attribute?: Array<{ name?: string }> } };
    };
    const attrs = j?.featureType?.attributes?.attribute;
    if (Array.isArray(attrs)) console.log('attrs', attrs.map((a) => a.name).join(', '));
  } else {
    console.log(await ft.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
