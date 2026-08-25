/**
 * road_reward / road_reward_parcel — 보상편입용지 (PostGIS, layer 스키마)
 * 건·필지 모두 ogc_fid가 고유키. 필지는 reward_key로 부모 건에 조인.
 * DDL: scripts/sql/road_reward.sql , drizzle/0011_road_reward.sql
 */

export const roadRewardTableComment = '보상편입용지';

export const roadRewardColumnComments: Record<string, string> = {
  ogc_fid: '고유키',
  geom: '편입 범위 도형',
  name: '건명',
  org: '조직',
  policy: '정책',
  unit: '단위',
  detail: '세부',
  budget_item: '편성목',
  stat_item: '통계목',
  appraisal1_name: '감정기관1',
  appraisal2_name: '감정기관2',
};

export const roadRewardParcelTableComment = '보상편입용지 필지목록';

export const roadRewardParcelColumnComments: Record<string, string> = {
  ogc_fid: '고유키',
  geom: '지적 필지 도형',
  reward_key: '보상편입용지 ogc_fid',
  pnu: 'PNU',
  eupmyeon_dong: '읍면동',
  jibun_original: '지번(당초)',
  jibun_included: '지번(편입)',
  area_original: '당초면적(㎡)',
  area_included: '편입면적(㎡)',
  jimok: '지목',
  appraisal1_value: '감정평가1(원/㎡)',
  appraisal2_value: '감정평가2(원/㎡)',
  applied_unit_price: '적용단가(원/㎡)',
  compensation_amount: '토지보상금액(원)',
  farming_compensation_amount: '영농보상금액(원)',
  obstacle_compensation_amount: '지장물보상금액(원)',
  owner_address: '토지소유자 주소',
  owner_name: '토지소유자 성명',
  actual_owner: '실소유자',
  actual_cultivator: '실경작자',
  note: '비고',
};
