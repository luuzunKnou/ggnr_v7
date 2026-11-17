import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectEnv } from './load-project-env';

/** 제방 스타일 CSS를 GeoServer REST에 PUT (문법 검증·반영) */
async function main() {
  loadProjectEnv('river_yd', 'dev');
  if (!process.env.GEOSERVER_URL?.trim()) {
    process.env.GEOSERVER_URL = 'http://127.0.0.1:8090/geoserver';
  }
  const { geoserverFetch } = await import('../src/integrations/core');
  const dir = join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');
  for (const name of ['river_d_plan_jb_lm', 'river_plan_s_jb_lm']) {
    const css = readFileSync(join(dir, `${name}.css`), 'utf8');
    const res = await geoserverFetch(`/rest/styles/${name}`, {
      method: 'PUT',
      body: css,
      contentType: 'application/vnd.geoserver.geocss+css; charset=UTF-8',
    });
    const text = res.ok ? 'ok' : await res.text();
    console.log('PUT', name, res.status, String(text).slice(0, 500));

    const get = await geoserverFetch(`/rest/styles/${name}.css`, {
      accept: 'application/vnd.geoserver.geocss+css',
    });
    console.log('GET', name, get.status, (await get.text()).slice(0, 400));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
