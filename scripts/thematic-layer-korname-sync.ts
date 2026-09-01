/**
 * 주제도 layer_korname 컬럼 보장·채움 + 자식 CSS를 emd형 라벨로 일괄 갱신.
 *
 * 사용:
 *   npx tsx scripts/thematic-layer-korname-sync.ts build_yy dev
 *   npx tsx scripts/thematic-layer-korname-sync.ts build_yy dev --css-only
 *   npx tsx scripts/thematic-layer-korname-sync.ts build_yy dev --db-only
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';

const LOG = '[thematic-korname-sync]';
const STYLES_DIR = path.join(process.cwd(), 'geoserver_modules/data_dir/styles');

function usage(): never {
  console.log(`
Usage: npx tsx scripts/thematic-layer-korname-sync.ts <project> <type> [--db-only|--css-only]

  project   build_yy 등
  type      dev | demo | prod
`);
  process.exit(1);
}

async function updateCssFiles(): Promise<{ ok: number; skip: number; fail: number }> {
  const tables = (await import('../src/config/defineLayer/tables.json')).default as Array<{
    define_table_name?: string;
    define_table_kor_name?: string;
    define_table_group?: string;
    define_table_parents_layer?: string;
  }>;
  const { KRAS_THEMATIC_DEFINE_GROUPS } = await import(
    '../src/integrations/krasLayerSync.config'
  );
  const {
    buildThematicMapPolygonCss,
    parseSimpleStyleFromCss,
    THEMATIC_MAP_LABEL_EXPRESSION,
    THEMATIC_MAP_LABEL_WITH_ALIAS_EXPRESSION,
    THEMATIC_MAP_LABEL_FONT_SIZE,
    usesThematicAliasLabel,
  } = await import('../src/lib/geoserverStyleUtils');

  const layers: { name: string; korName: string }[] = [];
  for (const t of tables) {
    const group = String(t.define_table_group ?? '').trim();
    if (!(KRAS_THEMATIC_DEFINE_GROUPS as readonly string[]).includes(group)) continue;
    const parent = String(t.define_table_parents_layer ?? '').trim();
    const name = String(t.define_table_name ?? '').trim().toLowerCase();
    if (!parent || !name) continue;
    layers.push({ name, korName: String(t.define_table_kor_name ?? '') });
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let withAlias = 0;
  for (const { name: styleName, korName } of layers.sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const cssPath = path.join(STYLES_DIR, `${styleName}.css`);
    if (!fs.existsSync(cssPath)) {
      skip += 1;
      continue;
    }
    try {
      const body = fs.readFileSync(cssPath, 'utf8');
      const { styleProps } = parseSimpleStyleFromCss(body);
      const useAlias = usesThematicAliasLabel(korName);
      if (useAlias) withAlias += 1;
      const cssBody = buildThematicMapPolygonCss({
        fillColor: styleProps.fillColor ?? '#808080',
        strokeColor: styleProps.strokeColor ?? '#FFFFFF',
        strokeWidth: styleProps.strokeWidth ?? 1,
        opacity: styleProps.opacity ?? 0.3,
        labelField: useAlias
          ? THEMATIC_MAP_LABEL_WITH_ALIAS_EXPRESSION
          : THEMATIC_MAP_LABEL_EXPRESSION,
        size: THEMATIC_MAP_LABEL_FONT_SIZE,
      });
      fs.writeFileSync(cssPath, cssBody.trimEnd() + '\n', 'utf8');
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`${LOG} css fail ${styleName}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`${LOG} CSS alias layers=${withAlias}`);
  return { ok, skip, fail };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const project = args[0];
  const type = args[1];
  if (!project || !type) usage();

  loadProjectEnv(project, type);
  process.env.GGNR_PROJECT = project;
  process.env.GGNR_ENV = type;

  const dbOnly = flags.has('--db-only');
  const cssOnly = flags.has('--css-only');
  const reloadOnly = flags.has('--reload-only');

  console.log(`${LOG} project=${project} type=${type}`);

  if (!cssOnly && !reloadOnly) {
    console.log(`${LOG} DB: layer_korname 보장·채움…`);
    const { fillAllThematicLayerKornames } = await import(
      '../src/integrations/thematicLayerKorname'
    );
    const results = await fillAllThematicLayerKornames();
    const updated = results.reduce((s, r) => s + r.updated, 0);
    const colAdded = results.filter((r) => r.ensuredColumn).length;
    const skipped = results.filter((r) => r.skipped).length;
    console.log(
      `${LOG} DB done parents=${results.length} updatedRows=${updated} colAdded=${colAdded} skipped=${skipped}`
    );
    for (const r of results) {
      if (r.skipped) console.log(`  skip ${r.parentTable}: ${r.skipped}`);
      else
        console.log(
          `  ${r.schema}.${r.parentTable} rules=${r.rules} updated=${r.updated} colAdded=${r.ensuredColumn}`
        );
    }
  }

  if (!dbOnly && !reloadOnly) {
    console.log(`${LOG} CSS: 주제도 자식 스타일 emd형 라벨…`);
    const { ok, skip, fail } = await updateCssFiles();
    console.log(`${LOG} CSS done ok=${ok} skip(no file)=${skip} fail=${fail}`);
  }

  if ((!flags.has('--skip-reload') && !dbOnly && !cssOnly) || reloadOnly) {
    console.log(`${LOG} GeoServer: featuretype 속성 재계산(layer_korname 반영)…`);
    const reloaded = await reloadThematicFeatureTypeAttributes();
    console.log(
      `${LOG} GeoServer reload ok=${reloaded.ok} skip=${reloaded.skip} fail=${reloaded.fail}`
    );
  }

  console.log(`${LOG} 완료 — 지도에서 주제도 라벨 확인`);

  if (!cssOnly || reloadOnly) {
    try {
      const { closePool } = await import('../src/database/db');
      await closePool();
    } catch {
      /* CSS-only without DB import */
    }
  }
}

/** 신규 컬럼이 FeatureType 캐시에 잡히도록 attributes 재계산 */
async function reloadThematicFeatureTypeAttributes(): Promise<{
  ok: number;
  skip: number;
  fail: number;
}> {
  const tables = (await import('../src/config/defineLayer/tables.json')).default as Array<{
    define_table_name?: string;
    define_table_group?: string;
    define_table_parents_layer?: string;
  }>;
  const { KRAS_THEMATIC_DEFINE_GROUPS } = await import(
    '../src/integrations/krasLayerSync.config'
  );
  const { resolveGeoServerFetchBase } = await import('../src/lib/geoserverUrl');

  const names = new Set<string>();
  for (const t of tables) {
    const group = String(t.define_table_group ?? '').trim();
    if (!(KRAS_THEMATIC_DEFINE_GROUPS as readonly string[]).includes(group)) continue;
    const parent = String(t.define_table_parents_layer ?? '').trim();
    const name = String(t.define_table_name ?? '').trim().toLowerCase();
    if (!parent || !name) continue;
    names.add(name);
  }

  const baseUrl = resolveGeoServerFetchBase().replace(/\/$/, '');
  const auth = Buffer.from('admin:geoserver', 'utf8').toString('base64');
  const workspace = 'ggnr';
  const datastore = 'postgres_public_layer';

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const name of [...names].sort()) {
    const resetPath = `/rest/workspaces/${workspace}/datastores/${datastore}/featuretypes/${encodeURIComponent(name)}/reset`;
    try {
      const resetRes = await fetch(`${baseUrl}${resetPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
      if (resetRes.status === 404) {
        skip += 1;
        continue;
      }
      if (resetRes.ok || resetRes.status === 200 || resetRes.status === 204) {
        ok += 1;
        continue;
      }
      // reset 미지원 시 최소 XML + recalculate (전체 JSON PUT은 Windows move 오류 유발)
      const putRes = await fetch(
        `${baseUrl}/rest/workspaces/${workspace}/datastores/${datastore}/featuretypes/${encodeURIComponent(name)}?recalculate=attributes`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/xml',
            Accept: 'application/json',
          },
          body: `<featureType><name>${name}</name></featureType>`,
        }
      );
      if (putRes.ok) ok += 1;
      else {
        fail += 1;
        const text = (await putRes.text()).replace(/\s+/g, ' ').slice(0, 200);
        console.warn(`${LOG} ft reload fail ${name}: ${putRes.status} ${text}`);
      }
    } catch (e) {
      fail += 1;
      console.warn(`${LOG} ft reload fail ${name}:`, e instanceof Error ? e.message : e);
    }
  }

  // 데이터스토어 캐시 일괄 비우기 (있으면)
  try {
    await fetch(`${baseUrl}/rest/workspaces/${workspace}/datastores/${datastore}/reset`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch {
    /* optional */
  }

  return { ok, skip, fail };
}

main().catch((e) => {
  console.error(LOG, e);
  process.exit(1);
});
