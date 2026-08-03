import type { AerialKind } from '@/app/(pages)/map/_mapContents/aerialView/aerialMediaTypes';
import type { ShootType } from './shootingRequestMockData';

/** 촬영형태 → 영상관리 메뉴 종류 (1:1) */
export function shootTypeToAerialKind(shootType: ShootType): AerialKind {
  return shootType;
}

export function aerialKindToOpenedKey(kind: AerialKind): string {
  switch (kind) {
    case 'ortho':
      return 'aerialOrtho';
    case 'drone':
      return 'aerialDrone';
    case 'panorama':
      return 'aerialPanorama';
    case 'satellite':
      return 'aerialSatellite';
  }
}
