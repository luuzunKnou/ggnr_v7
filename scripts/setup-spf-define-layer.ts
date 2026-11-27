/**
 * layer.spf_* 6개 → defineLayer(tables/fields) 등록.
 * geom 있는 spf_fac 만 GeoServer 발행·type별 CSS 시도.
 *
 * 사용: npx tsx scripts/setup-spf-define-layer.ts --project ggnr_sy --env dev
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadProjectEnv } from './load-project-env'
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '../src/lib/defineLayerTableRowOrder'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

const ROOT = process.cwd()
const TABLES_PATH = path.join(ROOT, 'src', 'config', 'defineLayer', 'tables.json')
const FIELDS_DIR = path.join(ROOT, 'src', 'config', 'defineLayer', 'fields')
const GROUP = '소규모공공시설'

type FieldDef = {
  name: string
  kor: string
  type: 'NUMBER' | 'TEXT' | 'GEOMETRY'
  isKey?: boolean
  showList?: boolean
  showSearch?: boolean
  showDetail?: boolean
  showTitle?: boolean
}

type TableDef = {
  name: string
  kor: string
  /** 빈 문자열 = 속성만(도형 없음) */
  shpType: '' | 'POINT' | 'LINE' | 'POLYGON'
  etc?: string
  fields: FieldDef[]
  publishGeoServer?: boolean
}

function fieldRow(f: FieldDef, idx: number) {
  const isKey = !!f.isKey
  const isGeom = f.type === 'GEOMETRY'
  const showList = f.showList === false || isKey || isGeom ? 'false' : 'true'
  const showDetail = f.showDetail === false || isKey || isGeom ? 'false' : 'true'
  const showSearch =
    f.showSearch === true ? 'true' : f.showSearch === false || isKey || isGeom ? '' : 'true'
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
  }
}

const TABLES: TableDef[] = [
  {
    name: 'spf_fac',
    kor: '소규모 공공시설',
    shpType: 'LINE',
    etc: 'geom 혼재(점·선). 스타일은 type(소교량·낙차공·취입보=점, 세천·농로·마을진입로=선)',
    publishGeoServer: true,
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'cons_code', kor: '관리번호', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'sisul_name', kor: '시설명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'shp_code', kor: '도형코드', type: 'TEXT', showSearch: true },
      { name: 'type', kor: '유형', type: 'TEXT', showSearch: true },
      { name: 'emd', kor: '읍면명', type: 'TEXT', showSearch: true },
      { name: 'ri', kor: '리명', type: 'TEXT', showSearch: true },
      { name: 'address', kor: '주소', type: 'TEXT', showSearch: true },
      { name: 'start_xy', kor: '시점좌표', type: 'TEXT', showList: false },
      { name: 'end_xy', kor: '종점좌표', type: 'TEXT', showList: false },
      { name: 'ben_area', kor: '수혜지역', type: 'TEXT' },
      { name: 'risk_date', kor: '위험시설지정일', type: 'TEXT', showSearch: true },
      { name: 'candidate', kor: '후보지구분', type: 'TEXT', showSearch: true },
      { name: 'lne', kor: '연장(m)', type: 'TEXT' },
      { name: 'width', kor: '폭(m)', type: 'TEXT' },
      { name: 'hight', kor: '높이(m)', type: 'TEXT' },
      { name: 'parent_fac_id', kor: '부모시설키', type: 'NUMBER', showList: false },
      { name: 'parent_fac_name', kor: '부모시설명', type: 'TEXT', showList: false },
      { name: 'geom', kor: '도형', type: 'GEOMETRY' },
    ],
  },
  {
    name: 'spf_eval',
    kor: '후보지평가',
    shpType: '',
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'fac_id', kor: '시설키', type: 'NUMBER', showSearch: true },
      { name: 'eval_date', kor: '평가일', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'evaluator', kor: '평가자', type: 'TEXT', showSearch: true },
      { name: 'result', kor: '선정결과', type: 'TEXT', showSearch: true },
      { name: 'remark', kor: '비고', type: 'TEXT' },
    ],
  },
  {
    name: 'spf_report',
    kor: '안전점검 보고서',
    shpType: '',
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'year', kor: '점검년도', type: 'NUMBER', showSearch: true, showTitle: true },
      { name: 'write_date', kor: '작성일', type: 'TEXT', showSearch: true },
      { name: 'title', kor: '제목(보고서명)', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'agency', kor: '점검기관', type: 'TEXT', showSearch: true },
      { name: 'author', kor: '작성자', type: 'TEXT', showSearch: true },
      { name: 'target_count', kor: '대상 수', type: 'NUMBER' },
    ],
  },
  {
    name: 'spf_check',
    kor: '점검결과',
    shpType: '',
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'fac_id', kor: '시설키', type: 'NUMBER', showSearch: true },
      { name: 'report_id', kor: '보고서키', type: 'NUMBER', showSearch: true },
      { name: 'risk_score', kor: '합계점수', type: 'NUMBER', showSearch: true },
      { name: 'surv_date', kor: '점검일', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'surv_name', kor: '점검자', type: 'TEXT', showSearch: true },
      { name: 'risk_rank', kor: '등급', type: 'TEXT', showSearch: true },
      { name: 'candidate', kor: '평가구분', type: 'TEXT', showSearch: true },
      { name: 'remark', kor: '기타의견', type: 'TEXT' },
    ],
  },
  {
    name: 'spf_plan',
    kor: '정비계획 연도',
    shpType: '',
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'start_year', kor: '시작연도', type: 'NUMBER', showSearch: true, showTitle: true },
      { name: 'end_year', kor: '종료연도', type: 'NUMBER', showSearch: true, showTitle: true },
    ],
  },
  {
    name: 'spf_plan_fac',
    kor: '정비계획 목록',
    shpType: '',
    fields: [
      { name: 'id', kor: '키', type: 'NUMBER', isKey: true },
      { name: 'plan_id', kor: '정비연도키', type: 'NUMBER', showSearch: true },
      { name: 'fac_id', kor: '시설키', type: 'NUMBER', showSearch: true },
      { name: 'unit_name', kor: '시설명', type: 'TEXT', showSearch: true, showTitle: true },
      { name: 'location', kor: '위치(읍면동리)', type: 'TEXT', showSearch: true },
      { name: 'final_rank', kor: '최종(우선순위)', type: 'NUMBER', showSearch: true },
      { name: 'workload_m', kor: '사업량(m)', type: 'NUMBER' },
      { name: 'cost_mil', kor: '사업비', type: 'NUMBER' },
      { name: 'done_rate', kor: '정비율(%)', type: 'NUMBER' },
      { name: 'after5_qty', kor: '5개년 후 사업량', type: 'NUMBER', showList: false },
      { name: 'after5_cost_mil', kor: '5개년 후 사업비', type: 'NUMBER', showList: false },
      { name: 'y1_qty', kor: '1년차 사업량', type: 'NUMBER', showList: false },
      { name: 'y1_cost_mil', kor: '1년차 사업비', type: 'NUMBER', showList: false },
      { name: 'y2_qty', kor: '2년차 사업량', type: 'NUMBER', showList: false },
      { name: 'y2_cost_mil', kor: '2년차 사업비', type: 'NUMBER', showList: false },
      { name: 'y3_qty', kor: '3년차 사업량', type: 'NUMBER', showList: false },
      { name: 'y3_cost_mil', kor: '3년차 사업비', type: 'NUMBER', showList: false },
      { name: 'y4_qty', kor: '4년차 사업량', type: 'NUMBER', showList: false },
      { name: 'y4_cost_mil', kor: '4년차 사업비', type: 'NUMBER', showList: false },
      { name: 'y5_qty', kor: '5년차 사업량', type: 'NUMBER', showList: false },
      { name: 'y5_cost_mil', kor: '5년차 사업비', type: 'NUMBER', showList: false },
      { name: 'effect_people', kor: '수혜자', type: 'TEXT', showList: false },
      { name: 'effect_farm_ha', kor: '농경지ha', type: 'TEXT', showList: false },
      { name: 'effect_building', kor: '건물동', type: 'TEXT', showList: false },
      { name: 'status', kor: '상태', type: 'TEXT', showSearch: true },
    ],
  },
]

async function main() {
  const project = argValue('--project') || 'ggnr_sy'
  const env = argValue('--env') || 'dev'
  loadProjectEnv(project, env)
  process.env.GGNR_PROJECT = project
  process.env.GGNR_ENV = env

  const raw = fs.readFileSync(TABLES_PATH, 'utf-8')
  let tables: Record<string, unknown>[] = JSON.parse(raw)
  if (!Array.isArray(tables)) throw new Error('tables.json is not array')

  for (const t of TABLES) {
    const exists = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === t.name
    )
    const row = reorderDefineLayerTableRow({
      define_table_name: t.name,
      define_table_kor_name: t.kor,
      define_table_shp_type: t.shpType,
      define_table_read_share: 'P',
      define_table_write_share: 'P',
      define_table_group: GROUP,
      define_table_idx: '0',
      define_table_etc: t.etc ?? '',
      define_table_schema: 'layer',
      define_table_source: t.shpType ? 'shp' : 'excel',
    })
    if (exists) Object.assign(exists, row)
    else tables.push(row)

    const fields = t.fields.map((f, i) => fieldRow(f, i + 1))
    const fieldsPath = path.join(FIELDS_DIR, `table_${t.name}.json`)
    fs.writeFileSync(fieldsPath, JSON.stringify(fields, null, 2), 'utf-8')
    console.log(`[define] ${t.name} (${t.kor}) fields=${fields.length}`)
  }

  tables = reorderDefineLayerTablesArray(tables)
  fs.writeFileSync(TABLES_PATH, JSON.stringify(tables, null, 2), 'utf-8')
  console.log('[define] tables.json updated, spf count=', TABLES.length)

  const { buildSpfFacCss } = await import('../src/lib/geoserverStyles/spfFacStyle')
  const cssBody = buildSpfFacCss()
  const dataDir = process.env.GGNR_DATA_DIR?.trim()
  if (dataDir) {
    const styleDir = path.join(dataDir, 'styles')
    fs.mkdirSync(styleDir, { recursive: true })
    const cssPath = path.join(styleDir, 'spf_fac.css')
    fs.writeFileSync(cssPath, cssBody, 'utf-8')
    console.log('[style] wrote', cssPath)
  }

  const { createOrUpdateGeoServerLayer, applyDefaultStyleToLayer, putGeoServerCssStyle } = await import(
    '../src/service/devTestService'
  )
  for (const t of TABLES.filter((x) => x.publishGeoServer)) {
    const layerRes = await createOrUpdateGeoServerLayer({ layerName: t.name })
    console.log(`[geoserver] layer ${t.name}:`, layerRes.success ? 'ok' : layerRes.error)
    const putStyle = await putGeoServerCssStyle({ name: t.name, cssBody })
    console.log(`[geoserver] css ${t.name}:`, putStyle.success ? 'ok' : putStyle.error)
    if (layerRes.success) {
      const styleRes = await applyDefaultStyleToLayer({ layerName: t.name })
      console.log(
        `[geoserver] style ${t.name}:`,
        styleRes.success ? 'ok' : 'error' in styleRes ? styleRes.error : 'fail'
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
