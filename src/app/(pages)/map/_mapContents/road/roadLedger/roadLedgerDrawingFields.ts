/**
 * 도로대장 도면 레이어(용지도·종평면도·매설물도) — 레이어 관리 항목 정의(한글명·목록/상세 표시·순서).
 */
import { appFetch } from "@/lib/basePath";

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
  define_field_idx?: number | string;
  define_field_show_detail?: boolean | string;
  define_field_show_list?: boolean | string;
};

export type RoadLedgerDrawingField = { name: string; label: string };

export type RoadLedgerDrawingFieldInfo = {
  /** 상세 표시 대상(정렬 완료, geom 제외) */
  detailFields: RoadLedgerDrawingField[];
  /** 목록 열 대상(보기 목록 설정, 정렬 완료, geom 제외) */
  listFields: RoadLedgerDrawingField[];
  /** 필드(소문자) → 한글명 */
  labels: Record<string, string>;
};

const GEOM_LIKE = new Set(["geom", "geometry", "the_geom", "wkb_geometry", "shape"]);

const cache = new Map<string, RoadLedgerDrawingFieldInfo>();
const inflight = new Map<string, Promise<RoadLedgerDrawingFieldInfo>>();

function isFalse(v: unknown): boolean {
  return v === false || String(v ?? "").trim().toLowerCase() === "false";
}

export async function fetchRoadLedgerDrawingFieldInfo(
  defineTableName: string
): Promise<RoadLedgerDrawingFieldInfo> {
  const key = String(defineTableName ?? "").trim().toLowerCase();
  const empty: RoadLedgerDrawingFieldInfo = { detailFields: [], listFields: [], labels: {} };
  if (!key) return empty;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await appFetch(`/api/config/defineLayer/fields/${encodeURIComponent(key)}`);
      const json = (await res.json()) as { data?: DefineFieldRow[] } | DefineFieldRow[];
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const pickShown = (flag: "define_field_show_detail" | "define_field_show_list") =>
        rows
          .map((r, i) => ({
            name: String(r.define_field_name ?? "").trim(),
            label: String(r.define_field_kor_name ?? "").trim(),
            idx: Number(r.define_field_idx),
            order: i,
            hidden: isFalse(r[flag]),
          }))
          .filter((f) => f.name && !f.hidden && !GEOM_LIKE.has(f.name.toLowerCase()))
          .sort((a, b) => {
            const ai = Number.isFinite(a.idx) ? a.idx : Number.MAX_SAFE_INTEGER;
            const bi = Number.isFinite(b.idx) ? b.idx : Number.MAX_SAFE_INTEGER;
            return ai - bi || a.order - b.order;
          })
          .map((f) => ({ name: f.name.toLowerCase(), label: f.label || f.name }));
      const detailFields = pickShown("define_field_show_detail");
      const listFields = pickShown("define_field_show_list");
      const labels: Record<string, string> = {};
      for (const r of rows) {
        const n = String(r.define_field_name ?? "").trim();
        if (n) labels[n.toLowerCase()] = String(r.define_field_kor_name ?? "").trim() || n;
      }
      const info: RoadLedgerDrawingFieldInfo = { detailFields, listFields, labels };
      cache.set(key, info);
      return info;
    } catch {
      return empty;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
