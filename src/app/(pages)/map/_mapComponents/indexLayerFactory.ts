/**
 * pg_tileserv index.json 유틸
 * - index.json fetch 후 type이 table인 항목 반환
 * - 실제 레이어 생성은 serviceLayerFactory에서 처리
 */
const TILESERV_BASE = process.env.NEXT_PUBLIC_TILESERV_URL || 'http://192.168.120.82:7800';

export type IndexLayerEntry = {
  id: string;
  name?: string;
  schema?: string;
  type?: string;
  description?: string;
  detailurl?: string;
};

type IndexJson = Record<string, IndexLayerEntry>;

/**
 * index.json fetch 후 type이 "table"인 항목 배열 반환
 */
export async function fetchIndexLayers(): Promise<IndexLayerEntry[]> {
  const indexUrl = `${TILESERV_BASE}/index.json`;
  const res = await fetch(indexUrl);
  if (!res.ok) {
    console.warn('[indexLayerFactory] index.json fetch failed:', res.status);
    return [];
  }
  const index = (await res.json()) as IndexJson;
  return Object.entries(index)
    .filter(([, entry]) => entry?.type === 'table')
    .map(([id, entry]) => ({ ...entry, id }));
}

