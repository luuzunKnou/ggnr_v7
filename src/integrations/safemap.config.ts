/**
 * 생활안전지도(safemap.go.kr) Open API → layer DB 적재용 데이터셋.
 * 재난안전데이터(safetydata.go.kr DSSP)와 출처·키가 다름.
 */

import type { SafetydataDatasetConfig } from '@/integrations/safetydata.config';

const MONTHLY_DEFAULT = { mode: 'monthly' as const, dayOfMonth: 1, hour: 2, minute: 0 };

export const SAFEMAP_DATASETS: SafetydataDatasetConfig[] = [
  {
    id: 'sm-0044',
    url: 'https://www.safemap.go.kr/openapi2/IF_0044',
    apiKey: '',
    apiKeyEnvVar: 'SAFEMAP_API_KEY',
    portalUrl: 'https://www.safemap.go.kr/dvct/data/selectDataAPIDetail.do?dataApiId=62',
    categoryKo: '생활안전정보',
    tableNameKo: '물놀이 관리지역',
    tableNameEn: 'sd_water_play_mgmt_zone',
    refreshSchedule: MONTHLY_DEFAULT,
    skipGlobalBbox: true,
    excludeFromAutoScheduler: true,
    spatial: {
      mode: 'xy',
      geomColumn: 'geom',
      xField: 'x',
      yField: 'y',
      sourceSrid: 3857,
      publishGeoserver: true,
    },
  },
];

export function getSafemapDatasetById(id: string): SafetydataDatasetConfig | undefined {
  return SAFEMAP_DATASETS.find((d) => d.id === id);
}
