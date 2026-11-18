/**
 * 번호판 관련 4개 테이블 → defineLayer + GeoServer 세팅
 * 사용: npx tsx scripts/setup-plate-maint-define-layer.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '../src/lib/defineLayerTableRowOrder';
import {
  createOrUpdateGeoServerLayer,
  applyDefaultStyleToLayer,
} from '../src/service/devTestService';

loadProjectEnv('ggnr_ad', 'dev');
process.env.GGNR_PROJECT = 'ggnr_ad';
process.env.GGNR_ENV = 'dev';

const ROOT = process.cwd();
const TABLES_PATH = path.join(ROOT, 'src', 'config', 'defineLayer', 'tables.json');
const FIELDS_DIR = path.join(ROOT, 'src', 'config', 'defineLayer', 'fields');

type FieldDef = {
  name: string;
  kor: string;
  type: 'NUMBER' | 'TEXT' | 'GEOMETRY';
  isKey?: boolean;
  showList?: boolean;
  showSearch?: boolean;
  showDetail?: boolean;
  showTitle?: boolean;
};

function fieldRow(f: FieldDef, idx: number) {
  const isKey = !!f.isKey;
  const isGeom = f.type === 'GEOMETRY';
  const showList = f.showList === false || isKey || isGeom ? 'false' : 'true';
  const showDetail = f.showDetail === false || isKey || isGeom ? 'false' : 'true';
  const showSearch =
    f.showSearch === true ? 'true' : f.showSearch === false || isKey || isGeom ? '' : 'true';
  return {
    define_field_name: f.name,
    define_field_kor_name: f.kor,
    define_field_is_required: isKey ? 'true' : '',
    define_field_show_search: showSearch,
    define_field_show_list: showList,
    define_field_show_detail: showDetail,
    define_field_type: f.type,
    define_field_sel_list: '',
    define_field_read_only: isKey ? 'true' : '',
    define_field_is_key: isKey ? 'true' : 'false',
    define_field_show_search_detail: '',
    define_field_max_length: '',
    define_field_idx: String(idx),
    define_field_sort_idx: isKey ? '0' : '',
    define_field_sort_type: isKey ? 'DESC' : 'ASC',
    define_field_sel_table: '',
    define_field_sel_query: '',
    define_field_sel_url: '',
    define_field_show_detail_list: 'false',
    define_field_sel_key_field: '',
    define_field_sel_label_field: '',
    define_field_default_value: '',
    define_field_show_title: f.showTitle ? 'true' : '',
  };
}

const TABLES: Array<{
  name: string;
  kor: string;
  fields: FieldDef[];
}> = [
  {
    name: 'building_number_plate',
    kor: '건물번호판 보수요청',
    fields: [
      { name: 'id', kor: 'ID', type: 'NUMBER', isKey: true },
      { name: 'year', kor: '연도', type: 'NUMBER', showSearch: true },
      { name: 'seq_no', kor: '순번', type: 'NUMBER', showSearch: true },
      { name: 'emd_nm', kor: '행정동', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'road_nm', kor: '도로명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'bunji_main', kor: '본번', type: 'TEXT', showSearch: true },
      { name: 'bunji_sub', kor: '부번', type: 'TEXT', showSearch: true },
      { name: 'status', kor: '상태', type: 'TEXT', showSearch: true },
      { name: 'remark', kor: '비고', type: 'TEXT' },
      { name: 'req_date', kor: '요청일', type: 'TEXT', showSearch: true },
      { name: 'geom', kor: '위치', type: 'GEOMETRY' },
    ],
  },
  {
    name: 'road_name_plate_maint',
    kor: '도로명판 유지보수(산불피해)',
    fields: [
      { name: 'id', kor: 'ID', type: 'NUMBER', isKey: true },
      { name: 'seq_no', kor: 'No', type: 'NUMBER', showSearch: true },
      { name: 'emd_nm', kor: '행정동', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'facility', kor: '설치시설물', type: 'TEXT', showSearch: true },
      { name: 'plate_type', kor: '종류', type: 'TEXT', showSearch: true },
      { name: 'road_nm', kor: '도로명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'bunji_main', kor: '앞면시작본번', type: 'TEXT', showSearch: true },
      { name: 'bunji_sub', kor: '앞면시작부번', type: 'TEXT', showSearch: true },
      { name: 'bunji_main_end', kor: '앞면종료본번', type: 'TEXT' },
      { name: 'bunji_sub_end', kor: '앞면종료부번', type: 'TEXT' },
      { name: 'geom', kor: '위치', type: 'GEOMETRY' },
    ],
  },
  {
    name: 'basic_number_plate_maint',
    kor: '기초번호판 유지보수(산불피해)',
    fields: [
      { name: 'id', kor: 'ID', type: 'NUMBER', isKey: true },
      { name: 'seq_no', kor: 'No', type: 'NUMBER', showSearch: true },
      { name: 'emd_nm', kor: '행정동', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'facility', kor: '도로시설물', type: 'TEXT', showSearch: true },
      { name: 'road_nm', kor: '도로명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'bunji_main', kor: '기초번호본번', type: 'TEXT', showSearch: true },
      { name: 'bunji_sub', kor: '기초번호부번', type: 'TEXT', showSearch: true },
      { name: 'use_target', kor: '사용대상', type: 'TEXT', showSearch: true },
      { name: 'spec', kor: '규격', type: 'TEXT' },
      { name: 'check_result', kor: '점검결과', type: 'TEXT', showSearch: true },
      { name: 'geom', kor: '위치', type: 'GEOMETRY' },
    ],
  },
  {
    name: 'temp_housing_plate_maint',
    kor: '임시주택 건물번호판',
    fields: [
      { name: 'id', kor: 'ID', type: 'NUMBER', isKey: true },
      { name: 'seq_no', kor: 'No', type: 'NUMBER', showSearch: true },
      { name: 'emd_nm', kor: '행정동', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'category', kor: '구분', type: 'TEXT', showSearch: true },
      { name: 'road_nm', kor: '도로명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'bunji_main', kor: '본번', type: 'TEXT', showSearch: true },
      { name: 'bunji_sub', kor: '부번', type: 'TEXT', showSearch: true },
      { name: 'install_state', kor: '설치상태', type: 'TEXT', showSearch: true },
      { name: 'house_cnt', kor: '동수', type: 'TEXT' },
      { name: 'remark', kor: '비고', type: 'TEXT' },
      { name: 'geom', kor: '위치', type: 'GEOMETRY' },
    ],
  },
];

async function main() {
  const raw = fs.readFileSync(TABLES_PATH, 'utf-8');
  let tables: Record<string, unknown>[] = JSON.parse(raw);
  if (!Array.isArray(tables)) throw new Error('tables.json is not array');

  for (const t of TABLES) {
    const exists = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === t.name
    );
    const row = reorderDefineLayerTableRow({
      define_table_name: t.name,
      define_table_kor_name: t.kor,
      define_table_shp_type: 'POINT',
      define_table_read_share: 'P',
      define_table_write_share: 'P',
      // 미소속 그룹 → 데이터조회에서 전 시스템 노출
      define_table_group: '번호판',
      define_table_idx: '0',
      define_table_etc: '',
      define_table_schema: 'layer',
      define_table_source: 'excel',
    });
    if (exists) {
      Object.assign(exists, row);
    } else {
      tables.push(row);
    }

    const fields = t.fields.map((f, i) => fieldRow(f, i + 1));
    const fieldsPath = path.join(FIELDS_DIR, `table_${t.name}.json`);
    fs.writeFileSync(fieldsPath, JSON.stringify(fields, null, 2), 'utf-8');
    console.log(`[define] fields ${t.name} (${fields.length})`);
  }

  tables = reorderDefineLayerTablesArray(tables);
  fs.writeFileSync(TABLES_PATH, JSON.stringify(tables, null, 2), 'utf-8');
  console.log('[define] tables.json updated');

  for (const t of TABLES) {
    const layerRes = await createOrUpdateGeoServerLayer({ layerName: t.name });
    console.log(`[geoserver] layer ${t.name}:`, layerRes.success ? 'ok' : layerRes.error);
    if (!layerRes.success) continue;
    const styleRes = await applyDefaultStyleToLayer({ layerName: t.name });
    console.log(
      `[geoserver] style ${t.name}:`,
      styleRes.success ? 'ok' : ('error' in styleRes ? styleRes.error : 'fail')
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
