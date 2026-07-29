import type { AerialKind } from './aerialMediaTypes';
import { aerialKindRelativeRoot } from '@/lib/aerialUploadPaths';

/** 구분 → 저장 루트 (화면 안내·진행 표시 · GGNR_DATA_DIR/aerial/{kind}/) */
export const AERIAL_KIND_ROOT: Record<AerialKind, string> = {
  ortho: aerialKindRelativeRoot('ortho'),
  drone: aerialKindRelativeRoot('drone'),
  panorama: aerialKindRelativeRoot('panorama'),
  satellite: aerialKindRelativeRoot('satellite'),
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
