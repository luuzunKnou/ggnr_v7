import {
  ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
  ROAD_FRONTAGE_BUILDING_LOCATION_KINDS,
  emptyRoadFrontageBuildingFormAttachShotDates,
  emptyRoadFrontageBuildingFormAttaches,
  type RoadFrontageBuildingLedger,
} from './roadFrontageBuildingMock';

function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tx(v: string | null | undefined) {
  return esc(String(v ?? '').trim());
}

function ymd(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return tx(iso);
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
}

function ymdBlank(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return '&nbsp;&nbsp; 년 &nbsp;&nbsp; 월 &nbsp;&nbsp; 일';
  return `${m[1]} 년 ${Number(m[2])} 월 ${Number(m[3])} 일`;
}

function sqm(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function abcd(marks: string[]) {
  const on = (k: string) => ((marks ?? []).includes(k) ? '■' : '□');
  return `<table class="m"><tr><td>${on('A')} A</td><td>${on('B')} B</td></tr><tr><td>${on('C')} C</td><td>${on('D')} D</td></tr></table>`;
}

function phoneMark(phone: string | null | undefined) {
  const p = String(phone ?? '').trim();
  return `(전화번호: <span class="pnum">${p ? esc(p) : '&nbsp;'}</span>)`;
}

function img(src?: string) {
  return src ? `<img src="${esc(src)}" alt="" />` : '';
}

async function urlToDataUrl(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob || blob.size < 8) return undefined;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

async function inlineAttachSrcs(srcs?: string[]): Promise<string[]> {
  const src = String(srcs?.[0] ?? '').trim();
  if (!src) return [];
  const data = await urlToDataUrl(src);
  return [data || src];
}

/**
 * 인쇄 문서 제목. Chrome «PDF로 저장» 기본 파일명이 되므로
 * 비워 두면 지도 페이지 제목(map.pdf)이 쓰인다.
 */
function printDocTitle(ledger: RoadFrontageBuildingLedger): string {
  const tag =
    String(ledger.serialNo ?? '').trim() || String(ledger.locationAddress ?? '').trim();
  return ['접도구역 기존 건축물(공작물) 관리대장', tag]
    .filter(Boolean)
    .join('_')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formHtml(ledger: RoadFrontageBuildingLedger, docTitle: string) {
  const details = [...(ledger.details ?? [])];
  while (details.length < 5) {
    details.push({
      id: `d${details.length}`,
      dongNo: null,
      installedDate: '',
      structure: '',
      usageType: '',
      areaSqm: null,
      locationKind: '',
      badMarks: [],
    });
  }
  const confirms = [...(ledger.confirmHistory ?? [])];
  while (confirms.length < 6) {
    confirms.push({
      id: `c${confirms.length}`,
      confirmDate: '',
      confirmerName: '',
      approverName: '',
    });
  }

  const routeName = String(ledger.routeName ?? '').trim();
  const route = routeName ? `${tx(ledger.routeNo)} (${tx(routeName)})` : tx(ledger.routeNo);

  const dRows = details
    .map((d) => {
      const loc = ROAD_FRONTAGE_BUILDING_LOCATION_KINDS.map(
        (k) => `<td>${d.locationKind === k ? '○' : ''}</td>`
      ).join('');
      return `<tr class="dr">
        <td>${d.dongNo ?? ''}</td>
        <td>${ymd(d.installedDate)}</td>
        <td>${tx(d.structure)}</td>
        <td>${tx(d.usageType)}</td>
        <td class="ar">${sqm(d.areaSqm)}</td>
        ${loc}
        <td>${abcd(d.badMarks ?? [])}</td>
      </tr>`;
    })
    .join('');

  const cRows = confirms
    .map(
      (c) => `<tr class="cr">
        <td class="ct">${ymd(c.confirmDate)}</td>
        <td class="sg"><div class="sgin"><b>${tx(c.confirmerName)}</b><span>(서명 또는 인)</span></div></td>
        <td class="sg"><div class="sgin"><b>${tx(c.approverName)}</b><span>(서명 또는 인)</span></div></td>
      </tr>`
    )
    .join('');

  const who = [ledger.writerDept || ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT, ledger.writerName, ledger.writtenAt]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' / ');

  const att = ledger.formAttaches ?? emptyRoadFrontageBuildingFormAttaches();
  const dates = ledger.formAttachShotDates ?? emptyRoadFrontageBuildingFormAttachShotDates();

  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="utf-8" /><title>${esc(docTitle)}</title>
<style>
@page { size: 364mm 257mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000;
  font-family: "Malgun Gothic", "맑은 고딕", sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg {
  width: 364mm; height: 257mm; max-height: 257mm;
  padding: 11mm 15mm 9mm;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.pg + .pg {
  break-before: page;
  page-break-before: always;
}
.top {
  display: flex; justify-content: space-between; align-items: flex-start;
  font-size: 10pt;
}
h1 { margin: 1.5mm 0 2mm; text-align: center; font-size: 22pt; font-weight: 700; }
.pn { text-align: right; font-size: 10pt; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 1px solid #000; font-size: 10.5pt; font-weight: 400; background: #fff; padding: 0 1.5mm; }
th { text-align: center; vertical-align: middle; }
.r1 td {
  height: 10mm; background: #CBC6DD; padding: 0; vertical-align: middle;
}
.r1in {
  display: flex; align-items: center; justify-content: space-between;
  height: 10mm; padding: 0 4.5mm 0 2mm; gap: 2mm;
}
.r1in .lk { line-height: 1.15; flex-shrink: 0; }
.r1in .rv { font-weight: 400; text-align: right; }
.side { text-align: center; word-break: keep-all; padding: 0 1mm; }
.lab { text-align: center; vertical-align: middle; font-weight: 400; line-height: 1.25; padding: 1mm 0.5mm; }
.fld { vertical-align: top; text-align: left; padding: 1mm 2mm 2mm 1.5mm; height: 16mm; background: #fff; }
.fld .k { display: block; font-size: 9.5pt; line-height: 1.2; }
.fld .b { display: block; margin-top: 2mm; min-height: 6mm; }
.fld .ph { float: right; font-size: 9.5pt; margin-top: 1mm; padding-right: 1mm; }
.fld .ph .pnum { display: inline-block; min-width: 22mm; }
.tiny { display: block; font-size: 8pt; color: #000; }
.hh { height: 9mm; }
.hh2 { height: 6.5mm; }
.dr td { height: 9mm; text-align: center; }
.ar { text-align: right !important; }
.ct { text-align: center; }
.cr td { height: 9.5mm; }
/*
 * border-collapse 표에서 td에 position을 주면 Chrome이 합쳐진 테두리를 그리지 않는다.
 * (확인자·결재자 칸 선이 사라지던 원인) → 위치 지정은 안쪽 div에서만 한다.
 */
.sg { padding: 0 2mm; }
.sgin { display: flex; align-items: center; height: 9.5mm; }
.sgin b { flex: 1 1 auto; text-align: center; font-weight: 400; }
.sgin span { flex: 0 0 auto; padding-left: 2mm; font-size: 8.5pt; }
table.m { width: 64%; margin: 0 auto; border-collapse: collapse; }
table.m td { border: 0; height: auto; padding: 0.2mm 1mm; font-size: 9.5pt; text-align: center; }
.ft { margin-top: 10px; font-size: 9pt; }
.ft .sz { text-align: right; }
.ft .who { text-align: left; margin-top: 2.5mm; }
.pg-draw { display: flex; flex-direction: column; }
.pg-draw .pn { flex: 0 0 auto; }
.pg-draw .ft { flex: 0 0 auto; margin-top: 2mm; }
.g { flex: 1 1 auto; height: 218mm; max-height: 218mm; }
.g th { height: 8mm; background: #fff; }
.g .box {
  height: 90mm; max-height: 90mm; padding: 0;
  vertical-align: middle; overflow: hidden;
}
.g .box img {
  display: block; width: 100%; height: 90mm; max-height: 90mm;
  object-fit: contain;
}
</style>
</head><body>

<section class="pg">
  <div class="top">
    <span>■ 도로법 시행규칙 [별지 제17호서식]</span>
    <span></span>
  </div>
  <h1>접도구역의 기존 건축물(공작물) 관리대장</h1>
  <div class="pn">(2쪽 중 제1쪽)</div>

  <table>
    <colgroup>
      <col style="width:25%" /><col style="width:25%" />
      <col style="width:25%" /><col style="width:25%" />
    </colgroup>
    <tr class="r1">
      <td><div class="r1in"><span class="lk">도로의 종류</span><span class="rv">${tx(ledger.roadType)}</span></div></td>
      <td><div class="r1in"><span class="lk">노선번호<br/>(노선명)</span><span class="rv">${route}</span></div></td>
      <td><div class="r1in"><span class="lk">일련번호</span><span class="rv">${tx(ledger.serialNo)}</span></div></td>
      <td><div class="r1in"><span class="lk">작성 연월일</span><span class="rv">${ymd(ledger.preparedDate)}</span></div></td>
    </tr>
  </table>

  <table style="margin-top:-1px">
    <colgroup>
      <col style="width:11%" />
      <col style="width:13%" />
      <col style="width:38%" />
      <col />
    </colgroup>
    <tr>
      <th class="side" rowspan="3">건축물<br/>(공작물)</th>
      <td class="fld" colspan="2">
        <span class="k">위치</span>
        <span class="b">${tx(ledger.locationAddress)}</span>
      </td>
      <td class="fld">
        <span class="k">현 거주자</span>
        <span class="ph">${phoneMark(ledger.residentPhone)}</span>
        <span class="b">${tx(ledger.residentName)}</span>
      </td>
    </tr>
    <tr>
      <th class="lab">건축물<br/>(공작물)<br/>소유자</th>
      <td class="fld">
        <span class="tiny">성명(법인인 경우에는 법인명 및 대표자의 성명)</span>
        <span class="ph">${phoneMark(ledger.buildingOwnerPhone)}</span>
        <span class="b">${tx(ledger.buildingOwnerName)}</span>
      </td>
      <td class="fld">
        <span class="tiny">주소(법인인 경우에는 주된 사무소의 소재지)</span>
        <span class="b">${tx(ledger.buildingOwnerAddress)}</span>
      </td>
    </tr>
    <tr>
      <th class="lab">토지<br/>소유자</th>
      <td class="fld">
        <span class="tiny">성명(법인인 경우에는 법인명 및 대표자의 성명)</span>
        <span class="ph">${phoneMark(ledger.landOwnerPhone)}</span>
        <span class="b">${tx(ledger.landOwnerName)}</span>
      </td>
      <td class="fld">
        <span class="tiny">주소(법인인 경우에는 주된 사무소의 소재지)</span>
        <span class="b">${tx(ledger.landOwnerAddress)}</span>
      </td>
    </tr>
  </table>

  <table style="margin-top:-1px">
    <colgroup>
      <col style="width:11%" />
      <col style="width:8%" />
      <col style="width:12%" />
      <col style="width:11%" />
      <col style="width:14%" />
      <col style="width:10%" />
      <col style="width:9%" />
      <col style="width:9%" />
      <col />
    </colgroup>
    <tr class="hh">
      <th class="side" rowspan="${2 + details.length}">건축물(공작물) 내용</th>
      <th rowspan="2">동 구분</th>
      <th rowspan="2">설치 연월일</th>
      <th rowspan="2">구조</th>
      <th rowspan="2">용도</th>
      <th rowspan="2">건축물<br/>(공작물)<br/>면적(㎡)</th>
      <th colspan="2">위치</th>
      <th rowspan="2">불량 건축물 표시</th>
    </tr>
    <tr class="hh2">
      <th>도로예정지</th>
      <th>접도구역</th>
    </tr>
    ${dRows}
  </table>

  <table style="margin-top:-1px">
    <colgroup>
      <col style="width:11%" />
      <col style="width:29%" />
      <col style="width:30%" />
      <col />
    </colgroup>
    <tr class="hh">
      <th class="side" rowspan="${1 + confirms.length}">확인 결과</th>
      <th>확인 연월일</th>
      <th>확인자</th>
      <th>결재자</th>
    </tr>
    ${cRows}
  </table>
  <div class="ft">
    <div class="sz">364mm×257mm[백상지 200g/㎡]</div>
    <div class="who">${esc(who)}</div>
  </div>
</section>

<section class="pg pg-draw">
  <div class="pn">(2쪽 중 제2쪽)</div>
  <table class="g">
    <colgroup><col style="width:50%" /><col style="width:50%" /></colgroup>
    <tr>
      <th>위치도</th>
      <th>건축물(공작물) 배치도(축척: 1/400)</th>
    </tr>
    <tr>
      <td class="box">${img(att.locationMap?.[0])}</td>
      <td class="box">${img(att.layoutPlan?.[0])}</td>
    </tr>
    <tr><th colspan="2">사진</th></tr>
    <tr>
      <th>종전(촬영 연월일: ${ymdBlank(dates.before)})</th>
      <th>변경(촬영 연월일: ${ymdBlank(dates.after)})</th>
    </tr>
    <tr>
      <td class="box">${img(att.before?.[0])}</td>
      <td class="box">${img(att.after?.[0])}</td>
    </tr>
  </table>
  <div class="ft"><div class="sz">364mm×257mm[백상지 200g/㎡]</div></div>
</section>

</body></html>`;
}

function waitImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (el) =>
        new Promise<void>((resolve) => {
          if (el.complete) {
            resolve();
            return;
          }
          el.onload = () => resolve();
          el.onerror = () => resolve();
          window.setTimeout(() => resolve(), 2500);
        })
    )
  ).then(() => undefined);
}

/** 원본 서식에 상세 값을 넣어 인쇄. 화면 배치는 바꾸지 않음 */
export async function printRoadFrontageBuildingForm(ledger: RoadFrontageBuildingLedger | null) {
  if (!ledger) return;

  const att = ledger.formAttaches ?? emptyRoadFrontageBuildingFormAttaches();
  const [locationMap, layoutPlan, before, after] = await Promise.all([
    inlineAttachSrcs(att.locationMap),
    inlineAttachSrcs(att.layoutPlan),
    inlineAttachSrcs(att.before),
    inlineAttachSrcs(att.after),
  ]);
  const printable: RoadFrontageBuildingLedger = {
    ...ledger,
    formAttaches: { locationMap, layoutPlan, before, after },
  };

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }

  const docTitle = printDocTitle(printable);

  doc.open();
  doc.write(formHtml(printable, docTitle));
  doc.close();

  await waitImages(doc);
  await new Promise((r) => window.setTimeout(r, 50));

  /** iframe 인쇄 시 Chrome은 상위 문서 제목을 파일명으로 쓴다 */
  const prevTitle = document.title;
  doc.title = docTitle;
  document.title = docTitle;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = prevTitle;
    iframe.remove();
    win.removeEventListener('afterprint', cleanup);
  };
  win.addEventListener('afterprint', cleanup);
  win.focus();
  win.print();
  /** afterprint가 오지 않는 브라우저 대비. 인쇄 대화상자가 열려 있는 동안 제목이 되돌아가지 않게 넉넉히 둔다 */
  window.setTimeout(cleanup, 30000);
}
