import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectEnv } from './load-project-env';

/**
 * 도로망도 스타일 CSS → SLD 변환 후 본 스타일(.sld)로 등록.
 * 지도 서버가 UTF-8(-Dfile.encoding=UTF-8)로 떠 있어야 한글이 깨지지 않는다.
 */
async function main() {
  loadProjectEnv('road_gs', 'dev');
  const { geoserverFetch } = await import('../src/integrations/core');
  const dir = join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');
  for (const name of ['rdl_network_ls', 'rdl_network_ps']) {
    const css = readFileSync(join(dir, `${name}.css`), 'utf8');

    const tmp = `tmp_conv_${name}`;
    await geoserverFetch(`/rest/styles/${tmp}?purge=true`, { method: 'DELETE' });
    let res = await geoserverFetch(`/rest/styles?name=${tmp}`, {
      method: 'POST',
      body: css,
      contentType: 'application/vnd.geoserver.geocss+css; charset=UTF-8',
    });
    if (!res.ok) throw new Error(`${tmp} create ${res.status} ${await res.text()}`);
    res = await geoserverFetch(`/rest/styles/${tmp}.sld`, { accept: 'application/vnd.ogc.sld+xml' });
    if (!res.ok) throw new Error(`${tmp} get sld ${res.status}`);
    const sld = await res.text();
    await geoserverFetch(`/rest/styles/${tmp}?purge=true`, { method: 'DELETE' });

    if (/\uFFFD|&#x[0-9A-F]+;/i.test(sld)) throw new Error(`${name} 변환 SLD 한글 깨짐 — 지도 서버 UTF-8 실행 여부 확인`);
    if (!/[가-힣]/.test(sld)) throw new Error(`${name} 변환 SLD에 한글 조건 없음`);

    res = await geoserverFetch(`/rest/styles/${name}`, {
      method: 'PUT',
      body: `<style><name>${name}</name><format>sld</format><filename>${name}.sld</filename></style>`,
      contentType: 'application/xml',
    });
    if (!res.ok) throw new Error(`${name} info ${res.status} ${await res.text()}`);
    res = await geoserverFetch(`/rest/styles/${name}`, {
      method: 'PUT',
      body: sld,
      contentType: 'application/vnd.ogc.sld+xml; charset=UTF-8',
    });
    console.log(name, res.status, res.ok ? 'ok' : await res.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
