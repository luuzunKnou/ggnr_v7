import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * 연계 조회·개인정보 열람 이력.
 * 응답 전문·성명 원문은 저장하지 않음.
 */
export const llq = pgTable(
  'land_linkage_query_log',
  {
    llqKey: serial('llq_key').primaryKey().notNull(),
    /** 한 화면 동작에서 여러 서비스 호출을 묶는 키 */
    llqGroupKey: varchar('llq_group_key'),
    llqAt: timestamp('llq_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    llqUser: varchar('llq_user'),
    /** 접속 IP(프록시 헤더·직접 접속·클라이언트 사설 IP) */
    llqIp: varchar('llq_ip'),
    /** parcelInfo | parcelModal | parcelAnalysis | privateLandAnalysis | cadastralResurvey | smallPublicPlan | officialPrice 등 */
    llqChannel: varchar('llq_channel'),
    /** kras | koreps | vworld */
    llqSystem: varchar('llq_system'),
    /** 업무 시스템 sys_key (road|river|build|wtl 등). 지도 ?system= */
    llqAppSys: varchar('llq_app_sys'),
    /** 업무 시스템 한글명 스냅샷 */
    llqAppSysNm: varchar('llq_app_sys_nm'),
    llqSvcId: varchar('llq_svc_id'),
    llqPnu: varchar('llq_pnu', { length: 19 }),
    llqSgg: varchar('llq_sgg'),
    /** ok | empty | skip | fail */
    llqStatus: varchar('llq_status'),
    llqMs: integer('llq_ms'),
    llqHttp: integer('llq_http'),
    llqMessage: text('llq_message'),
    llqHasPii: boolean('llq_has_pii').notNull().default(false),
    llqPiiViewedAt: timestamp('llq_pii_viewed_at', { withTimezone: true, mode: 'string' }),
    /** 조회 당시 개인정보 마스킹 on/off 스냅샷(통합제어 또는 KRAS 원문 회수) */
    llqPiiMasked: boolean('llq_pii_masked').notNull().default(false),
  },
  (t) => [
    index('llq_at_idx').on(t.llqAt),
    index('llq_pnu_at_idx').on(t.llqPnu, t.llqAt),
    index('llq_svc_at_idx').on(t.llqSvcId, t.llqAt),
    index('llq_group_idx').on(t.llqGroupKey),
    index('llq_user_at_idx').on(t.llqUser, t.llqAt),
    index('llq_pii_viewed_idx').on(t.llqHasPii, t.llqPiiViewedAt),
    index('llq_app_sys_at_idx').on(t.llqAppSys, t.llqAt),
  ]
);

export const llqTableComment = '연계 조회·개인정보 열람 이력';

export const llqColumnComments: Record<string, string> = {
  llq_key: '이력 키',
  llq_group_key: '묶음 키',
  llq_at: '호출 시각',
  llq_user: '사용자',
  llq_ip: '접속 IP',
  llq_channel: '화면 채널',
  llq_system: '연계 시스템(행망·공시지가·브이월드)',
  llq_app_sys: '업무 시스템 키',
  llq_app_sys_nm: '업무 시스템 한글명',
  llq_svc_id: '서비스 ID',
  llq_pnu: '필지번호',
  llq_sgg: '시군구 코드',
  llq_status: '상태(ok|empty|skip|fail)',
  llq_ms: '소요 ms',
  llq_http: 'HTTP 상태',
  llq_message: '결과 메시지',
  llq_has_pii: '개인정보 포함 여부',
  llq_pii_viewed_at: '개인정보 열람 시각',
  llq_pii_masked: '조회 당시 개인정보 마스킹 여부',
};

export type Llq = typeof llq.$inferSelect;
export type NewLlq = typeof llq.$inferInsert;
