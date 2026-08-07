export type GroundwaterPermitField = {
  key: string
  label: string
}

export type GroundwaterPermitSection = {
  id: string
  title: string
  fields: GroundwaterPermitField[]
}

/**
 * 상세 섹션 — 업무상 먼저 볼 항목을 앞에 둠
 * (허가 식별·위치·유효기간·용도 → 시설·수량 → 시공·준공 → 수질 → 종료/폐공)
 */
export const GROUNDWATER_PERMIT_DETAIL_SECTIONS: GroundwaterPermitSection[] = [
  {
    id: 'basic',
    title: '기본정보',
    fields: [
      { key: 'name_or_trade', label: '상호또는성명' },
      { key: 'develop_location', label: '개발위치' },
      { key: 'facility_type', label: '시설구분' },
      { key: 'permit_report_date', label: '허가신고일' },
      { key: 'permit_start_date', label: '허가유효시작일' },
      { key: 'permit_end_date', label: '허가유효종료일' },
      { key: 'completion_process_yn', label: '준공처리여부' },
      { key: 'groundwater_use', label: '지하수용도' },
      { key: 'use_type', label: '용도' },
      { key: 'use_detail', label: '세부용도' },
      { key: 'drinking_yn', label: '음용여부' },
      { key: 'permit_cancel', label: '허가취소' },
      { key: 'complaint_withdraw', label: '민원취하' },
      { key: 'category', label: '구분' },
      { key: 'rep_or_trade', label: '대표자또는상호' },
      { key: 'phone', label: '전화번호' },
      { key: 'address', label: '주소' },
      { key: 'biz_reg_no', label: '법인·사업자·생년월일' },
      { key: 'remark', label: '비고' },
      { key: 'zip_code', label: '우편번호' },
      { key: 'sido', label: '시도' },
      { key: 'sigungu', label: '시군구' },
      { key: 'eupmyeondong', label: '읍면동' },
      { key: 'ri', label: '리' },
    ],
  },
  {
    id: 'facility',
    title: '시설정보',
    fields: [
      { key: 'dig_depth', label: '굴착깊이' },
      { key: 'dig_diameter', label: '굴착지름' },
      { key: 'intake_plan_qty', label: '취수계획량' },
      { key: 'required_qty', label: '소요수량' },
      { key: 'daily_use_qty', label: '일이용량' },
      { key: 'pump_capacity', label: '양수능력' },
      { key: 'power_hp', label: '동력장치마력' },
      { key: 'install_depth', label: '설치심도' },
      { key: 'discharge_pipe_dia', label: '토출관직경' },
      { key: 'elevation', label: '표고' },
      { key: 'use_period', label: '이용기간' },
    ],
  },
  {
    id: 'construction',
    title: '시공정보',
    fields: [
      { key: 'contractor_name', label: '시공업체명' },
      { key: 'contractor_rep', label: '대표자' },
      { key: 'contractor_reg_no', label: '시공업체등록번호' },
      { key: 'completion_date', label: '준공일자' },
      { key: 'completion_cert_date', label: '준공증발급일' },
      { key: 'license_cert_no', label: '등록증번호' },
      { key: 'contractor_addr', label: '소재지' },
      { key: 'bond_pay_date', label: '이행보증금납부일자' },
      { key: 'bond_amount', label: '금액' },
      { key: 'bond_pay_detail', label: '납부내역' },
    ],
  },
  {
    id: 'waterTest',
    title: '수질검사',
    fields: [
      { key: 'water_test_date', label: '수질검사일자' },
      { key: 'water_test_result', label: '수질검사결과' },
      { key: 'water_test_type', label: '수질검사종류' },
      { key: 'water_test_exempt_yn', label: '수질검사면제여부' },
    ],
  },
  {
    id: 'endAbandon',
    title: '종료/폐공',
    fields: [
      { key: 'abandon_date', label: '폐공발생일' },
      { key: 'abandon_cause', label: '폐공발생원인' },
      { key: 'end_report_date', label: '종료신고일' },
      { key: 'end_reason', label: '종료사유' },
      { key: 'restore_order_date', label: '원상복구명령일' },
      { key: 'restore_done_date', label: '원상복구이행일' },
      { key: 'abandon_method', label: '폐공처리방법' },
      { key: 'restore_method', label: '원상복구방법' },
      { key: 'dig_restore_method', label: '굴착원상복구방법' },
      { key: 'abandon_handler', label: '폐공처리자' },
      { key: 'aftercare_plan_start', label: '사후관리시행예정일' },
      { key: 'aftercare_plan_end', label: '사후관리시행종료일' },
    ],
  },
]
