import type View from "ol/View";

type PaddingQuad = [number, number, number, number];

function readViewPadding(view: View): PaddingQuad {
  const raw = (view as unknown as { padding?: number[] }).padding;
  if (!Array.isArray(raw) || raw.length !== 4) return [0, 0, 0, 0];
  const nums = raw.map((v) => Number(v));
  if (!nums.every((v) => Number.isFinite(v))) return [0, 0, 0, 0];
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

/**
 * view.padding(패널 오프셋)을 포함한 fit padding 계산.
 * basePadding은 도형 주변 여백용(상/우/하/좌) 추가값.
 */
export function getFitPaddingWithView(view: View, basePadding: PaddingQuad): PaddingQuad {
  const [vt, vr, vb, vl] = readViewPadding(view);
  return [
    vt + basePadding[0],
    vr + basePadding[1],
    vb + basePadding[2],
    vl + basePadding[3],
  ];
}
