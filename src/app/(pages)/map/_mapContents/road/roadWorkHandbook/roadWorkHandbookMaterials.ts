/** 설계실무요령 HWP(2026) 1~12장 — 인용 법규·자료 출처 기준 */

type MaterialFile = {
  name: string
  src: string
  url?: string
}

export type HandbookLawXmlKey = keyof typeof LAW_XML

const LAW_OC = "dggs_service_key"

function lawAdmrulXml(id: string): string {
  return `https://www.law.go.kr/DRF/lawService.do?OC=${LAW_OC}&target=admrul&ID=${id}&type=XML`
}

function lawAdmrulView(id: string): string {
  return `https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=${id}`
}

function lawStatuteXml(mst: string, efYd: string): string {
  return `https://www.law.go.kr/DRF/lawService.do?OC=${LAW_OC}&target=law&MST=${mst}&type=XML&efYd=${efYd}`
}

function lawStatuteView(mst: string, efYd: string): string {
  return `https://www.law.go.kr/DRF/lawService.do?OC=${LAW_OC}&target=law&MST=${mst}&type=HTML&efYd=${efYd}`
}

/** 법령정보센터 Open API — 첨부 XML (비고란). XML 안의 `<첨부파일>`에서 다운로드 URL 추출 */
export const LAW_XML = {
  roadDesign: lawAdmrulXml("2100000254280"),
  roadStructure: lawStatuteXml("286673", "20260603"),
  noiseBarrier: lawAdmrulXml("2100000265182"),
  newTechFee: lawAdmrulXml("2100000003165"),
  designContest: lawAdmrulXml("2100000203171"),
  roadSign: lawStatuteXml("283563", "20260213"),
  engFeeStandard: lawAdmrulXml("2100000230386"),
  roadSafetyGuide: lawAdmrulXml("2100000283726"),
  constructionSafetyGuide: lawAdmrulXml("2100000216960"),
  constructionSupervisorGuide: lawAdmrulXml("2100000003036"),
  orderDetailStandard: lawAdmrulXml("2100000235518"),
  industrialSafetyFee: lawAdmrulXml("2100000254546"),
} as const

/** materialId → 법령 XML API (첨부 조회용) */
export const HANDBOOK_LAW_MATERIAL_IDS: Record<string, HandbookLawXmlKey> = {
  "ch12-road-design": "roadDesign",
  "ch12-road-structure-rule": "roadStructure",
  "ch12-design-contest": "designContest",
  "ch89-road-sign": "roadSign",
  "ch89-noise-barrier": "noiseBarrier",
  "ch89-new-tech-fee": "newTechFee",
  "ch12-ref-06": "engFeeStandard",
  "ch12-ref-07": "roadSafetyGuide",
  "ch12-ref-08": "constructionSafetyGuide",
  "ch12-ref-09": "constructionSupervisorGuide",
  "ch12-ref-17": "industrialSafetyFee",
  "ch12-ref-20": "orderDetailStandard",
}

/** 행정규칙 XML API — `<첨부파일>` 조회 가능 */
export function handbookLawXmlHasAttachmentApi(key: HandbookLawXmlKey): boolean {
  return LAW_XML[key].includes("target=admrul")
}

export function handbookLawMaterialHasAttachments(materialId: string): boolean {
  const key = HANDBOOK_LAW_MATERIAL_IDS[materialId]
  return key ? handbookLawXmlHasAttachmentApi(key) : false
}

export function isHandbookLawMaterialId(materialId: string): boolean {
  return materialId in HANDBOOK_LAW_MATERIAL_IDS
}

export function getHandbookLawXmlApiUrl(materialId: string): string | null {
  const key = HANDBOOK_LAW_MATERIAL_IDS[materialId]
  return key ? LAW_XML[key] : null
}

function refLink(name: string, src: string, url: string): MaterialFile {
  return { name, src, url }
}

/** @internal HWP 비고란 하이퍼링크 */
const LINK = {
  codilRoadBridge:
    "https://www.codil.or.kr/viewDtlConWrkDtlSch.do?pMetaCode=CIGCDC190019&gubun=std",
  codilConcrete: "https://www.codil.or.kr/detailAnwGuide.do?nserialno=1850",
  codilNationalRoad: "https://www.codil.or.kr/detailAnwGuide.do?nserialno=2772",
  codilRiver: "https://www.codil.or.kr/detailAnwGuide.do?nserialno=3517",
  codilDesignDocs:
    "https://www.codil.or.kr/helpdesk/search.do?bbsId=BBSMSTR_900000000204&bbsAttrbCode=BBSA01",
  lawDesignContest: lawAdmrulView("2100000203171"),
  lawRoadDesign: lawAdmrulView("2100000254280"),
  lawRoadStructure: lawStatuteView("286673", "20260603"),
  lawRoadSign: lawStatuteView("283563", "20260213"),
  lawEngFeeStandard: lawAdmrulView("2100000230386"),
  lawRoadSafetyGuide: lawAdmrulView("2100000283726"),
  lawConstructionSafetyGuide: lawAdmrulView("2100000216960"),
  lawConstructionSupervisorGuide: lawAdmrulView("2100000003036"),
  lawOrderDetailStandard: lawAdmrulView("2100000235518"),
  lawConstructionTechLaw: lawStatuteView("276921", "20251001"),
  lawIndustrialSafetyFee: lawAdmrulView("2100000254546"),
  molitRecycledAggregate:
    "https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?gubun=&search=&search_dept_id=&search_dept_nm=&old_search_dept_nm=&psize=10&search_regdate_s=&search_regdate_e=&srch_usr_nm=&srch_usr_num=&srch_usr_year=&srch_usr_titl=&srch_usr_ctnt=&lcmspage=52&idx=15172",
  moisContractReview:
    "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000061&nttId=31722",
  mssDirectPurchaseMaterials:
    "https://mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=127&bcIdx=1055482",
  cakConstructionWage:
    "https://www.cak.or.kr/lay1/bbs/S1T41C42/A/14/list.do",
  etisEngineeringWage:
    "https://www.etis.or.kr/bbsList.do?boardId=TOTALBBS&categorygroup2=TB050",
  kasmSurveyWage:
    "https://www.kasm.or.kr/cop/bbs/selectBbsListVw.do?bbsId=BBSMSTR_000000000019",
  chaBuriedHeritageLabor:
    "https://www.cha.go.kr/gosi/selectGosiView.do?id=1975&pageIndex=1&schWhere=&schDirect=&strWhere=subject&strValue=%eb%a7%a4%ec%9e%a5%ec%9c%a0%ec%82%b0+%ec%a1%b0%ec%82%ac%ec%9d%b8%eb%a0%a5&flag=D&sdate=&edate=&ctcd=&kdcd=&asno=&mnm1=&mn=NS_03_01_05",
  kseisPumsam:
    "https://www.kseis.co.kr/bbs/data/dataDetail.do?bbs_seq=64699193400142&keyfield=title&keyword=%EA%B1%B4%EC%84%A4%EA%B3%B5%EC%82%AC+%ED%91%9C%EC%A4%80%ED%92%88%EC%85%88",
  ppsCostRatio:
    "https://www.pps.go.kr/kor/bbs/view.do?bbsSn=2601060013&key=00038&pageIndex=1&orderBy=bbsOrdr+desc&sc=&sw=",
  lawNoiseBarrier: lawAdmrulView("2100000265182"),
  lawNewTechFee: lawAdmrulView("2100000003165"),
  koroadTrafficManual: "https://www.koroad.or.kr/main/board/21/board_list.do",
  codilRoadGuideAux:
    "https://www.codil.or.kr/viewDtlMoctRoadGuide.do?scCode=MT1&pageIndex=1&sType=RefTypeAll&pMetaCode=CIKCLS122025",
  codilRoadGuideSafety:
    "https://www.codil.or.kr/viewDtlMoctRoadGuide.do?scCode=MT1&pageIndex=1&sType=RefTypeAll&pMetaCode=CIKCLS124029",
  g2bShop: "https://shop.g2b.go.kr/",
  codilStandardMarket:
    "https://www.codil.or.kr/helpdesk/search.do?bbsId=BBSMSTR_900000000204&bbsAttrbCode=BBSA01",
} as const

export const HANDBOOK_MATERIALS = [
  // 1·2장. 적용범위, 실시설계용역
  {
    id: "ch12-road-design",
    chapter: "1·2",
    name: "도로설계기준(국토교통부)",
    source: "법제처 국가법령정보센터 / 행정규칙 / 도로설계기준",
    lawXmlKey: "roadDesign" as const,
    lawViewUrl: LINK.lawRoadDesign,
    files: [],
  },
  {
    id: "ch12-bridge-design",
    chapter: "1·2",
    name: "도로교설계기준",
    source: "국토교통부 / 법령정보 / 행정규칙 / 도로교설계기준",
    files: [
      refLink("도로교설계기준", "건설기술정보시스템", LINK.codilRoadBridge),
    ],
  },
  {
    id: "ch12-bridge-design-lsd",
    chapter: "1·2",
    name: "도로교설계기준(한계상태설계법) 해설",
    source: "도로교설계기준(한계상태설계법) 해설 도서 참조 (한국교량및구조공학회·교량설계핵심기술연구단, 2015)",
    notesOnly: true,
    files: [],
  },
  {
    id: "ch12-concrete-kds",
    chapter: "1·2",
    name: "콘크리트 구조기준 해설(KDS 14 20 00)",
    source: "건설기술정보시스템 / 행정규칙 / 콘크리트 구조기준",
    files: [
      refLink("콘크리트 구조기준 해설(KDS 14 20 00)", "건설기술정보시스템", LINK.codilConcrete),
    ],
  },
  {
    id: "ch12-national-road",
    chapter: "1·2",
    name: "국도건설공사 설계실무요령(국토교통부)",
    source: "건설기술정보시스템 / 건설기준정보 / 국도건설공사 설계실무요령",
    files: [
      refLink("국도건설공사 설계실무요령", "건설기술정보시스템", LINK.codilNationalRoad),
    ],
  },
  {
    id: "ch12-river-design",
    chapter: "1·2",
    name: "하천설계기준(KSD 51 00 00)",
    source: "건설기술정보시스템 / 건설기술정보 / 행정규칙 / 하천설계기준",
    files: [refLink("하천설계기준(KSD 51 00 00)", "건설기술정보시스템", LINK.codilRiver)],
  },
  {
    id: "ch12-road-structure-rule",
    chapter: "1·2",
    name: "도로의 구조·시설 기준에 관한 규칙",
    source: "법제처 국가법령정보센터 / 법령 / 도로의 구조·시설 기준에 관한 규칙",
    lawXmlKey: "roadStructure" as const,
    lawViewUrl: LINK.lawRoadStructure,
    files: [],
  },
  {
    id: "ch12-design-docs",
    chapter: "1·2",
    name: "건설공사의 설계도서 작성기준(국토교통부)",
    source: "건설기술정보시스템 / 건설기술정보 / 행정규칙 / 건설공사의 설계도서 작성기준",
    files: [
      refLink("건설공사의 설계도서 작성기준", "건설기술정보시스템", LINK.codilDesignDocs),
    ],
  },
  {
    id: "ch12-design-contest",
    chapter: "1·2",
    name: "기본설계 등의 시행 및 설계의 경제성 등 검토에 관한 지침(국토교통부 고시)",
    source:
      "법제처 국가법령정보센터 / 행정규칙 / 설계공모, 기본설계 등의 시행 및 설계의 경제성 등 검토에 관한 지침",
    lawXmlKey: "designContest" as const,
    lawViewUrl: LINK.lawDesignContest,
    files: [],
  },
  // 3장. 단가 및 수량산출 기준
  {
    id: "ch3-standard-pumsam",
    chapter: "3",
    name: "건설공사 표준품셈",
    source: "한국표준품셈정보원 / 자료실 / 건설공사 표준품셈",
    files: [refLink("건설공사 표준품셈", "한국표준품셈정보원", LINK.kseisPumsam)],
  },
  // 4장. 품셈 개정 내용
  {
    id: "ch4-standard-pumsam-rev",
    chapter: "4",
    name: "건설공사 표준품셈",
    source: "한국표준품셈정보원 / 자료실 / 건설공사 표준품셈",
    files: [refLink("건설공사 표준품셈(개정)", "한국표준품셈정보원", LINK.kseisPumsam)],
  },
  // 5장. 공사 원가계산 요령
  {
    id: "ch5-cost-ratio",
    chapter: "5",
    name: "원가계산 간접공사비(제비율) 적용기준(조달청)",
    source: "조달청 / 조달업무 / 업무별자료 / 시설공사 / 공사 원가계산 간접공사비(제비율) 적용기준",
    files: [
      refLink(
        "원가계산 간접공사비(제비율) 적용기준",
        "조달청",
        LINK.ppsCostRatio
      ),
    ],
  },
  // 6·7장. 중기사용료 / 공통단가
  {
    id: "ch6-standard-pumsam",
    chapter: "6",
    name: "건설공사 표준품셈",
    source: "한국표준품셈정보원 / 자료실 / 건설공사 표준품셈",
    files: [refLink("건설공사 표준품셈", "한국표준품셈정보원", LINK.kseisPumsam)],
  },
  {
    id: "ch7-standard-pumsam",
    chapter: "7",
    name: "건설공사 표준품셈",
    source: "한국표준품셈정보원 / 자료실 / 건설공사 표준품셈",
    files: [refLink("건설공사 표준품셈", "한국표준품셈정보원", LINK.kseisPumsam)],
  },
  // 8·9장. 교통안전시설
  {
    id: "ch89-road-sign",
    chapter: "8·9",
    name: "도로표지규칙(국토교통부)",
    source: "법제처 국가법령정보센터 / 법령 / 도로표지규칙",
    lawXmlKey: "roadSign" as const,
    lawViewUrl: LINK.lawRoadSign,
    files: [],
  },
  {
    id: "ch89-traffic-manual",
    chapter: "8·9",
    name: "교통안전표지설치 관리 매뉴얼(경찰청)",
    source: "한국도로교통공단 / 교통안전·연구자료실 / 교통안전자료실 / 교통안전표지설치 관리 매뉴얼",
    files: [
      refLink("교통안전표지설치 관리 매뉴얼", "한국도로교통공단", LINK.koroadTrafficManual),
    ],
  },
  {
    id: "ch89-road-design-handbook",
    chapter: "8·9",
    name: "도로설계편람(국토교통부)",
    source: "건설기술정보시스템 / 건설기준정보 / 도로건설 공사기준 / 부대시설, 안전시설",
    files: [
      refLink("도로설계편람 — 부대시설", "건설기술정보시스템", LINK.codilRoadGuideAux),
      refLink("도로설계편람 — 안전시설", "건설기술정보시스템", LINK.codilRoadGuideSafety),
    ],
  },
  {
    id: "ch89-noise-barrier",
    chapter: "8·9",
    name: "방음시설의 성능 및 설치 기준(환경부)",
    source: "법제처 국가법령정보센터 / 행정규칙 / 방음시설의 성능 및 설치기준",
    lawXmlKey: "noiseBarrier" as const,
    lawViewUrl: LINK.lawNoiseBarrier,
    files: [],
  },
  {
    id: "ch89-new-tech-fee",
    chapter: "8·9",
    name: "건설신기술 기술사용료 적용기준(국토교통부)",
    source: "법제처 국가법령정보센터 / 행정규칙 / 건설신기술 기술사용료 적용기준",
    lawXmlKey: "newTechFee" as const,
    lawViewUrl: LINK.lawNewTechFee,
    files: [],
  },
  {
    id: "ch89-related-rules",
    chapter: "8·9",
    name: "관련 지침 및 시행규칙",
    source: "법제처 국가법령정보센터 또는 관련 기관 참조",
    notesOnly: true,
    files: [],
  },
  // 10장. 관급자재
  {
    id: "ch10-g2b",
    chapter: "10",
    name: "조달청",
    source: "조달청 나라장터 / 종합쇼핑몰",
    files: [refLink("나라장터 종합쇼핑몰", "조달청", LINK.g2bShop)],
  },
  // 11장. 표준시장단가 적용
  {
    id: "ch11-standard-market-price",
    chapter: "11",
    name: "표준시장단가",
    source: "건설기술정보시스템 / 건설기준정보 / 표준시장단가",
    files: [refLink("표준시장단가", "건설기술정보시스템", LINK.codilStandardMarket)],
  },
  // 12장
  {
    id: "ch12-ref-01",
    chapter: "12",
    name: "달라지는 건설제도",
    source: "대한건설협회 / 공지‧뉴스 / 달라지는 건설제도",
    files: [
      refLink("달라지는 건설제도", "대한건설협회", "https://www.cak.or.kr/lay1/bbs/S1T8C17/A/5/list.do"),
    ],
  },
  {
    id: "ch12-ref-02",
    chapter: "12",
    name: "환율 및 유류대",
    source: "조달청 / 조달업무 / 업무별자료 / 시설공사 / 환율 및 유류대",
    files: [
      refLink(
        "환율 및 유류대",
        "조달청",
        "https://www.pps.go.kr/kor/bbs/view.do?bbsSn=2601060013&key=00038&pageIndex=1&orderBy=bbsOrdr+desc&sc=&sw="
      ),
    ],
  },
  {
    id: "ch12-ref-03",
    chapter: "12",
    name: "하천토석, 사력채취료",
    source: "경상북도 하천점용료(토석,모래, 자갈의 채취) 고시 참조(경상북도 홈페이지)",
    files: [],
  },
  {
    id: "ch12-ref-04",
    chapter: "12",
    name: "건설자재 가격조사표",
    source: "가격정보, 물가자료, 유통물가, 물가정보, 거래가격 (경상북도 건설자재 가격조사표)",
    notesOnly: true,
    files: [],
  },
  {
    id: "ch12-ref-05",
    chapter: "12",
    name: "노임단가",
    source:
      "대한건설협회 / 건설임금 · 엔지니어링: 한국엔지니어링협회 · 한국공간정보산업협회 · 건설사업관리기술인: 한국건설엔지니어링협회 · 국가유산청 고시",
    files: [
      refLink("건설업 임금실태조사 보고서", "대한건설협회", LINK.cakConstructionWage),
      refLink("엔지니어링업체 임금실태조사 결과공표", "한국엔지니어링협회", LINK.etisEngineeringWage),
      refLink("측량업체 임금실태조사 결과공표", "한국공간정보산업협회", LINK.kasmSurveyWage),
      refLink("매장유산 조사인력 임금단가", "국가유산청", LINK.chaBuriedHeritageLabor),
    ],
  },
  {
    id: "ch12-ref-06",
    chapter: "12",
    name: "건설사업 관리대가기준",
    source: "법제처 국가법령정보센터 / 행정규칙 / 건설엔지니어링 대가 등에 관한 기준",
    lawXmlKey: "engFeeStandard" as const,
    lawViewUrl: LINK.lawEngFeeStandard,
    files: [],
  },
  {
    id: "ch12-ref-07",
    chapter: "12",
    name: "도로안전시설 설치 및 관리지침",
    source: "법제처 국가법령정보센터 / 행정규칙 / 도로안전시설 설치 및 관리지침",
    lawXmlKey: "roadSafetyGuide" as const,
    lawViewUrl: LINK.lawRoadSafetyGuide,
    files: [],
  },
  {
    id: "ch12-ref-08",
    chapter: "12",
    name: "건설공사 안전관리 지침",
    source: "법제처 국가법령정보센터 / 행정규칙 / 건설공사 안전관리 업무수행 지침",
    lawXmlKey: "constructionSafetyGuide" as const,
    lawViewUrl: LINK.lawConstructionSafetyGuide,
    files: [],
  },
  {
    id: "ch12-ref-09",
    chapter: "12",
    name: "건설공사감독자 업무지침",
    source: "법제처 국가법령정보센터 / 행정규칙 / 건설공사감독자업무지침",
    lawXmlKey: "constructionSupervisorGuide" as const,
    lawViewUrl: LINK.lawConstructionSupervisorGuide,
    files: [],
  },
  {
    id: "ch12-ref-10",
    chapter: "12",
    name: "도로분야 표준과업지시서",
    source: "국토교통부 / 공지사항 / 설계용역 표준과업지시서",
    files: [
      refLink(
        "설계용역 표준과업지시서",
        "국토교통부",
        "https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?mode=view&idx=164277"
      ),
    ],
  },
  {
    id: "ch12-ref-11",
    chapter: "12",
    name: "순환골재사용 의무사용량",
    source:
      "국토교통부 / 정책자료 / 법령정보 / 행정규칙 / 순환골재 등 의무사용건설공사의 순환골재·순환골재 재활용제품 사용용도 및 의무사용량에 관한 고시",
    files: [
      refLink(
        "순환골재 등 의무사용건설공사의 순환골재·순환골재 재활용제품 사용용도 및 의무사용량에 관한 고시",
        "국토교통부",
        LINK.molitRecycledAggregate
      ),
    ],
  },
  {
    id: "ch12-ref-12",
    chapter: "12",
    name: "엔지니어링업체 임금실태조사 보고서",
    source: "엔지니어링종합정보시스템 / 통계 / 임금실태 / 엔지니어링업체 임금실태조사 결과공표",
    files: [
      refLink(
        "엔지니어링업체 임금실태조사 결과공표",
        "한국엔지니어링협회",
        "https://www.etis.or.kr/bbsList.do?boardId=TOTALBBS&categorygroup2=TB050"
      ),
    ],
  },
  {
    id: "ch12-ref-13",
    chapter: "12",
    name: "건설업 임금실태조사 보고서",
    source: "대한건설협회 / 지원‧사업 / 건설적산기준 / 건설임금 / 건설업 임금실태조사 보고서",
    files: [
      refLink(
        "건설업 임금실태조사 보고서",
        "대한건설협회",
        "https://www.cak.or.kr/lay1/bbs/S1T41C42/A/14/list.do"
      ),
    ],
  },
  {
    id: "ch12-ref-14",
    chapter: "12",
    name: "표준시장단가 적용기준",
    source: "국토교통부 / 뉴스‧소식 / 공지사항 / 표준시장단가 적용공종 및 단가공고",
    files: [
      refLink(
        "표준시장단가 적용공종 및 단가공고",
        "국토교통부",
        "https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&cate=&mode=view&idx=266541"
      ),
    ],
  },
  {
    id: "ch12-ref-15",
    chapter: "12",
    name: "관급자재 분리발주 대상",
    source: "행정안전부 / 지방자치단체 계약심사 업무처리지침 · 중소벤처기업부 / 공사용 자재 직접구매 대상품목",
    files: [
      refLink(
        "지방자치단체 계약심사 업무처리지침",
        "행정안전부",
        LINK.moisContractReview
      ),
      refLink(
        "중소기업자간 경쟁제품 및 공사용자재 직접구매 대상 품목 지정 내역",
        "중소벤처기업부",
        LINK.mssDirectPurchaseMaterials
      ),
    ],
  },
  {
    id: "ch12-ref-16",
    chapter: "12",
    name: "도로건설공사 측량업무 수행기준",
    source: "도로건설공사 측량업무 수행기준 책자 참조 (경상북도, 2018)",
    notesOnly: true,
    files: [],
  },
  {
    id: "ch12-ref-17",
    chapter: "12",
    name: "품질 및 안전관리비 계상 철저",
    source: "법제처 국가법령정보센터 / 행정규칙 / 건설업 산업안전보건관리비 계상 및 사용기준",
    lawXmlKey: "industrialSafetyFee" as const,
    lawViewUrl: LINK.lawIndustrialSafetyFee,
    files: [],
  },
  {
    id: "ch12-ref-19",
    chapter: "12",
    name: "시공단계의 건설사업관리계획 수립 및 제출에 관한 안내",
    source: "국가법령정보센터 / 법령 / 건설기술 진흥법",
    listAccessLabel: "건설기술 진흥법",
    files: [
      refLink("건설기술 진흥법", "법제처 국가법령정보센터", LINK.lawConstructionTechLaw),
    ],
  },
  {
    id: "ch12-ref-20",
    chapter: "12",
    name: "건설공사 발주 세부기준 및 건설산업기본법 위반 유형",
    source: "국가법령정보센터 / 행정규칙 / 건설공사 발주 세부기준",
    lawXmlKey: "orderDetailStandard" as const,
    lawViewUrl: LINK.lawOrderDetailStandard,
    files: [],
  },
]
