/** 지도분할 — 측정·고도 등 지도 자체 입력 초기화 대상 */
export type MapMeasurementsResetTarget = 'both' | 'primary' | 'secondary';

export const MAP_MEASUREMENTS_RESET_EVENT = 'ggnr-map-measurements-reset';

export function dispatchMapMeasurementsReset(target: MapMeasurementsResetTarget): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(MAP_MEASUREMENTS_RESET_EVENT, { detail: { target } })
  );
}

export function parseMapMeasurementsResetTarget(e: Event): MapMeasurementsResetTarget | null {
  const detail = (e as CustomEvent<{ target?: MapMeasurementsResetTarget }>).detail;
  const t = detail?.target;
  return t === 'both' || t === 'primary' || t === 'secondary' ? t : null;
}
