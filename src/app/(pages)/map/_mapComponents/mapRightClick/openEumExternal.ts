/** 토지이음·이음지도·도시계획도 — 숨김 폼 POST로 새창 오픈 (레거시 우클릭과 동일) */

type EumKind = 'land' | 'map' | 'plan';

const EUM_CONFIG: Record<
  EumKind,
  { formId: string; windowName: string; action: string; fields: Record<string, string> }
> = {
  land: {
    formId: 'ggnr-eum-land-form',
    windowName: 'Eum',
    action: 'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp',
    fields: {
      selGbn: 'umd',
      isNoScr: 'script',
      s_type: '1',
      mode: 'search',
      viewType: '',
      p_location: '',
      p_type: '',
      p_type1: '',
      p_type2: '',
      p_type3: '',
      p_type4: '',
      p_type5: '',
      p_type6: '',
      p_type7: '',
      ucodes: '',
      markUcodes: '',
      adzoom: '',
      scale: '',
      scaleFlag: '',
      hash: '',
      mobile_yn: '',
      sggcd: '',
      pnu: '',
    },
  },
  map: {
    formId: 'ggnr-eum-map-form',
    windowName: 'EumMap',
    action: 'https://www.eum.go.kr/web/mp/mpMapDet.jsp',
    fields: { pnu: '' },
  },
  plan: {
    formId: 'ggnr-eum-plan-form',
    windowName: 'EumUrbanPlan',
    action: 'https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp',
    fields: {
      pnu: '',
      mode: 'search',
      s_type: '1',
      selGbn: 'umd',
      isNoScr: 'script',
    },
  },
};

function ensureEumForm(kind: EumKind): HTMLFormElement {
  const cfg = EUM_CONFIG[kind];
  let form = document.getElementById(cfg.formId) as HTMLFormElement | null;
  if (!form) {
    form = document.createElement('form');
    form.id = cfg.formId;
    form.method = 'post';
    form.action = cfg.action;
    form.style.display = 'none';
    for (const [name, value] of Object.entries(cfg.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.dataset.eumField = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
  }
  return form;
}

function setEumFormValues(form: HTMLFormElement, pnu: string, sggcd: string) {
  const pnuEl = form.querySelector<HTMLInputElement>('[data-eum-field="pnu"]');
  const sggcdEl = form.querySelector<HTMLInputElement>('[data-eum-field="sggcd"]');
  if (pnuEl) pnuEl.value = pnu;
  if (sggcdEl) sggcdEl.value = sggcd;
}

function openEumWindow(kind: EumKind, pnu: string) {
  const digits = String(pnu ?? '').replace(/\D/g, '');
  if (!/^\d{19}$/.test(digits)) {
    window.alert('필지 번호가 없어 열 수 없습니다.');
    return;
  }
  const sggcd = digits.slice(0, 5);
  const cfg = EUM_CONFIG[kind];
  const form = ensureEumForm(kind);
  setEumFormValues(form, digits, sggcd);

  const features =
    kind === 'map'
      ? `width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`
      : 'width=1400,height=970';
  const win = window.open('', cfg.windowName, features);
  if (win) {
    win.document.write(
      '<html><head><title>이동 중</title></head><body><p>페이지 이동 중입니다..</p></body></html>'
    );
  }
  form.target = cfg.windowName;
  form.submit();
}

export function openEumLand(pnu: string) {
  openEumWindow('land', pnu);
}

export function openEumMap(pnu: string) {
  openEumWindow('map', pnu);
}

export function openEumUrbanPlan(pnu: string) {
  openEumWindow('plan', pnu);
}
