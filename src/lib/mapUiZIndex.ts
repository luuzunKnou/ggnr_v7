/**
 * 지도 UI 플로팅·모달 z-index.
 * 값·selected(+1) 규칙은 `standard-utilities.css` (:root --map-ui-z-* / .map-ui-z-*).
 * 아래 숫자는 Dialog `layerZIndex` 등 인라인이 필요할 때만 CSS와 동기화해 둔다.
 */
export const MAP_UI_Z = {
  viewportFloating: 120,
  resultModal: 1300,
  addressInfo: 10000,
  detailFloating: 10050,
  /** 연관 상세 = detail + 2 */
  detailRelated: 10052,
  nestedDialog: 10100,
  filePreview: 11000,
  systemSelect: 20100,
  accessRequest: 21000,
} as const;

export type MapUiZLayer = keyof typeof MAP_UI_Z_CLASS;

/** CSS 클래스 (standard-utilities.css) */
export const MAP_UI_Z_CLASS = {
  viewportFloating: 'map-ui-z-viewport',
  resultModal: 'map-ui-z-result',
  addressInfo: 'map-ui-z-address',
  detailFloating: 'map-ui-z-detail',
  detailRelated: 'map-ui-z-detail-related',
  nestedDialog: 'map-ui-z-nested',
  filePreview: 'map-ui-z-file-preview',
  systemSelect: 'map-ui-z-system-select',
  accessRequest: 'map-ui-z-access-request',
} as const;

/** 클릭한 패널만 같은 티어에서 +1 */
export const MAP_UI_Z_SELECTED_CLASS = 'map-ui-z-selected';

let selectedPanel: HTMLElement | null = null;

/** 직전에 선택한 플로팅만 selected. 이전 선택은 해제. */
export function selectMapUiZPanel(el: HTMLElement | null) {
  if (selectedPanel && selectedPanel !== el) {
    selectedPanel.classList.remove(MAP_UI_Z_SELECTED_CLASS);
  }
  if (el) {
    el.classList.add(MAP_UI_Z_SELECTED_CLASS);
  }
  selectedPanel = el;
}

export function clearMapUiZPanelSelection(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove(MAP_UI_Z_SELECTED_CLASS);
  if (selectedPanel === el) selectedPanel = null;
}
