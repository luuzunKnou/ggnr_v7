import { SHOOT_TYPE_LABEL, type ShootType } from './shootingRequestMockData';
import { downloadHtmlAsPdf, escHtml, LABEL_BG, SUB_BG } from '../_lib/formalDocPdf';

/**
 * 별지 제3호서식 «무인비행장치 촬영신청서(제14조 제1항 관련)»
 *
 * html2canvas는 th/td vertical-align·flex 세로중앙을 자주 깨뜨림(한글 명조는 더 아래로 깔림).
 * → 칸 안을 display:table / table-cell 로 다시 잡아 진짜 가운데 맞춤.
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

/**
 * 칸 안 가로·세로 정중앙.
 * h: 시각 높이(px). rowspan=2 칸은 대략 2배.
 * bg: 안쪽 div에도 배경을 칠함(html2canvas가 th 배경을 빼먹는 경우 대비).
 */
function mid(html: string, h = 30, bg = '#ffffff'): string {
  /** translateY: 명조+html2canvas에서 글자가 아래로 깔리는 광학 보정 */
  return (
    `<div style="display:table;width:100%;height:${h}px;table-layout:fixed;` +
    `background:${bg};-webkit-print-color-adjust:exact;print-color-adjust:exact">` +
    `<div style="display:table-cell;vertical-align:middle;text-align:center;` +
    `padding:0 4px;line-height:1.15;font-size:inherit;font-weight:inherit;` +
    `background:${bg};-webkit-print-color-adjust:exact;print-color-adjust:exact">` +
    `<span style="display:inline-block;transform:translateY(-1px)">${html || '&nbsp;'}</span>` +
    `</div></div>`
  );
}

const PRINT_BG =
  '-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact';
const BOX = `border:1px solid #000;padding:0;vertical-align:middle;${PRINT_BG}`;
const TH = `${BOX}background:${LABEL_BG};font-weight:700;font-size:11.5px`;
const TH_SUB = `${BOX}background:${SUB_BG};font-weight:700;font-size:11px`;
const TH_SEC = `${BOX}background:${LABEL_BG};font-weight:700;font-size:12.5px`;
const TD = `${BOX}background:#fff;font-weight:400;font-size:11.5px`;
const TD_TOP =
  `border:1px solid #000;padding:6px 8px;vertical-align:top;text-align:left;` +
  `background:#fff;font-size:11.5px;line-height:1.35;${PRINT_BG}`;

function buildShootingRequestHtml(v: ShootingRequestDocValues): string {
  const shootTypes = (Object.keys(SHOOT_TYPE_LABEL) as ShootType[])
    .map((id, i) => `${sq(v.shootType === id)} ${i + 1}. ${SHOOT_TYPE_LABEL[id]}`)
    .join('&nbsp;&nbsp;&nbsp;&nbsp;');

  const mapBlock =
    v.hasScope && v.scopeMapDataUrl
      ? `<div style="margin-top:4px;border:1px solid #999;padding:4px;background:#fafafa;text-align:center">
           <img src="${v.scopeMapDataUrl}" alt="위치도"
             width="480" style="display:inline-block;width:480px;max-width:100%;height:auto;border:0"/>
         </div>`
      : `<div style="margin-top:4px;border:1px solid #999;padding:10px;text-align:center;color:#333;background:#fafafa;font-size:11px;line-height:1.35">
           ${
             v.hasScope
               ? `(위치도)<br/><span style="font-size:10.5px">${escHtml(v.scopeLabel) || '범위 지정됨'}</span>`
               : '(위치도)'
           }
         </div>`;

  const mapHtml = `
    <div style="line-height:1.35">
      <div>- 지번&nbsp;&nbsp;${escHtml(v.address) || '&nbsp;'}</div>
      <div style="margin-top:2px">- 위치도</div>
      ${mapBlock}
    </div>
  `;

  const H = 30;
  const H2 = 60;
  const G = LABEL_BG;
  const GS = SUB_BG;
  const W = '#ffffff';

  return `
<p style="font-size:10.5px;margin:0 0 2px;font-weight:400;text-align:left">[별지 제3호서식]</p>
<div style="text-align:center;font-size:17px;font-weight:700;margin:0 0 8px;padding-bottom:5px;border-bottom:1.5px solid #000;letter-spacing:0.02em;line-height:1.3">
  무인비행장치 촬영신청서(제14조 제1항 관련)
</div>
<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #000;margin:0 auto;${PRINT_BG}">
  <colgroup>
    <col style="width:13%"/><col style="width:22%"/><col style="width:11%"/>
    <col style="width:15%"/><col style="width:39%"/>
  </colgroup>

  <tr><th colspan="5" style="${TH_SEC}">${mid('신청 정보', 26, G)}</th></tr>
  <tr>
    <th rowspan="2" style="${TH}">${mid('부서명', H2, G)}</th>
    <td rowspan="2" style="${TD}">${mid(escHtml(v.department), H2, W)}</td>
    <th rowspan="2" style="${TH}">${mid('신청자', H2, G)}</th>
    <td style="${TH_SUB}">${mid('직급/성명', H, GS)}</td>
    <td style="${TD}">${mid(escHtml(v.applicantRankName), H, W)}</td>
  </tr>
  <tr>
    <td style="${TH_SUB}">${mid('전화번호', H, GS)}</td>
    <td style="${TD}">${mid(escHtml(v.phone), H, W)}</td>
  </tr>

  <tr><th colspan="5" style="${TH_SEC}">${mid('항공영상 촬영 요청내용', 26, G)}</th></tr>
  <tr>
    <th style="${TH}">${mid('신청목적', H, G)}</th>
    <td colspan="4" style="${TD}">${mid(escHtml(v.purpose), H, W)}</td>
  </tr>
  <tr>
    <th style="${TH}">${mid('촬영지역<br/>(위치도)', 72, G)}</th>
    <td colspan="4" style="${TD_TOP}">${mapHtml}</td>
  </tr>
  <tr>
    <th style="${TH}">${mid('촬영요청<br/>기간', 44, G)}</th>
    <td colspan="2" style="${TD}">${mid(escHtml(v.shootDate), 44, W)}</td>
    <th style="${TH}">${mid('사용일', 44, G)}</th>
    <td style="${TD}">${mid(escHtml(v.useDate), 44, W)}</td>
  </tr>
  <tr>
    <th style="${TH}">${mid('촬영형태', H, G)}</th>
    <td colspan="4" style="${TD}">${mid(shootTypes, H, W)}</td>
  </tr>
  <tr>
    <th style="${TH}">${mid('상세요청사항', 40, G)}</th>
    <td colspan="4" style="${TD_TOP}">${nl(v.detailRequest) || '&nbsp;'}</td>
  </tr>

  <tr><th colspan="5" style="${TH_SEC}">${mid('촬영영상 안내', 26, G)}</th></tr>
  <tr>
    <td colspan="5" style="border:1px solid #000;padding:6px 10px 8px;font-size:10.5px;line-height:1.55;text-align:left;background:#fff;vertical-align:top">
      <ol style="margin:0;padding-left:1.15em">
        <li style="margin:0 0 1px">항공사진 보안 규정에 의거 별도의 승인이 없이는 행정내부용 자료로만 활용 가능</li>
        <li style="margin:0 0 1px">촬영지역에 따라 일부 불가(비행금지구역 등 비승인 지역 존재)</li>
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
