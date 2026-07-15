import { COORDINATE_SYSTEM_OPTIONS } from '@/app/(pages)/map/_mapComponents/landInfo/shared';

const ORIGIN_KEYWORDS = ['서부', '중부', '제주', '동부', '울릉', '위경도'];

/**
 * "GRS중부60", "중부60", "중부 60만" 등 COORDINATE_SYSTEM_OPTIONS 라벨과 느슨하게 일치하는
 * 텍스트에서 EPSG 코드를 추정한다. 원점 키워드(서부/중부/제주/동부/울릉/위경도) + 축척 숫자(50/55/60)가
 * 모두 텍스트에 포함되면 매칭으로 본다.
 */
export function matchEpsgFromLooseText(text: string): string | null {
  const normalized = text.replace(/\s+/g, '');
  if (!normalized) return null;
  for (const opt of COORDINATE_SYSTEM_OPTIONS) {
    const origin = ORIGIN_KEYWORDS.find((k) => opt.label.includes(k));
    if (!origin || !normalized.includes(origin)) continue;
    const scaleMatch = opt.label.match(/(\d{2})만/);
    if (!scaleMatch || normalized.includes(scaleMatch[1])) {
      return opt.code;
    }
  }
  return null;
}
