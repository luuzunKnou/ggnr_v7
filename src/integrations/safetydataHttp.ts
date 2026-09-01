import type { SafetydataDatasetConfig } from '@/integrations/safetydata.config';

const DEFAULT_KEY_PARAM = 'serviceKey';

const BBOX_PARAM_KEYS = ['startLot', 'endLot', 'startLat', 'endLat'] as const;

function ymdKstDaysAgo(days: number): string {
  const d = new Date();
  d.setTime(d.getTime() - days * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
}

/**
 * `queryParams`만 URL에 붙던 문제 보완:
 * - 데이터셋 `extraRequestParams`에 정의된 항목 중 비어 있으면 합리적 기본값(한반도 bbox, 조회일 등)을 채움
 * - `SAFETYDATA_GLOBAL_BBOX=0` 이면, extra에 bbox가 없을 때는 전역 bbox를 붙이지 않음 (기본은 1 = 전역 bbox 사용)
 */
export function getEffectiveSafetydataQueryParams(cfg: SafetydataDatasetConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.queryParams ?? {})) {
    if (v !== undefined && v !== '') out[k] = v;
  }

  const extraNames = new Set((cfg.extraRequestParams ?? []).map((e) => e.nameEn));
  const hasBboxInExtra = BBOX_PARAM_KEYS.some((k) => extraNames.has(k));

  const envLotS = (process.env.SAFETYDATA_BBOX_START_LOT ?? '').trim();
  const envLotE = (process.env.SAFETYDATA_BBOX_END_LOT ?? '').trim();
  const envLatS = (process.env.SAFETYDATA_BBOX_START_LAT ?? '').trim();
  const envLatE = (process.env.SAFETYDATA_BBOX_END_LAT ?? '').trim();

  const defaultBbox: Record<string, string> = {
    startLot: envLotS || '124',
    endLot: envLotE || '132',
    startLat: envLatS || '33',
    endLat: envLatE || '43',
  };

  const globalBboxOn = (process.env.SAFETYDATA_GLOBAL_BBOX ?? '1').trim() !== '0';

  if (hasBboxInExtra) {
    for (const k of BBOX_PARAM_KEYS) {
      if (extraNames.has(k) && (out[k] === undefined || out[k] === '')) {
        out[k] = defaultBbox[k];
      }
    }
  } else if (globalBboxOn) {
    for (const k of BBOX_PARAM_KEYS) {
      if (out[k] === undefined || out[k] === '') out[k] = defaultBbox[k];
    }
  }

  const lookbackDays = Number(process.env.SAFETYDATA_DEFAULT_DATE_LOOKBACK_DAYS ?? '30');
  const safeLookback = Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 30;

  if (extraNames.has('crtDt') && (out.crtDt === undefined || out.crtDt === '')) {
    out.crtDt = ymdKstDaysAgo(safeLookback);
  }
  if (extraNames.has('inqDt') && (out.inqDt === undefined || out.inqDt === '')) {
    out.inqDt = ymdKstDaysAgo(safeLookback);
  }

  const msrnDays = Number(process.env.SAFETYDATA_DEFAULT_MSRN_LOOKBACK_DAYS ?? '7');
  const safeMsrn = Number.isFinite(msrnDays) && msrnDays > 0 ? msrnDays : 7;
  if (extraNames.has('MSRN_DT') && (out.MSRN_DT === undefined || out.MSRN_DT === '')) {
    out.MSRN_DT = `${ymdKstDaysAgo(safeMsrn)}000000`;
  }

  return out;
}

export function getSafetydataTargetSchema(): string {
  return (process.env.SAFETYDATA_TARGET_SCHEMA ?? 'layer').trim() || 'layer';
}

export function resolveSafetydataDatasetApiKey(cfg: SafetydataDatasetConfig): string {
  const envVar = cfg.apiKeyEnvVar?.trim();
  if (envVar) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv) return fromEnv;
  }
  const k = cfg.apiKey?.trim();
  if (!k) throw new Error(`Missing apiKey for dataset ${cfg.id}`);
  return k;
}

export function hasSafetydataDatasetApiKey(cfg: SafetydataDatasetConfig): boolean {
  const envVar = cfg.apiKeyEnvVar?.trim();
  if (envVar && process.env[envVar]?.trim()) return true;
  return Boolean(cfg.apiKey?.trim());
}

export type SafetydataFetchQuery = {
  pageNo?: number;
  numOfRows?: number;
  returnType?: string;
};

export function buildSafetydataFetchUrl(
  cfg: SafetydataDatasetConfig,
  query: SafetydataFetchQuery = {}
): string {
  const u = new URL(cfg.url);
  const keyParam = cfg.apiKeyQueryParam ?? DEFAULT_KEY_PARAM;
  u.searchParams.set(keyParam, resolveSafetydataDatasetApiKey(cfg));
  u.searchParams.set('returnType', query.returnType ?? 'json');
  u.searchParams.set('pageNo', String(query.pageNo ?? 1));
  u.searchParams.set('numOfRows', String(query.numOfRows ?? 500));
  const merged = getEffectiveSafetydataQueryParams(cfg);
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, v);
  }
  return u.toString();
}
