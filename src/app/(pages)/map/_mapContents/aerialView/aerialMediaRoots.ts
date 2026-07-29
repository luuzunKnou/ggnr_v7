import type { AerialKind } from './aerialMediaTypes';

/** 구분 → 저장 루트 (화면 안내·목업 파싱용) */
export const AERIAL_KIND_ROOT: Record<AerialKind, string> = {
  ortho: 'aerial_ortho/',
  drone: 'aerial_media/',
  panorama: 'aerial_panorama/',
  satellite: 'aerial_satellite/',
};

export const FOLDER_KIND_TOKEN: Record<string, AerialKind> = {
  드론영상: 'ortho',
  /** @deprecated 구 명칭 */
  정사영상: 'ortho',
  '사진,동영상': 'drone',
  사진동영상: 'drone',
  /** @deprecated 구 명칭 */
  드론사진동영상: 'drone',
  파노라마: 'panorama',
  항공영상: 'satellite',
};

export const KIND_TO_FOLDER_TOKEN: Record<AerialKind, string> = {
  ortho: '드론영상',
  drone: '사진동영상',
  panorama: '파노라마',
  satellite: '항공영상',
};
