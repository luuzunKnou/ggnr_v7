import type { ConsoleMenuDef } from '../types';

/** 개발자 모드 서브메뉴 (AdminConsoleLayout·registry 공통) */
export const DEV_CONSOLE_MENUS = [
  { id: 'systemList', label: '시스템 목록관리' },
  { id: 'serviceList', label: '기능 목록관리' },
  { id: 'systemIntegration', label: '시스템 연계' },
  { id: 'geocodingTest', label: '지오코딩 테스트' },
  { id: 'userManager', label: '사용자관리' },
  { id: 'permissionFeature', label: '권한관리' },
  { id: 'accessRequestQueue', label: '권한 신청 처리' },
  { id: 'shpFileUploader', label: 'SHP File Uploader' },
  { id: 'exlFileUploader', label: 'Excel File Uploader' },
  { id: 'dataFileUploader', label: 'Data File Upload' },
  { id: 'sourceCodeUploader', label: '소스코드 업로더' },
  { id: 'versionManager', label: '버전관리' },
  { id: 'layerInfo', label: '레이어 정보관리' },
  { id: 'layerAttr', label: '레이어 속성관리' },
  { id: 'layerCode', label: '레이어 코드관리' },
  { id: 'systemVar', label: '시스템 변수' },
  { id: 'dbManager', label: 'DB Manager' },
  { id: 'geoserverManagerLayer', label: 'Geoserver Manager [layer]' },
  { id: 'geoserverManagerPublic', label: 'Geoserver Manager [public]' },
  { id: 'lasFileUploader', label: 'LAS File Uploader' },
  { id: 'fileManager', label: 'File Manager' },
  { id: 'fileConverter', label: 'File Converter' },
  { id: 'dataMigration', label: 'Data Migration' },
  { id: 'lasFixer', label: 'LAS Fixer' },
  { id: 'orthophotoManager', label: '정사영상관리' },
] as const satisfies readonly ConsoleMenuDef[];

export type DevConsoleMenuId = (typeof DEV_CONSOLE_MENUS)[number]['id'];
