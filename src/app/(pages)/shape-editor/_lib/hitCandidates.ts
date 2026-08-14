import { extractFeatureKeyForWms } from './wmsFeatureKey';

/** defineLayer 목록 표시용 필드 (한글명) */
export type HitListDisplayField = {
  field: string;
  korName: string;
};

export type ShapeEditorHitCandidate = {
  id: string;
  /** 주 라벨 — 예: «접수번호 12» */
  primaryLabel: string;
  /** 보조 구분 — 예: «홍길동 · 2024-03-15 · 울산…» */
  secondaryLabel: string | null;
  data: Record<string, unknown>;
};

export function hitRowKeyId(keyField: string, keyValue: string): string {
  return `${keyField.toLowerCase()}:${String(keyValue).trim()}`;
}

/** 편집 중·WMS 숨김·미저장 이력 건은 identify에서 제외 (DB 좌표는 아직 옛 위치) */
export function filterIdentifyHitsExcludingKeys(
  features: Array<{ titleValue: string; data: Record<string, unknown> }>,
  tableName: string,
  excludeKeyIds: Set<string>,
  preferredKeyField?: string | null,
  extraCandidates?: string[]
): Array<{ titleValue: string; data: Record<string, unknown> }> {
  if (excludeKeyIds.size === 0) return features;
  return features.filter((f) => {
    const key = extractFeatureKeyForWms(
      f.data,
      preferredKeyField,
      extraCandidates,
      tableName
    );
    if (!key) return true;
    return !excludeKeyIds.has(hitRowKeyId(key.keyField, key.keyValue));
  });
}

function sortKeyValue(raw: string): { num: number | null; text: string } {
  const t = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { num: Number(t), text: t };
  return { num: null, text: t.toLowerCase() };
}

function formatDisplayValue(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const dateOnly = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1]!;
  return s;
}

function cellValue(
  data: Record<string, unknown>,
  field: string
): string {
  const lower = field.toLowerCase();
  const hit = Object.entries(data).find(([k]) => k.toLowerCase() === lower);
  return formatDisplayValue(hit?.[1]);
}

/** 목록·제목 필드로 사용자가 구분할 수 있는 라벨 구성 (기술 키=값 표기 없음) */
function buildUserLabels(
  data: Record<string, unknown>,
  titleValue: string,
  listFields: HitListDisplayField[]
): { primaryLabel: string; secondaryLabel: string | null } {
  const parts: { korName: string; value: string }[] = [];
  for (const f of listFields) {
    const value = cellValue(data, f.field);
    if (!value) continue;
    parts.push({ korName: f.korName, value });
    if (parts.length >= 4) break;
  }

  if (parts.length === 0) {
    const t = String(titleValue ?? '').trim();
    return { primaryLabel: t || '제목 없음', secondaryLabel: null };
  }

  const [first, ...rest] = parts;
  const primaryLabel = `${first!.korName} ${first!.value}`;
  const secondaryLabel =
    rest.length > 0 ? rest.map((p) => p.value).join(' · ') : null;
  return { primaryLabel, secondaryLabel };
}

/** 겹침 목록 — 키로 안정 정렬, 표시는 업무 목록 필드 */
export function buildSortedHitCandidates(
  features: Array<{ titleValue: string; data: Record<string, unknown> }>,
  tableName: string,
  preferredKeyField?: string | null,
  extraCandidates?: string[],
  listFields: HitListDisplayField[] = []
): ShapeEditorHitCandidate[] {
  const items = features.map((f, index) => {
    const key = extractFeatureKeyForWms(
      f.data,
      preferredKeyField,
      extraCandidates,
      tableName
    );
    const id = key
      ? `${key.keyField}:${key.keyValue}`
      : `idx:${index}:${f.titleValue || 'row'}`;
    const { primaryLabel, secondaryLabel } = buildUserLabels(
      f.data,
      f.titleValue,
      listFields
    );
    return {
      id,
      primaryLabel,
      secondaryLabel,
      data: f.data,
      _sort: key
        ? sortKeyValue(key.keyValue)
        : sortKeyValue(primaryLabel),
    };
  });

  items.sort((a, b) => {
    const an = a._sort.num;
    const bn = b._sort.num;
    if (an != null && bn != null) return an - bn;
    if (an != null) return -1;
    if (bn != null) return 1;
    const byText = a._sort.text.localeCompare(b._sort.text, 'ko');
    if (byText !== 0) return byText;
    return a.id.localeCompare(b.id);
  });

  return items.map(({ _sort: _s, ...rest }) => rest);
}
