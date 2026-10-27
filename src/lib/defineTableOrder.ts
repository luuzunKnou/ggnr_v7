import tables from '@/config/defineLayer/tables.json';

type DefineIdxRow = {
  define_table_name?: string;
  define_table_idx?: string | number;
};

const IDX_BY_TABLE = new Map<string, number>();

/**
 * 레이어 설정 «순서» 파싱.
 * 비어 있거나 숫자가 아니면 맨 뒤(999999). 0은 유효 순번(맨 앞).
 */
export function parseDefineTableIdx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return 999999;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : 999999;
}

/** 레이어 설정에 순번 문자열이 있는지 (빈값만 미설정. 0 포함) */
export function hasDefineTableIdx(value: unknown): boolean {
  return String(value ?? '').trim() !== '';
}

for (const row of tables as DefineIdxRow[]) {
  const name = String(row.define_table_name ?? '').trim().toLowerCase();
  if (!name || IDX_BY_TABLE.has(name)) continue;
  IDX_BY_TABLE.set(name, parseDefineTableIdx(row.define_table_idx));
}

export function defineTableIdx(tableName: string): number {
  const key = tableName.trim().toLowerCase();
  if (!key) return 999999;
  return IDX_BY_TABLE.get(key) ?? 999999;
}

/** 순번이 작을수록 앞. 같으면 한글 이름순. */
export function compareDefineTableOrder(
  aIdx: unknown,
  aName: string,
  bIdx: unknown,
  bName: string,
): number {
  const diff = parseDefineTableIdx(aIdx) - parseDefineTableIdx(bIdx);
  if (diff !== 0) return diff;
  return aName.localeCompare(bName, 'ko');
}

type LayerWithOptionalIdx = {
  tableName: string;
  layerName: string;
  /** 런타임 정의(프로젝트 분할 merge 등)에서 온 순서. 있으면 정적 tables.json 보다 우선 */
  tableIdx?: number;
};

/**
 * 레이어 설정 순서로 정렬.
 * `tableIdx`가 있으면 그걸 쓰고, 없으면 tables.json 정적 맵을 본다.
 */
export function sortLayersByDefineIdx<T extends LayerWithOptionalIdx>(
  layers: readonly T[],
): T[] {
  return [...layers].sort((a, b) =>
    compareDefineTableOrder(
      a.tableIdx ?? defineTableIdx(a.tableName),
      a.layerName,
      b.tableIdx ?? defineTableIdx(b.tableName),
      b.layerName,
    ),
  );
}
