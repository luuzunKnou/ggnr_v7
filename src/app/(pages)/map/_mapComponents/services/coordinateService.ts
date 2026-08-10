import { get as getProjection, transform } from 'ol/proj';
import { View } from 'ol';
import { Map } from 'ol';
import { RESOLUTIONS_3857 } from '../config/mapDefaults';

/**
 * 좌표계 변환 서비스
 * 순수 함수로 구현하여 테스트 및 재사용 용이
 */

/**
 * 좌표를 변환하고 유효성을 검증
 */
export function transformCoordinate(
  center: [number, number] | null | undefined,
  fromProjection: string,
  toProjection: string
): [number, number] | null {
  if (!center || center.length !== 2) return null;

  const fromProj = getProjection(fromProjection);
  const toProj = getProjection(toProjection);

  if (!fromProj || !toProj) {
    console.error(`좌표계를 찾을 수 없습니다: ${fromProjection} -> ${toProjection}`);
    return null;
  }

  try {
    const transformed = transform(center, fromProj, toProj);

    if (
      transformed &&
      transformed.length === 2 &&
      !isNaN(transformed[0]) &&
      !isNaN(transformed[1])
    ) {
      return transformed as [number, number];
    }
  } catch (e) {
    console.error('좌표계 변환 실패:', e);
  }

  return null;
}

/**
 * 한국 영역 내 좌표인지 검증 (EPSG:5181)
 */
export function isValidKoreaCoordinate5181(
  coord: [number, number]
): boolean {
  const [x, y] = coord;
  return x >= -50000 && x <= 500000 && y >= -100000 && y <= 1000000;
}

/**
 * 한국 영역 내 좌표인지 검증 (EPSG:3857)
 */
export function isValidKoreaCoordinate3857(
  coord: [number, number]
): boolean {
  const [x, y] = coord;
  return (
    x >= 10000000 &&
    x <= 16000000 &&
    y >= 3000000 &&
    y <= 5500000
  );
}

/**
 * 서울 중심 좌표를 특정 좌표계로 변환
 */
export function getSeoulCenter(projection: string): [number, number] | null {
  const wgs84Proj = getProjection('EPSG:4326');
  const targetProj = getProjection(projection);

  if (!wgs84Proj || !targetProj) return null;

  const seoulWGS84: [number, number] = [126.9780, 37.5665]; // [lon, lat]
  return transformCoordinate(seoulWGS84, 'EPSG:4326', projection);
}

/**
 * 카카오맵용 좌표계 변환 (EPSG:3857 -> EPSG:5181)
 */
export function transformToKakaoProjection(
  center: [number, number] | null | undefined,
  currentProjection: string
): [number, number] | null {
  if (!center) return null;

  // EPSG:3857 -> EPSG:5181 변환
  let newCenter = transformCoordinate(center, currentProjection, 'EPSG:5181');

  if (newCenter && isValidKoreaCoordinate5181(newCenter)) {
    return newCenter;
  }

  // 변환 실패 시 서울 중심 좌표 사용
  return getSeoulCenter('EPSG:5181') || [200000, 500000];
}

/**
 * 일반 좌표계로 변환 (EPSG:5181 -> EPSG:3857)
 */
export function transformToStandardProjection(
  center: [number, number] | null | undefined,
  currentProjection: string
): [number, number] | null {
  if (!center) return null;

  // 이미 EPSG:3857이면 그대로 사용
  if (currentProjection === 'EPSG:3857') {
    return center;
  }

  // EPSG:5181 -> EPSG:3857 변환
  if (currentProjection === 'EPSG:5181') {
    let newCenter = transformCoordinate(center, 'EPSG:5181', 'EPSG:3857');

    if (newCenter && isValidKoreaCoordinate3857(newCenter)) {
      return newCenter;
    }
  }

  // 변환 실패 시 서울 중심 좌표 사용
  return getSeoulCenter('EPSG:3857') || [14135290, 4515020];
}

/**
 * View의 좌표계를 변경하고 중심 좌표를 변환.
 * 새 View를 만들 때 기존 view.padding을 유지한다.
 * (미유지 시 왼쪽 패널 패딩이 사라져 센터마크 기준 지도가 오른쪽으로 밀려 보임)
 */
export function updateViewProjection(
  map: Map,
  newProjection: string,
  center?: [number, number] | null
): void {
  const view = map.getView();
  const currentZoom = view.getZoom() ?? 7;
  const currentCenter = center || view.getCenter();
  const currentProjection = view.getProjection()?.getCode();

  const targetProj = getProjection(newProjection);
  if (!targetProj) {
    console.error(`좌표계를 찾을 수 없습니다: ${newProjection}`);
    return;
  }

  // 좌표계가 같으면 View 재생성 불필요(배경 레이어만 교체) — padding·중심 유지
  if (currentProjection === newProjection) {
    return;
  }

  const prevPadding = view.padding
    ? ([...(view.padding as number[])] as [number, number, number, number])
    : null;

  let newCenter: [number, number] | null = null;

  if (newProjection === 'EPSG:5181') {
    // 카카오맵으로 변경
    newCenter = transformToKakaoProjection(
      currentCenter as [number, number] | null,
      currentProjection || 'EPSG:3857'
    );
  } else if (newProjection === 'EPSG:3857') {
    // 일반 (3857) 좌표계로 변경
    newCenter = transformToStandardProjection(
      currentCenter as [number, number] | null,
      currentProjection || 'EPSG:3857'
    );
  } else {
    // 그 외 한국 평면/위경도 좌표계 (자체영상 view 좌표계 등). proj4 일반 변환 후 실패시 서울 중심 폴백
    const cur = currentProjection || 'EPSG:3857';
    newCenter = transformCoordinate(
      currentCenter as [number, number] | null,
      cur,
      newProjection
    );
    if (!newCenter) {
      newCenter = getSeoulCenter(newProjection);
    }
  }

  if (newCenter) {
    const viewOptions: {
      projection: typeof targetProj;
      center: [number, number];
      zoom: number;
      resolutions?: number[];
      minZoom?: number;
      maxZoom?: number;
      constrainResolution?: boolean;
      padding?: [number, number, number, number];
    } = {
      projection: targetProj,
      center: newCenter,
      zoom: currentZoom,
    };
    if (newProjection === 'EPSG:3857') {
      viewOptions.resolutions = RESOLUTIONS_3857;
      viewOptions.minZoom = 0;
      viewOptions.maxZoom = RESOLUTIONS_3857.length - 1;
      viewOptions.constrainResolution = true;
    }
    if (prevPadding) {
      viewOptions.padding = prevPadding;
    }
    map.setView(new View(viewOptions));
  } else {
    console.error('좌표 변환 실패: 유효한 중심 좌표를 얻을 수 없습니다.');
  }
}
