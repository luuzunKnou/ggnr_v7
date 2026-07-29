import { SHOOT_TYPE_LABEL, type ShootType } from './shootingRequestMockData';
import { downloadHtmlAsPdf, escHtml, LABEL_BG, SUB_BG } from '../_lib/formalDocPdf';

/**
 * 별지 제3호서식 «무인비행장치 촬영신청서(제14조 제1항 관련)»
 * — 공통 formalDoc flex 칸 스타일을 쓰지 않음(html2canvas에서 글자가 아래로 밀림).
 */

export type ShootingRequestDocValues = {
  department: string;
  applicantRankName: string;
  phone: string;
  manager: string;
  purpose: string;
  address: string;
  hasScope: boolean;
  scopeLabel: string;
  /** 위치도 지도 PNG data URL (있으면 서식에 이미지로 삽입) */
  scopeMapDataUrl?: string | null;
  shootDate: string;
  useDate: string;
  shootType: ShootType;
  detailRequest: string;
};

function sq(on: boolean): string {
  return on ? '■' : '□';
}

function nl(s: string): string {
  return escHtml(s).replace(/\n/g, '<br/>');
}

const TH = `border:1px solid #000;background:${LABEL_BG};font-weight:700;text-align:center;vertical-align:middle;padding:7px 6px;font-size:12px;line-height:1.35`;
const TH_SUB = `border:1px solid #000;background:${SUB_BG};font-weight:700;text-align:center;vertical-align:middle;padding:7px 6px;font-size:11.5px;line-height:1.35`;
const TH_SEC = `border:1px solid #000;background:${LABEL_BG};font-weight:700;text-align:center;vertical-align:middle;padding:6px 8px;font-size:13px;line-height:1.35`;
const TD = `border:1px solid #000;vertical-align:middle;padding:7px 10px;font-size:12px;line-height:1.35;text-align:left;background:#fff`;
const TD_TOP = `border:1px solid #000;vertical-align:top;padding:7px 10px;font-size:12px;line-height:1.4;text-align:left;background:#fff`;

function buildShootingRequestHtml(v: ShootingRequestDocValues): string {
  const shootTypes = (Object.keys(SHOOT_TYPE_LABEL) as ShootType[])
    .map((id, i) => `${sq(v.shootType === id)} ${i + 1}. ${SHOOT_TYPE_LABEL[id]}`)
    .join('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');

  const mapBlock =
    v.hasScope && v.scopeMapDataUrl
      ? `<div style="margin-top:4px;border:1px solid #999;padding:2px;background:#fafafa;line-height:0">
           <img src="${v.scopeMapDataUrl}" alt="위치도" style="display:block;width:100%;height:auto;max-height:130px;object-fit:contain;border:0"/>
         </div>`
      : `<div style="margin-top:4px;border:1px solid #999;padding:10px;text-align:center;color:#333;background:#fafafa;font-size:12px;line-height:1.4">
           ${
             v.hasScope
               ? `(위치도)<br/><span style="font-size:11px">${escHtml(v.scopeLabel) || '범위 지정됨'}</span>`
               : '(위치도)'
           }
         </div>`;

  const mapHtml = `
    <div style="line-height:1.4">
      <div>- 지번&nbsp;&nbsp;${escHtml(v.address) || '&nbsp;'}</div>
      <div style="margin-top:2px">- 위치도</div>
      ${mapBlock}
    </div>
  `;

  return `
<p style="font-size:11px;margin:0 0 4px;font-weight:400">[별지 제3호서식]</p>
<div style="text-align:center;font-size:18px;font-weight:700;margin:0 0 10px;padding-bottom:6px;border-bottom:1.5px solid #000;letter-spacing:0.02em;line-height:1.35">
  무인비행장치 촬영신청서(제14조 제1항 관련)
</div>
<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #000">
  <colgroup>
    <col style="width:14%"/><col style="width:22%"/><col style="width:12%"/>
    <col style="width:16%"/><col style="width:36%"/>
  </colgroup>

  <tr><th colspan="5" style="${TH_SEC}">신청 정보</th></tr>
  <tr>
    <th rowspan="2" style="${TH}">부서명</th>
    <td rowspan="2" style="${TD}">${escHtml(v.department) || '&nbsp;'}</td>
    <th rowspan="2" style="${TH}">신청자</th>
    <td style="${TH_SUB}">직급/성명</td>
    <td style="${TD}">${escHtml(v.applicantRankName) || '&nbsp;'}</td>
  </tr>
  <tr>
    <td style="${TH_SUB}">전화번호</td>
    <td style="${TD}">${escHtml(v.phone) || '&nbsp;'}</td>
  </tr>

  <tr><th colspan="5" style="${TH_SEC}">항공영상 촬영 요청내용</th></tr>
  <tr>
    <th style="${TH}">신청목적</th>
    <td colspan="4" style="${TD}">${escHtml(v.purpose) || '&nbsp;'}</td>
  </tr>
  <tr>
    <th style="${TH}">촬영지역<br/>(위치도)</th>
    <td colspan="4" style="${TD_TOP}">${mapHtml}</td>
  </tr>
  <tr>
    <th style="${TH}">촬영요청<br/>기간</th>
    <td colspan="2" style="${TD}">${escHtml(v.shootDate) || '&nbsp;'}</td>
    <th style="${TH}">사용일</th>
    <td style="${TD}">${escHtml(v.useDate) || '&nbsp;'}</td>
  </tr>
  <tr>
    <th style="${TH}">촬영형태</th>
    <td colspan="4" style="${TD}">${shootTypes}</td>
  </tr>
  <tr>
    <th style="${TH}">상세요청사항</th>
    <td colspan="4" style="${TD}">${nl(v.detailRequest) || '&nbsp;'}</td>
  </tr>

  <tr><th colspan="5" style="${TH_SEC}">촬영영상 안내</th></tr>
  <tr>
    <td colspan="5" style="border:1px solid #000;padding:8px 12px 10px;font-size:11px;line-height:1.65;text-align:left;background:#fff;vertical-align:top">
      <ol style="margin:0;padding-left:1.2em">
        <li style="margin:0 0 2px">항공사진 보안 규정에 의거 별도의 승인이 없이는 행정내부용 자료로만 활용 가능</li>
        <li style="margin:0 0 2px">촬영지역에 따라 일부 불가(비행금지구역 등 비승인 지역 존재)</li>
        <li style="margin:0">담당 부서(관리부서): 토지정보과</li>
      </ol>
    </td>
  </tr>
</table>
`;
}

function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

/** 별지 제3호서식 PDF 내려받기 */
export async function downloadShootingRequestDocument(
  v: ShootingRequestDocValues,
  opts?: { fileName?: string }
): Promise<void> {
  const stamp = new Date();
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate()
  ).padStart(2, '0')}`;
  const hint = v.purpose.trim() || v.department.trim() || ymd;
  const base = safeFileBase(opts?.fileName?.trim() || `무인비행장치_촬영신청서_${hint}`);
  await downloadHtmlAsPdf(buildShootingRequestHtml(v), base, {
    title: '무인비행장치 촬영신청서(제14조 제1항 관련)',
    fillA4Height: false,
    letterRendering: false,
  });
}
