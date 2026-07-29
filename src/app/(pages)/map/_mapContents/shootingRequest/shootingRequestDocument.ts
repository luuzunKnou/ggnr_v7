import { SHOOT_TYPE_LABEL, type ShootType } from './shootingRequestMockData';
import { downloadHtmlAsPdf, escHtml, formalDocSharedCss } from '../_lib/formalDocPdf';

/**
 * 별지 제3호서식 «무인비행장치 촬영신청서(제14조 제1항 관련)»
 * 스타일 참고: docs/assets/별지제3호_*.png · 사용자 제공 PDF
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

function buildShootingRequestHtml(v: ShootingRequestDocValues): string {
  const shootTypes = (Object.keys(SHOOT_TYPE_LABEL) as ShootType[])
    .map((id, i) => `${sq(v.shootType === id)} ${i + 1}. ${SHOOT_TYPE_LABEL[id]}`)
    .join('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');

  const mapCell = `
    <div class="fd-cell-left" style="align-items:flex-start;min-height:220px">
      <div style="width:100%;line-height:1.65">
        <div>- 지번&nbsp;&nbsp;${escHtml(v.address) || '&nbsp;'}</div>
        <div style="margin-top:4px">- 위치도</div>
        <div style="margin-top:10px;min-height:180px;border:1px solid #999;padding:16px;text-align:center;color:#333;background:#fafafa">
          ${
            v.hasScope
              ? `(위치도)<br/><span style="font-size:12px">${escHtml(v.scopeLabel) || '범위 지정됨'}</span>`
              : '(위치도)'
          }
        </div>
      </div>
    </div>
  `;

  const c = (html: string, rs?: 2 | 3) => {
    const rsClass = rs === 2 ? ' fd-cell-rs2' : rs === 3 ? ' fd-cell-rs3' : '';
    return `<div class="fd-cell${rsClass}">${html}</div>`;
  };
  const L = (html: string) => `<div class="fd-cell-left">${html || '&nbsp;'}</div>`;

  return `
<style>${formalDocSharedCss()}</style>
<p class="fd-form-no">[별지 제3호서식]</p>
<div class="fd-title">무인비행장치 촬영신청서(제14조 제1항 관련)</div>
<table class="fd-table">
  <colgroup>
    <col style="width:14%"/><col style="width:22%"/><col style="width:12%"/>
    <col style="width:16%"/><col style="width:36%"/>
  </colgroup>

  <tr><th class="fd-sec" colspan="5">${c('신청 정보')}</th></tr>
  <tr>
    <th rowspan="2">${c('부서명', 2)}</th>
    <td rowspan="2">${L(escHtml(v.department))}</td>
    <th rowspan="2">${c('신청자', 2)}</th>
    <td class="fd-sub">${c('직급/성명')}</td>
    <td>${L(escHtml(v.applicantRankName))}</td>
  </tr>
  <tr>
    <td class="fd-sub">${c('전화번호')}</td>
    <td>${L(escHtml(v.phone))}</td>
  </tr>

  <tr><th class="fd-sec" colspan="5">${c('항공영상 촬영 요청내용')}</th></tr>
  <tr>
    <th>${c('신청목적')}</th>
    <td colspan="4">${L(escHtml(v.purpose))}</td>
  </tr>
  <tr>
    <th>${c('촬영지역<br/>(위치도)')}</th>
    <td colspan="4" class="fd-map">${mapCell}</td>
  </tr>
  <tr>
    <th>${c('촬영요청<br/>기간')}</th>
    <td colspan="2">${L(escHtml(v.shootDate))}</td>
    <th>${c('사용일')}</th>
    <td>${L(escHtml(v.useDate))}</td>
  </tr>
  <tr>
    <th>${c('촬영형태')}</th>
    <td colspan="4" class="fd-check">${L(shootTypes)}</td>
  </tr>
  <tr>
    <th>${c('상세요청사항')}</th>
    <td colspan="4" class="fd-xtall">${L(nl(v.detailRequest))}</td>
  </tr>

  <tr><th class="fd-sec" colspan="5">${c('촬영영상 안내')}</th></tr>
  <tr>
    <td colspan="5" class="fd-guide">
      <ol>
        <li>항공사진 보안 규정에 의거 별도의 승인이 없이는 행정내부용 자료로만 활용 가능</li>
        <li>촬영지역에 따라 일부 불가(비행금지구역 등 비승인 지역 존재)</li>
        <li>담당 부서(관리부서): 토지정보과</li>
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
  });
}
