import type { FlightLogbookValues } from './FlightLogbookForm';
import { downloadHtmlAsPdf, escHtml, formalDocSharedCss } from '../_lib/formalDocPdf';

/**
 * 별지 제5호서식 «무인비행장치 비행기록부(제19조제4항 관련)»
 * 스타일 참고: docs/assets/별지제5호_*.png · 사용자 제공 PDF
 */

function box(on: boolean): string {
  return on ? '■' : '□';
}

function nl(s: string): string {
  return escHtml(s).replace(/\n/g, '<br/>');
}

/** 라벨: 가로·세로 정중앙 */
function cell(html: string, rs?: 2 | 3): string {
  const rsClass = rs === 2 ? ' fd-cell-rs2' : rs === 3 ? ' fd-cell-rs3' : '';
  return `<div class="fd-cell${rsClass}">${html}</div>`;
}

/** 값: 세로 중앙 · 좌측 정렬 */
function cellL(html: string): string {
  return `<div class="fd-cell-left">${html || '&nbsp;'}</div>`;
}

function buildFlightLogbookHtml(v: FlightLogbookValues): string {
  const aircraft = `${box(v.aircraftCondition === 'good')} 상태 양호&nbsp;&nbsp;&nbsp;&nbsp;${box(
    v.aircraftCondition === 'inspect'
  )} 점검 요망`;
  const camera = `${box(v.cameraCondition === 'good')} 상태 양호&nbsp;&nbsp;&nbsp;&nbsp;${box(
    v.cameraCondition === 'inspect'
  )} 점검 요망`;
  const safety = `${box(v.safetyDone)} 완료`;
  const security = v.securityDetail.trim()
    ? nl(v.securityDetail)
    : `${box(v.securityDone)} 완료`;

  return `
<style>${formalDocSharedCss()}</style>
<p class="fd-form-no">[별지 제5호서식]</p>
<div class="fd-title">무인비행장치 비행기록부(제19조제4항 관련)</div>
<table class="fd-table">
  <colgroup>
    <col style="width:15%"/><col style="width:13%"/><col style="width:11%"/>
    <col style="width:20%"/><col style="width:11%"/><col style="width:11%"/><col style="width:19%"/>
  </colgroup>
  <tr>
    <th>${cell('일자<br/>비행시간')}</th>
    <td colspan="6" class="fd-tall">${cellL(nl(v.dateFlightTime))}</td>
  </tr>
  <tr>
    <th>${cell('촬영대상<br/>목적')}</th>
    <td colspan="6" class="fd-tall">${cellL(nl(v.shootTargetPurpose))}</td>
  </tr>
  <tr>
    <th>${cell('기종')}</th>
    <td colspan="6">${cellL(escHtml(v.aircraftModel))}</td>
  </tr>
  <tr>
    <th rowspan="2">${cell('조종자', 2)}</th>
    <td class="fd-sub" rowspan="2">${cell('파일럿', 2)}</td>
    <td class="fd-sub">${cell('소속')}</td>
    <td>${cellL(escHtml(v.pilotOrg))}</td>
    <td class="fd-sub" rowspan="2">${cell('짐벌', 2)}</td>
    <td class="fd-sub">${cell('소속')}</td>
    <td>${cellL(escHtml(v.gimbalOrg))}</td>
  </tr>
  <tr>
    <td class="fd-sub">${cell('성명')}</td>
    <td>${cellL(escHtml(v.pilotName))}</td>
    <td class="fd-sub">${cell('성명')}</td>
    <td>${cellL(escHtml(v.gimbalName))}</td>
  </tr>
  <tr>
    <th>${cell('비행지역')}</th>
    <td colspan="6">${cellL(escHtml(v.flightArea))}</td>
  </tr>
  <tr>
    <th>${cell('허가<br/>통제사항')}</th>
    <td colspan="6">${cellL(escHtml(v.permissionControl))}</td>
  </tr>
  <tr>
    <th rowspan="3">${cell('비행전<br/>점검', 3)}</th>
    <td class="fd-sub">${cell('비행체 상태')}</td>
    <td colspan="5" class="fd-check">${cellL(aircraft)}</td>
  </tr>
  <tr>
    <td class="fd-sub">${cell('촬영장비 상태')}</td>
    <td colspan="5" class="fd-check">${cellL(camera)}</td>
  </tr>
  <tr>
    <td class="fd-sub">${cell('안전조치')}</td>
    <td colspan="5" class="fd-check">${cellL(safety)}</td>
  </tr>
  <tr>
    <th>${cell('비행<br/>촬영요약')}</th>
    <td colspan="6" class="fd-xtall">${cellL(nl(v.flightSummary))}</td>
  </tr>
  <tr>
    <th>${cell('비행후<br/>점검')}</th>
    <td class="fd-sub">${cell('촬영자료<br/>보안조치')}</td>
    <td colspan="5" class="fd-check">${cellL(security)}</td>
  </tr>
  <tr>
    <th>${cell('기타')}</th>
    <td colspan="6" class="fd-xtall">${cellL(nl(v.etc))}</td>
  </tr>
</table>
`;
}

function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

/** 별지 제5호서식 PDF 내려받기 */
export async function downloadFlightLogbookDocument(
  v: FlightLogbookValues,
  opts?: { workUnitLabel?: string; fileName?: string }
): Promise<void> {
  const stamp = new Date();
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate()
  ).padStart(2, '0')}`;
  const base = safeFileBase(
    opts?.fileName?.trim() || `무인비행장치_비행기록부_${opts?.workUnitLabel?.trim() || ymd}`
  );
  await downloadHtmlAsPdf(buildFlightLogbookHtml(v), base, {
    title: '무인비행장치 비행기록부(제19조제4항 관련)',
  });
}
