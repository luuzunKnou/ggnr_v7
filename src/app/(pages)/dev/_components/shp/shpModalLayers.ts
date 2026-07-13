/** SHP 위저드(z-50) 위에 올리는 정합성 검증 모달 레이어 */
export const SHP_SYNC_DETAIL_MODAL_ATTR = 'data-shp-sync-detail-modal';
export const SHP_SYNC_DETAIL_ROOT_SELECTOR = `[${SHP_SYNC_DETAIL_MODAL_ATTR}]`;

export const SHP_WIZARD_DIALOG_Z = 50;
export const SHP_SYNC_DETAIL_MODAL_Z = 200;
export const SHP_SYNC_DETAIL_NESTED_Z = 210;

export function isShpSyncDetailModalTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(SHP_SYNC_DETAIL_ROOT_SELECTOR);
}
