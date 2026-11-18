/**
 * 수치지형도 — GGNR_DATA_DIR/digital_map/수치지형도(축척).pmtiles
 * PMTiles 파일 목록이 곧 서비스 목록이다. (파일 읽기: @/lib/digitalMapPmtiles)
 */
import { getSessionUsrId } from '@/lib/auth/guard';
import { hasDigitalMapPmtiles, listDigitalMapPmtiles, type DigitalMapPmtilesInfo } from '@/lib/digitalMapPmtiles';

export type DigitalMapFolderInfo = DigitalMapPmtilesInfo;

/** 서비스할 PMTiles 가 하나라도 있는지 — 사이드 «수치지형도» 버튼 노출 여부 */
export async function available(): Promise<{ available: boolean }> {
  await getSessionUsrId();
  return { available: await hasDigitalMapPmtiles() };
}

/** 서비스 중인 PMTiles 목록 (이름·줌 범위·위치) */
export async function listFolders(): Promise<{ folders: DigitalMapFolderInfo[] }> {
  await getSessionUsrId();
  return { folders: await listDigitalMapPmtiles() };
}
