import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import {
  isImageServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  type ServiceFileDataRow,
} from '../../../_mapComponents/standard/useServiceFileData';
import type { RoadFrontageBuildingFormAttachId } from './roadFrontageBuildingMock';

export const ROAD_FRONTAGE_BUILDING_FILE_LAYER = 'road_frontage_building';

export const ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS: Record<
  RoadFrontageBuildingFormAttachId,
  string
> = {
  locationMap: '위치도',
  layoutPlan: '건축물',
  before: '종전',
  after: '변경',
};

export const ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER = '첨부';

export const ROAD_FRONTAGE_BUILDING_FILE_SER_ENG = SER_FILE_ENG.roadFrontageBuilding;

export function roadFrontageBuildingFileUrl(
  keyValue: string,
  fileName: string,
  subfolder: string
): string {
  return serviceFileDataDownloadUrl(
    ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue,
    fileName,
    { subfolder }
  );
}

export function firstFolderImageUrl(
  keyValue: string | null,
  files: ServiceFileDataRow[],
  subfolder: string
): string[] {
  const name = files.find((file) => isImageServiceFileName(file.name))?.name;
  if (!keyValue || !name) return [];
  return [roadFrontageBuildingFileUrl(keyValue, name, subfolder)];
}

export async function deleteFolderFiles(params: {
  keyValue: string;
  subfolder: string;
  files: ServiceFileDataRow[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const file of params.files) {
    const result = await requestServiceFileDataDelete({
      serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
      layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
      keyValue: params.keyValue,
      fileName: file.name,
      subfolder: params.subfolder,
    });
    if (!result.ok) return result;
  }
  return { ok: true };
}
