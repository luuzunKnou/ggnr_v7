/**
 * 재난안전데이터공유플랫폼 Open API → layer DB 적재용 데이터셋 정의.
 *
 * 호출 URL: https://www.safetydata.go.kr + /V2/api/DSSP-IF-xxxxx
 * serviceKey 는 apiKey 로 붙임.
 */

const API_ORIGIN = 'https://www.safetydata.go.kr';

/** 갱신 주기: 실시간(interval), 월(monthly), 주(weekly) */
export type SafetydataRefreshSchedule =
  | { mode: 'interval'; minutes: number }
  | { mode: 'daily'; hour: number; minute: number }
  | { mode: 'weekly'; weekday: number; hour: number; minute: number }
  | { mode: 'monthly'; dayOfMonth: number; hour: number; minute: number };

/** 포털「요청변수 / 출력결과」표 한 행 */
export type SafetydataApiColumnSpec = {
  nameKo: string;
  nameEn: string;
  type: string;
  /** 포털 표의 항목크기 */
  itemSize?: string;
  /** Y: 필수, N: 선택 */
  required: boolean;
  description: string;
};

/** 모든 OpenAPI 공통 요청변수 (serviceKey, 페이징, returnType) */
export const SAFETYDATA_BASE_REQUEST_PARAMS: SafetydataApiColumnSpec[] = [
  {
    nameKo: '서비스키',
    nameEn: 'serviceKey',
    type: 'STRING',
    itemSize: '50',
    required: true,
    description: '서비스키',
  },
  {
    nameKo: '페이지당개수',
    nameEn: 'numOfRows',
    type: 'NUMBER',
    itemSize: '30',
    required: false,
    description: '페이지당개수',
  },
  {
    nameKo: '페이지번호',
    nameEn: 'pageNo',
    type: 'NUMBER',
    itemSize: '30',
    required: false,
    description: '페이지번호',
  },
  {
    nameKo: '응답타입(json,xml)',
    nameEn: 'returnType',
    type: 'VARCHAR',
    itemSize: '30',
    required: false,
    description: '응답타입(json,xml)',
  },
];

/** 한파·무더위·지진옥외·지진해일·이재민임시주거 등 공통 경위도 박스 필터 */
export const SAFETYDATA_EXTRA_PARAMS_BBOX: SafetydataApiColumnSpec[] = [
  { nameKo: '시작경도', nameEn: 'startLot', type: 'STRING', required: false, description: '시작경도' },
  { nameKo: '종료경도', nameEn: 'endLot', type: 'STRING', required: false, description: '종료경도' },
  { nameKo: '시작위도', nameEn: 'startLat', type: 'STRING', required: false, description: '시작위도' },
  { nameKo: '종료위도', nameEn: 'endLat', type: 'STRING', required: false, description: '종료위도' },
];

export type SafetydataSpatialConfig =
  | {
      /** GeoServer 발행/지도 노출 대상 여부 */
      publishGeoserver?: boolean;
      /** 적재 테이블에 생성할 geometry 컬럼명 (기본: geom) */
      geomColumn?: string;
      /**
       * geometry 생성 방식
       * - auto: 첫 페이지 샘플로 WKT/XY 후보 자동 추론
       * - wkt: WKT 문자열 필드로 geometry 생성
       * - xy: x/y 숫자 필드로 geometry 생성
       * - dms: 경·위도 도·분·초 필드로 geometry 생성
       * - none: geometry 생성 안 함(데이터 테이블만 유지)
       */
      mode: 'auto' | 'wkt' | 'xy' | 'dms' | 'none';
      /** source가 WKT면 그 필드명 (예: GEOM) */
      wktField?: string;
      /** source가 XY면 필드명 */
      xField?: string;
      yField?: string;
      /** source가 DMS면 경도·위도 도·분·초 필드명 */
      lonDegField?: string;
      lonMinField?: string;
      lonSecField?: string;
      latDegField?: string;
      latMinField?: string;
      latSecField?: string;
      /**
       * source 좌표계 (target은 프로젝트 정책상 항상 EPSG:5181)
       * - 'auto': 좌표 값 범위로 4326/3857/5186 등을 추정
       */
      sourceSrid?: number | 'auto';
    }
  | undefined;

/** spatial.mode 가 none 일 때 적재 행을 POI 테이블과 조인해 필터 (예: 병상 실시간) */
export type SafetydataEmdPoiJoinFilter = {
  /** 적재 스키마와 동일 스키마의 POI 테이블명 */
  poiTable: string;
  /** 적재 행 쪽 조인키 (DB 컬럼명 규칙 = safetydataJsonKeyToColumn) */
  localJoinColumn: string;
  /** POI 테이블 조인키 컬럼명 */
  poiJoinColumn: string;
  /**
   * true(기본): POI.geom 이 EMD 합집합과 교차할 때만 INSERT
   * false: POI에 조인키만 일치하면 INSERT (공간 조건 없음)
   */
  requirePoiWithinEmd?: boolean;
};

export type SafetydataDatasetConfig = {
  id: string;
  url: string;
  /** OpenAPI serviceKey (apiKeyEnvVar 없을 때 fallback) */
  apiKey: string;
  /** process.env 에서 serviceKey 를 읽을 변수명 (common.runtime.env 등) */
  apiKeyEnvVar?: string;
  apiKeyQueryParam?: string;
  /** 포털 데이터 상세 페이지 전체 URL */
  portalUrl: string;
  categoryKo: string;
  tableNameKo: string;
  tableNameEn: string;
  refreshSchedule: SafetydataRefreshSchedule;
  queryParams?: Record<string, string>;
  /** 기본 4종 외 API 전용 요청변수 */
  extraRequestParams?: SafetydataApiColumnSpec[];
  /** 오픈API 출력결과(Response Element) — 포털 문서 기준 */
  responseFields?: SafetydataApiColumnSpec[];
  /** 공간(geom) 생성·발행 메타 */
  spatial?: SafetydataSpatialConfig;
  /** geometry 없을 때 POI 조인으로 INSERT 제한 (병상 등) */
  filterWithinEmdViaPoiJoin?: SafetydataEmdPoiJoinFilter;
  /**
   * 적재 전에 먼저 실행할 부모 데이터셋 id (예: 병상→병원 POI, 10분수위→저수지 제원).
   * 스케줄/단건 실행 시 부모가 비어 있으면 조인 필터로 자식이 전부 탈락할 수 있음.
   * 전체 배치에서 선행 항목이 같은 실행에서 이미 돌았으면 integration 쪽에서 skipPrerequisites로 생략 가능.
   */
  ingestPrerequisiteDatasetIds?: string[];
  /** true면 `startSafetydataScheduler` 주기 적재에서 제외(수동·임시 버튼 등) */
  excludeFromAutoScheduler?: boolean;
  /** API 응답 외 적재 테이블에 추가할 컬럼 (예: jibun_addr) */
  derivedColumns?: Array<{ name: string; pgType?: string }>;
  /** COMMIT 후 geom centroid 역지오코딩으로 jibun_addr 채움 */
  fillGeomAddr?: boolean;
};

function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_ORIGIN}${p.split('?')[0]}`;
}

const MONTHLY_DEFAULT = { mode: 'monthly' as const, dayOfMonth: 1, hour: 2, minute: 0 };
const WEEKLY_DEFAULT = { mode: 'weekly' as const, weekday: 1, hour: 3, minute: 0 };
const INTERVAL_5M = { mode: 'interval' as const, minutes: 5 };

/** 포털「요청변수/출력결과」표 기준 responseFields 정의용 */
function portalField(nameKo: string, nameEn: string, itemSize: string): SafetydataApiColumnSpec {
  return {
    nameKo,
    nameEn,
    type: 'STRING',
    itemSize,
    required: true,
    description: nameKo,
  };
}

export const SAFETYDATA_DATASETS: SafetydataDatasetConfig[] = [
  // 비활성: 미사용 적재 (침수흔적도는 safemap IF_0092 WMS)
  // {
  //   id: 'sd-108',
  //   url: apiUrl('/V2/api/DSSP-IF-00117'),
  //   apiKey: '9AYQJY4HOAT0T3F3',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=108',
  //   categoryKo: '재난안전지도',
  //   tableNameKo: '행정안전부_침수흔적도',
  //   tableNameEn: 'sd_mois_flood_trace',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'wkt', geomColumn: 'geom', wktField: 'GEOM', sourceSrid: 3857, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-52',
  //   url: apiUrl('/V2/api/DSSP-IF-00058'),
  //   apiKey: '1BUIZ7R91016VF30',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=52',
  //   categoryKo: '재난안전지도',
  //   tableNameKo: '행정안전부_지역_재해위험지구',
  //   tableNameEn: 'sd_mois_local_disaster_risk_zone',
  //   refreshSchedule: INTERVAL_5M,
  //   spatial: { mode: 'none', publishGeoserver: false },
  // },
  // {
  //   id: 'sd-749',
  //   url: apiUrl('/V2/api/DSSP-IF-10705'),
  //   apiKey: '5Q09HA69C95346UM',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=749',
  //   categoryKo: '재난안전지도',
  //   tableNameKo: '인명피해우려지역',
  //   tableNameEn: 'sd_life_loss_concern_area',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-1267',
  //   url: apiUrl('/V2/api/DSSP-IF-10833'),
  //   apiKey: 'W231829X19XF5822',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1267',
  //   categoryKo: '재난안전지도',
  //   tableNameKo: '물놀이(관리지역)',
  //   tableNameEn: 'sd_water_play_mgmt_zone',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'xcrd', yField: 'ycrd', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-1269',
  //   url: apiUrl('/V2/api/DSSP-IF-10835'),
  //   apiKey: 'DHPP094XK12PW491',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1269',
  //   categoryKo: '재난안전지도',
  //   tableNameKo: '물놀이(위험지역)',
  //   tableNameEn: 'sd_water_play_risk_zone',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'xcrd', yField: 'ycrd', sourceSrid: 4326, publishGeoserver: true },
  // },
  {
    id: 'sd-1066',
    url: apiUrl('/V2/api/DSSP-IF-10187'),
    apiKey: '07AMU84CKT480QX9',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1066',
    categoryKo: '실시간 재난정보',
    tableNameKo: '재난기본',
    tableNameEn: 'sd_disaster_base',
    refreshSchedule: INTERVAL_5M,
    spatial: { mode: 'none', publishGeoserver: false },
    responseFields: [
      portalField('재난연도', 'MSTN_YR', '4'),
      portalField('NDMS재난유형코드', 'NDMS_MSTN_TYPE_CD', '20'),
      portalField('재난일련번호', 'MSTN_SN', '22'),
      portalField('재난명', 'MSTN_NM', '1000'),
      portalField('재난시작일자', 'MSTN_BGNG_YMD', '50'),
      portalField('재난시작시분초', 'MSTN_BGNG_HOMINSEC', '6'),
      portalField('재난종료일자', 'MSTN_END_YMD', '50'),
      portalField('재난종료시분초', 'MSTN_END_HOMINSEC', '14'),
      portalField('입력가능구분자', 'INPT_PSBLTY_SPTR', '5'),
      portalField('복구대상여부', 'RCRY_TRGT_YN', '1'),
      portalField('SOP여부', 'SOP_YN', '2'),
      portalField('재난상태구분자', 'MSTN_STTS_SPTR', '5'),
      portalField('사유시설입력가능여부', 'RSN_FCLT_INPT_PSBLTY_YN', '2'),
      portalField('사유시설버전코드', 'RSN_FCLT_VER_CD', '10'),
      portalField('대국민신고가능여부', 'TONA_DCLR_PSBLTY_YN', '2'),
      portalField('간접지원수정가능여부', 'IDRT_SPRT_MDFCN_PSBLTY_YN', '2'),
      portalField('복구계획버전값', 'RSTR_PLAN_VER_VL', '22'),
      portalField('의연금지원대상재난여부', 'CONTRBUT_SPRT_TRGT_MSTN_YN', '2'),
      portalField('공종버전코드', 'COTY_VER_CD', '10'),
      portalField('최초등록일시', 'FRST_REG_DT', '50'),
      portalField('최종수정일시', 'LAST_MDFCN_DT', '50'),
      portalField('농업재해구분자', 'FAWO_DST_SPTR', '5'),
      portalField('지자체상황진행여부', 'LOCA_SITU_PRGRS_YN', '2'),
    ],
  },
  {
    id: 'sd-751',
    url: apiUrl('/V2/api/DSSP-IF-10714'),
    apiKey: '55Q2K09699JF591R',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=751',
    categoryKo: '실시간 재난정보',
    tableNameKo: '재난구호상황보고정보',
    tableNameEn: 'sd_relief_situation_report',
    refreshSchedule: INTERVAL_5M,
    spatial: { mode: 'none', publishGeoserver: false },
    responseFields: [
      portalField('상황보고관리번호', 'SITU_RPT_MNG_NO', '13'),
      portalField('보고서번호', 'RPTP_NO', '20'),
      portalField('피해일시', 'DAM_DT', '20'),
      portalField('법정동코드', 'STDG_CD', '20'),
      portalField('피해원인내용', 'DAM_CS_CN', '4000'),
      portalField('사망자수', 'DCSD_CNT', '10'),
      portalField('부상자수', 'INJPSN_CNT', '10'),
      portalField('기타인원수', 'ETC_NOPE', '10'),
      portalField('삭제여부', 'DEL_YN', '1'),
      portalField('첨부파일아이디', 'ATCH_FILE_ID', '20'),
      portalField('최초등록일시', 'FRST_REG_DT', '50'),
      portalField('최종수정일시', 'LAST_MDFCN_DT', '50'),
      portalField('재난일련번호', 'MSTN_SN', '22'),
      portalField('재난연도', 'MSTN_YR', '4'),
      portalField('재난유형코드', 'MSTN_TYPE_CD', '10'),
      portalField('대피자이재민기타', 'EVPE_DSSTR_ETC', '2000'),
      portalField('미귀가현황기타', 'UTRH_PRCON_ETC', '2000'),
      portalField('구호활동현황기타', 'SLGN_ACTV_PRCON_ETC', '2000'),
      portalField('임시저장여부', 'TMPR_STRG_YN', '1'),
    ],
  },
  {
    id: 'sd-228',
    url: apiUrl('/V2/api/DSSP-IF-00247'),
    apiKey: 'CH4V38DZGRE19VJN',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=228',
    categoryKo: '실시간 재난정보',
    tableNameKo: '행정안전부_긴급재난문자',
    tableNameEn: 'sd_mois_emergency_disaster_sms',
    refreshSchedule: INTERVAL_5M,
    spatial: { mode: 'none', publishGeoserver: false },
    responseFields: [
      portalField('일련번호', 'SN', '22'),
      portalField('생성일시', 'CRT_DT', '50'),
      portalField('메시지내용', 'MSG_CN', '4000'),
      portalField('수신지역명', 'RCPTN_RGN_NM', '4000'),
      portalField('긴급단계명', 'EMRG_STEP_NM', '100'),
      portalField('재해구분명', 'DST_SE_NM', '100'),
      portalField('등록일자', 'REG_YMD', '50'),
      portalField('수정일자', 'MDFCN_YMD', '50'),
    ],
    extraRequestParams: [
      {
        nameKo: '조회시작일자(YYYYMMDD)',
        nameEn: 'crtDt',
        type: 'STRING',
        required: false,
        description: '조회시작일자(YYYYMMDD)',
      },
      {
        nameKo: '지역명(시도명, 시군구명)',
        nameEn: 'rgnNm',
        type: 'STRING',
        required: false,
        description: '지역명(시도명, 시군구명)',
      },
    ],
  },
  {
    id: 'sd-46',
    url: apiUrl('/V2/api/DSSP-IF-00051'),
    apiKey: 'H20A55N5DQ3C957Y',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=46',
    categoryKo: '실시간 재난정보',
    tableNameKo: '연합뉴스',
    tableNameEn: 'sd_yonhap_news',
    refreshSchedule: INTERVAL_5M,
    spatial: { mode: 'none', publishGeoserver: false },
    responseFields: [
      portalField('연합뉴스번호', 'YNA_NO', '22'),
      portalField('연합뉴스제목', 'YNA_TTL', '1000'),
      portalField('연합뉴스내용', 'YNA_CN', '6000'),
      portalField('연합뉴스일자', 'YNA_YMD', '50'),
      portalField('연합뉴스작성자명', 'YNA_WRTR_NM', '200'),
      portalField('생성일시', 'CRT_DT', '50'),
    ],
    extraRequestParams: [
      {
        nameKo: '조회시작일자(YYYYMMDD)',
        nameEn: 'inqDt',
        type: 'STRING',
        required: false,
        description: '조회시작일자(YYYYMMDD) — 연합뉴스_데이터',
      },
    ],
  },
  {
    id: 'sd-966',
    url: apiUrl('/V2/api/DSSP-IF-10804'),
    apiKey: '63N9U96MOXY378WZ',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=966',
    categoryKo: '재난대응시설',
    tableNameKo: '한파쉼터',
    tableNameEn: 'sd_cold_wave_shelter',
    refreshSchedule: WEEKLY_DEFAULT,
    extraRequestParams: [...SAFETYDATA_EXTRA_PARAMS_BBOX],
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
  },
  {
    id: 'sd-1338',
    url: apiUrl('/V2/api/DSSP-IF-10942'),
    apiKey: '6KNMC4D1915F38S9',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1338',
    categoryKo: '재난대응시설',
    tableNameKo: '무더위쉼터',
    tableNameEn: 'sd_heat_wave_shelter',
    refreshSchedule: WEEKLY_DEFAULT,
    extraRequestParams: [...SAFETYDATA_EXTRA_PARAMS_BBOX],
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lo', yField: 'la', sourceSrid: 4326, publishGeoserver: true },
  },
  {
    id: 'sd-1326',
    url: apiUrl('/V2/api/DSSP-IF-10926'),
    apiKey: '586OXCFB2HND1J67',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1326',
    categoryKo: '재난대응시설',
    tableNameKo: '폭염저감시설',
    tableNameEn: 'sd_heat_mitigation_facility',
    refreshSchedule: WEEKLY_DEFAULT,
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
    derivedColumns: [{ name: 'jibun_addr', pgType: 'text' }],
    fillGeomAddr: true,
  },
  {
    id: 'sd-1339',
    url: apiUrl('/V2/api/DSSP-IF-10943'),
    apiKey: '3WX1X1Q18255VETT',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1339',
    categoryKo: '재난대응시설',
    tableNameKo: '지진옥외대피장소',
    tableNameEn: 'sd_earthquake_outdoor_evac_site',
    refreshSchedule: WEEKLY_DEFAULT,
    extraRequestParams: [...SAFETYDATA_EXTRA_PARAMS_BBOX],
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lo', yField: 'la', sourceSrid: 4326, publishGeoserver: true },
  },
  {
    id: 'sd-1340',
    url: apiUrl('/V2/api/DSSP-IF-10944'),
    apiKey: 'YU2E033G0618PYYL',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1340',
    categoryKo: '재난대응시설',
    tableNameKo: '지진해일 긴급대피장소',
    tableNameEn: 'sd_tsunami_emergency_evac_site',
    refreshSchedule: WEEKLY_DEFAULT,
    extraRequestParams: [...SAFETYDATA_EXTRA_PARAMS_BBOX],
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lo', yField: 'la', sourceSrid: 4326, publishGeoserver: true },
  },
  {
    id: 'sd-1341',
    url: apiUrl('/V2/api/DSSP-IF-10945'),
    apiKey: '73SIIL6049UXN12E',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1341',
    categoryKo: '재난대응시설',
    tableNameKo: '행정안전부_이재민 임시주거시설',
    tableNameEn: 'sd_mois_displaced_temp_housing',
    refreshSchedule: WEEKLY_DEFAULT,
    extraRequestParams: [...SAFETYDATA_EXTRA_PARAMS_BBOX],
    spatial: { mode: 'xy', geomColumn: 'geom', xField: 'LO', yField: 'LA', sourceSrid: 4326, publishGeoserver: true },
  },
  {
    id: 'sd-195',
    url: apiUrl('/V2/api/DSSP-IF-00195'),
    apiKey: '9MY8WB5551G26ECD',
    portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=3526',
    categoryKo: '재난대응시설',
    tableNameKo: '민방위 대피소',
    tableNameEn: 'sd_civil_defense_shelter',
    refreshSchedule: WEEKLY_DEFAULT,
    spatial: {
      mode: 'dms',
      geomColumn: 'geom',
      lonDegField: 'LOT_PROVIN',
      lonMinField: 'LOT_MIN',
      lonSecField: 'LOT_SEC',
      latDegField: 'LAT_PROVIN',
      latMinField: 'LAT_MIN',
      latSecField: 'LAT_SEC',
      sourceSrid: 4326,
      publishGeoserver: true,
    },
    responseFields: [
      portalField('시군구코드', 'SGG_CD', '7'),
      portalField('구분코드', 'SE_CD', '1'),
      portalField('시설코드', 'FCLT_CD', '10'),
      portalField('시설명', 'FCLT_NM', '256'),
      portalField('시설지정일', 'FCLT_DSGN_DAY', '8'),
      portalField('시설구분코드', 'FCLT_SE_CD', '12'),
      portalField('읍면동코드', 'EMD_CD', '12'),
      portalField('읍면동명', 'EMD_NM', '50'),
      portalField('시설주소지번', 'FCLT_ADDR_LOTNO', '256'),
      portalField('시설규모', 'FCLT_SCL', '22'),
      portalField('규모단위', 'SCL_UNIT', '80'),
      portalField('시설주소도로명', 'FCLT_ADDR_RONA', '256'),
      portalField('경도도', 'LOT_PROVIN', '22'),
      portalField('경도분', 'LOT_MIN', '22'),
      portalField('경도초', 'LOT_SEC', '22'),
      portalField('위도도', 'LAT_PROVIN', '22'),
      portalField('위도분', 'LAT_MIN', '22'),
      portalField('위도초', 'LAT_SEC', '22'),
      portalField('지상지하구분', 'GRND_UDGD_SE', '1'),
      portalField('대피가능인원수', 'SHNT_PSBLTY_NOPE', '10'),
      portalField('개방여부', 'OPN_YN', '1'),
      portalField('관리기관명', 'MNG_INST_NM', '200'),
      portalField('평상시활용유형', 'ORTM_UTLZ_TYPE', '20'),
      portalField('관리기관전화번호', 'MNG_INST_TELNO', '11'),
      portalField('도로명코드', 'ROAD_NM_CD', '12'),
    ],
  },
  // 비활성: 미사용 적재 (재난대응시설 패널은 개별 대피소 테이블만 사용)
  // {
  //   id: 'sd-1346',
  //   url: apiUrl('/V2/api/DSSP-IF-10941'),
  //   apiKey: '1Z8Y1I30E526T88Z',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1346',
  //   categoryKo: '재난대응시설',
  //   tableNameKo: '통합대피소(한파, 무더위, 지진옥외, 지진해일)',
  //   tableNameEn: 'sd_integrated_evac_shelter',
  //   refreshSchedule: WEEKLY_DEFAULT,
  //   extraRequestParams: [
  //     ...SAFETYDATA_EXTRA_PARAMS_BBOX,
  //     {
  //       nameKo: '대피소구분코드(한파쉼터:1,무더위쉼터:2,지진옥외대피장소:3,지진해일긴급대피장소:4)',
  //       nameEn: 'shlt_se_cd',
  //       type: 'STRING',
  //       required: false,
  //       description:
  //         '대피소구분코드(한파쉼터:1, 무더위쉼터:2, 지진옥외대피장소:3, 지진해일긴급대피장소:4)',
  //     },
  //   ],
  //   spatial: { mode: 'none', publishGeoserver: false },
  // },
  // 비활성: 병원/병상/저수지(제원·10분) 데이터 품질 이슈로 임시 중단
  // {
  //   id: 'sd-119',
  //   url: apiUrl('/V2/api/DSSP-IF-00128'),
  //   apiKey: 'MB3D5HN5WML0NI69',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=119',
  //   categoryKo: '실시간 병상정보',
  //   tableNameKo: '행정안전부_병의원_POI',
  //   tableNameEn: 'sd_mois_hospital_poi',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'LOT_LAT', yField: 'LAT', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-227',
  //   url: apiUrl('/V2/api/DSSP-IF-00242'),
  //   apiKey: 'S3J2DO5H732XVZ87',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=227',
  //   categoryKo: '실시간 병상정보',
  //   tableNameKo: '국립중앙의료원_의료기관_실시간_병상정보',
  //   tableNameEn: 'sd_nmc_hospital_bed_realtime',
  //   refreshSchedule: INTERVAL_5M,
  //   spatial: { mode: 'none', publishGeoserver: false },
  //   ingestPrerequisiteDatasetIds: ['sd-119'],
  //   filterWithinEmdViaPoiJoin: {
  //     poiTable: 'sd_mois_hospital_poi',
  //     localJoinColumn: 'bfr_inst_id',
  //     poiJoinColumn: 'inst_id',
  //     requirePoiWithinEmd: false,
  //   },
  // },
  // {
  //   id: 'sd-3523',
  //   url: apiUrl('/V2/api/DSSP-IF-20290'),
  //   apiKey: '6LRFX83QGHZ9909X',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=3523',
  //   categoryKo: '저수지수위',
  //   tableNameKo: '저수지제원',
  //   tableNameEn: 'sd_reservoir_master',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-3519',
  //   url: apiUrl('/V2/api/DSSP-IF-20286'),
  //   apiKey: '1OVGX5O24SNQ88HO',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=3519',
  //   categoryKo: '저수지수위',
  //   tableNameKo: '10분저수지수위',
  //   tableNameEn: 'sd_reservoir_level_10min',
  //   refreshSchedule: INTERVAL_5M,
  //   spatial: { mode: 'none', publishGeoserver: false },
  //   ingestPrerequisiteDatasetIds: ['sd-3523'],
  //   filterWithinEmdViaPoiJoin: {
  //     poiTable: 'sd_reservoir_master',
  //     localJoinColumn: 'RSRVR_CD',
  //     poiJoinColumn: 'RSRVR_CD',
  //     requirePoiWithinEmd: false,
  //   },
  //   extraRequestParams: [
  //     {
  //       nameKo: '저수지코드',
  //       nameEn: 'RSRVR_CD',
  //       type: 'STRING',
  //       required: false,
  //       description: '저수지코드',
  //     },
  //     {
  //       nameKo: '조회시작계측일시',
  //       nameEn: 'MSRN_DT',
  //       type: 'STRING',
  //       required: false,
  //       description: '조회시작계측일시',
  //     },
  //   ],
  // },
  // 비활성: 농수로 (개발 임시 버튼은 저수지+병상만 사용)
  // {
  //   id: 'sd-3522',
  //   url: apiUrl('/V2/api/DSSP-IF-20289'),
  //   apiKey: 'M165LZC3DPIQ1NHX',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=3522',
  //   categoryKo: '농수로수위',
  //   tableNameKo: '농수로제원',
  //   tableNameEn: 'sd_farm_canal_master',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-3524',
  //   url: apiUrl('/V2/api/DSSP-IF-20291'),
  //   apiKey: 'F16Y8LR51FJ2H1V1',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=3524',
  //   categoryKo: '농수로수위',
  //   tableNameKo: '10분농수로수위',
  //   tableNameEn: 'sd_farm_canal_level_10min',
  //   refreshSchedule: INTERVAL_5M,
  //   spatial: { mode: 'none', publishGeoserver: false },
  // },
  // 비활성: 미사용 적재
  // {
  //   id: 'sd-876',
  //   url: apiUrl('/V2/api/DSSP-IF-10332'),
  //   apiKey: 'D8596LM8BFTE10Q3',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=876',
  //   categoryKo: '소규모 공공시설',
  //   tableNameKo: '소규모공공시설',
  //   tableNameEn: 'sd_small_public_facility',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'xy', geomColumn: 'geom', xField: 'lot', yField: 'lat', sourceSrid: 4326, publishGeoserver: true },
  // },
  // {
  //   id: 'sd-1128',
  //   url: apiUrl('/V2/api/DSSP-IF-10315'),
  //   apiKey: 'I650WH6HH3LMARN2',
  //   portalUrl: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=1128',
  //   categoryKo: '소규모 공공시설',
  //   tableNameKo: '소규모공공시설안전점검',
  //   tableNameEn: 'sd_small_public_facility_safety_inspection',
  //   refreshSchedule: MONTHLY_DEFAULT,
  //   spatial: { mode: 'none', publishGeoserver: false },
  // },
];

export function getSafetydataDatasetById(id: string): SafetydataDatasetConfig | undefined {
  return SAFETYDATA_DATASETS.find((d) => d.id === id);
}

/** 공통 요청변수 + 데이터셋별 추가 파라미터 */
export function getSafetydataRequestParams(cfg: SafetydataDatasetConfig): SafetydataApiColumnSpec[] {
  return [...SAFETYDATA_BASE_REQUEST_PARAMS, ...(cfg.extraRequestParams ?? [])];
}

/** portalUrl 의 dataSn 쿼리 파싱 */
export function parsePortalDataSn(portalUrl: string): number | null {
  try {
    const u = new URL(portalUrl.trim());
    const raw = u.searchParams.get('dataSn');
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function getSafetydataDatasetByPortalUrl(portalUrl: string): SafetydataDatasetConfig | undefined {
  const n = portalUrl.trim();
  return SAFETYDATA_DATASETS.find((d) => d.portalUrl.trim() === n);
}

export function getSafetydataDatasetByPortalDataSn(dataSn: number): SafetydataDatasetConfig | undefined {
  return SAFETYDATA_DATASETS.find((d) => parsePortalDataSn(d.portalUrl) === dataSn);
}
