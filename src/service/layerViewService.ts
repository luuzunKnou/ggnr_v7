import { pool } from '@/database/db';

const INDEX_URL = 'http://192.168.120.82:7800/index.json';
const VIEW_SCHEMA = 'public_layer';
const VIEW_NAME = 'serviceLayerView';

type IndexEntry = {
  type?: string;
  id?: string;
  name?: string;
  schema?: string;
  [key: string]: unknown;
};

type IndexJson = Record<string, IndexEntry>;

/**
 * index.json에서 type이 table인 모든 레이어 ID 목록 반환
 */
async function fetchTableIds(): Promise<string[]> {
  const res = await fetch(INDEX_URL);
  const index = (await res.json()) as IndexJson;
  return Object.entries(index)
    .filter(([, entry]) => entry?.type === 'table')
    .map(([id]) => id);
}

/** 뷰 생성 시 제외할 테이블명 접두사 */
const EXCLUDED_TABLE_PREFIXES = [
  'bml', 'cit', 'lsmd', 'ufl',
  'ub', 'ud', 'ue', 'uf',
  'uh', 'ui', 'uj', 'um', 'un', 'uo', 'up', 'uq',
];

function isExcludedTable(layerId: string): boolean {
  const tableName = layerId.includes('.') ? layerId.slice(layerId.indexOf('.') + 1) : layerId;
  return EXCLUDED_TABLE_PREFIXES.some((prefix) => tableName.startsWith(prefix));
}

/**
 * layer_id(schema.name)를 PostgreSQL 식별자로 이스케이프
 * 예: layer.bike -> "layer"."bike", public_layer.bjd -> "public_layer"."bjd"
 */
function quoteTableRef(layerId: string): string {
  const dot = layerId.indexOf('.');
  if (dot === -1) return `"${layerId}"`;
  const schema = layerId.slice(0, dot);
  const table = layerId.slice(dot + 1);
  return `"${schema}"."${table}"`;
}

/** ST_Simplify 허용 오차 (줌에 따라 선 단순화 → 데이터 크기 감소) */
const SIMPLIFY_TOLERANCE = 0.0001;

/**
 * serviceLayerView 뷰 생성 SQL 생성
 * - layer_name, geom (ST_Simplify 적용)
 */
function buildCreateViewSql(layerIds: string[]): string {
  const selects = layerIds.map((layerId) => {
    const ref = quoteTableRef(layerId);
    return `  SELECT '${layerId.replace(/'/g, "''")}'::text AS layer_name, ST_Simplify(t.geom, ${SIMPLIFY_TOLERANCE})::geometry(Geometry, 5181) AS geom FROM ${ref} t`;
  });
  const unionAll = selects.join('\n  UNION ALL\n');
  return `
CREATE SCHEMA IF NOT EXISTS "${VIEW_SCHEMA}";
CREATE OR REPLACE VIEW "${VIEW_SCHEMA}"."${VIEW_NAME}" AS
${unionAll};
`.trim();
}

export type CreateServiceLayerViewParams = {
  execute?: boolean;
  /** 포함할 레이어 ID 목록. 있으면 이 목록만 뷰에 포함 (index에 있는 것만 사용) */
  layerIds?: string[];
  /** 레이어 ID에 이 문자열이 포함된 것만 뷰에 포함. layerIds가 있으면 무시됨. 예: 'wtl' */
  layerFilter?: string;
};

export type CreateServiceLayerViewResult = {
  viewName: string;
  layerCount: number;
  sql?: string;
  executed?: boolean;
  error?: string;
};

/**
 * index.json 기준으로 serviceLayerView 뷰 생성
 * @param params.execute true이면 DB에 실행, false이면 SQL만 반환
 * @param params.layerIds 포함할 레이어 ID만 지정 시 해당 레이어만 뷰에 포함 (성능 개선)
 * @param params.layerFilter 레이어 ID에 포함된 문자열로 필터. 예: 'wtl' → wtl 포함 ID만
 * @returns 뷰명, 레이어 수, (실행 시) 실행 여부 / (미실행 시) 생성할 SQL
 */
export async function createServiceLayerView(
  params: CreateServiceLayerViewParams = {}
): Promise<CreateServiceLayerViewResult> {
  const { execute = false, layerIds: paramLayerIds, layerFilter } = params;

  let layerIds: string[];

  if (Array.isArray(paramLayerIds) && paramLayerIds.length > 0) {
    const allIds = await fetchTableIds();
    const indexSet = new Set(allIds);
    layerIds = paramLayerIds.filter((id) => indexSet.has(id) && !isExcludedTable(id));
  } else {
    layerIds = await fetchTableIds();
    layerIds = layerIds.filter((id) => {
      const tableName = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
      return !tableName.startsWith('serviceLayerView') && !isExcludedTable(id);
    });
    if (layerFilter && layerFilter.trim() !== '') {
      const filter = layerFilter.trim();
      layerIds = layerIds.filter((id) => id.includes(filter));
    }
  }

  if (layerIds.length === 0) {
    return {
      viewName: `${VIEW_SCHEMA}.${VIEW_NAME}`,
      layerCount: 0,
      error: 'index.json에서 table 타입 레이어가 없거나, 필터/지정 목록에 맞는 레이어가 없습니다.',
    };
  }

  const sql = buildCreateViewSql(layerIds);

  if (!execute) {
    return {
      viewName: `${VIEW_SCHEMA}.${VIEW_NAME}`,
      layerCount: layerIds.length,
      sql,
      executed: false,
    };
  }

  try {
    await pool.query(sql);
    return {
      viewName: `${VIEW_SCHEMA}.${VIEW_NAME}`,
      layerCount: layerIds.length,
      executed: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      viewName: `${VIEW_SCHEMA}.${VIEW_NAME}`,
      layerCount: layerIds.length,
      sql,
      executed: false,
      error: message,
    };
  }
}
