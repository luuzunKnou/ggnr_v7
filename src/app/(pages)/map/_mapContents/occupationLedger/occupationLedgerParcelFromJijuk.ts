import type { OccupationLedgerBinding } from '@/lib/occupationLedgerBinding';
import { parseParcelJibunAddress } from '../road/roadReward/roadRewardMock';
import type { LayerRowParcelItem } from '../../_mapComponents/layerRowEdit';

export type OccupationJijukAutoParcel = {
  address: string;
  pnu?: string;
  extent3857: [number, number, number, number] | null;
  geometry3857?: Record<string, unknown> | null;
  jimok?: string;
  areaSqm?: number;
  intersectAreaSqm?: number;
};

function splitEmdRiJibun(address: string): { emd: string; ri: string; jibun: string } {
  const { eupmyeonDong, jibun } = parseParcelJibunAddress(address);
  const tokens = eupmyeonDong.split(/\s+/).filter(Boolean);
  let emd = '';
  let ri = '';
  for (const t of tokens) {
    if (/(읍|면|동)$/.test(t)) emd = t;
    else if (/리$/.test(t)) ri = t;
  }
  if (!emd && tokens.length > 0) emd = tokens[0] ?? '';
  if (!ri && tokens.length > 1) ri = tokens[tokens.length - 1] ?? '';
  return { emd, ri, jibun };
}

function mergeListValues(
  prev: Record<string, string> | undefined,
  auto: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(auto)) {
    const cur = String(out[k] ?? '').trim();
    if (!cur && String(v ?? '').trim()) out[k] = String(v).trim();
  }
  return out;
}

/** 지적 교차 결과로 채울 수 있는 필지 칸 값 (필드 정의 «상세» 칸 이름 기준) */
export function buildOccupationParcelListValuesFromJijuk(params: {
  binding: OccupationLedgerBinding;
  address: string;
  pnu?: string;
  jimok?: string;
  areaSqm?: number;
  intersectAreaSqm?: number;
  detailFieldKeys: string[];
}): Record<string, string> {
  const { binding, address, pnu, jimok, areaSqm, intersectAreaSqm, detailFieldKeys } = params;
  const f = binding.fields;
  const addr = String(address ?? '').trim();
  const parts = splitEmdRiJibun(addr);
  const area =
    Number.isFinite(intersectAreaSqm) && intersectAreaSqm! > 0
      ? intersectAreaSqm!
      : Number.isFinite(areaSqm) && areaSqm! > 0
        ? areaSqm!
        : null;

  const out: Record<string, string> = {};
  const addrField = String(f.childAddressField ?? '').toLowerCase();
  const partFields = (f.childAddressPartFields ?? []).map((x) => String(x).toLowerCase());

  for (const field of detailFieldKeys) {
    const fl = String(field ?? '').trim();
    if (!fl) continue;
    const lower = fl.toLowerCase();
    if (addrField && lower === addrField) {
      out[fl] = addr;
      continue;
    }
    if (partFields.length >= 1 && lower === partFields[0]) {
      out[fl] = parts.emd;
      continue;
    }
    if (partFields.length >= 2 && lower === partFields[1]) {
      out[fl] = parts.ri;
      continue;
    }
    if (partFields.length >= 3 && lower === partFields[2]) {
      out[fl] = parts.jibun;
      continue;
    }
    if (lower === 'pnu' && pnu) {
      out[fl] = String(pnu).trim();
      continue;
    }
    if (lower.includes('jimok') && jimok) {
      out[fl] = String(jimok).trim();
      continue;
    }
    if (area != null && (lower.includes('area') || lower.includes('ar'))) {
      if (!lower.includes('ratio') && !lower.includes('addr')) {
        out[fl] = String(area);
      }
    }
  }
  return out;
}

function parcelMatchKey(item: { address: string; pnu?: string }): string {
  const pnu = String(item.pnu ?? '').trim();
  if (pnu) return `pnu:${pnu}`;
  return `addr:${String(item.address ?? '').trim().toLowerCase()}`;
}

/** 도형 교차 필지 반영 — 사용자가 입력한 칸은 유지, 주소·지적에서 채울 칸만 갱신 */
export function mergeJijukIntoOccupationParcels(
  prev: LayerRowParcelItem[],
  autoItems: OccupationJijukAutoParcel[],
  binding: OccupationLedgerBinding,
  detailFieldKeys: string[],
  options?: { replaceKept?: boolean }
): LayerRowParcelItem[] {
  const replaceKept = options?.replaceKept === true;
  const manual = prev.filter((p) =>
    replaceKept ? p.showMapGeom === true || p.manualAdd === true : p.showMapGeom === true || p.keepOnReplace === true
  );
  const prevByKey = new Map<string, LayerRowParcelItem>();
  for (const p of prev) {
    prevByKey.set(parcelMatchKey(p), p);
  }

  const autoMapped: LayerRowParcelItem[] = autoItems.map((item) => {
    const address = String(item.address ?? '').trim();
    const key = parcelMatchKey(item);
    const prevRow = prevByKey.get(key) ?? prevByKey.get(parcelMatchKey({ address }));
    const autoList = buildOccupationParcelListValuesFromJijuk({
      binding,
      address,
      pnu: item.pnu,
      jimok: item.jimok,
      areaSqm: item.areaSqm,
      intersectAreaSqm: item.intersectAreaSqm,
      detailFieldKeys,
    });
    const listValues = mergeListValues(prevRow?.listValues, autoList);
    return {
      address,
      pnu: item.pnu || prevRow?.pnu,
      extent3857: item.extent3857 ?? prevRow?.extent3857 ?? null,
      geometry3857: item.geometry3857 ?? prevRow?.geometry3857 ?? null,
      listValues: Object.keys(listValues).length > 0 ? listValues : prevRow?.listValues,
      showMapGeom: false as const,
      keepOnReplace: false as const,
      manualAdd: false as const,
    };
  });

  const seen = new Set(manual.map((p) => parcelMatchKey(p)));
  const merged = [...manual];
  for (const item of autoMapped) {
    const key = parcelMatchKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** 주소 검색 등으로 추가한 필지 — 주소 칸만 미리 채움 */
export function enrichOccupationParcelFromAddress(
  item: LayerRowParcelItem,
  binding: OccupationLedgerBinding,
  detailFieldKeys: string[]
): LayerRowParcelItem {
  const autoList = buildOccupationParcelListValuesFromJijuk({
    binding,
    address: item.address,
    pnu: item.pnu,
    detailFieldKeys,
  });
  const listValues = mergeListValues(item.listValues, autoList);
  return { ...item, listValues: Object.keys(listValues).length > 0 ? listValues : item.listValues };
}
