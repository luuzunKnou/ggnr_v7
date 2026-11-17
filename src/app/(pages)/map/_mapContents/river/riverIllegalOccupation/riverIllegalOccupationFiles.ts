/**
 * 불법점용 관리카드 첨부 (클라이언트 — URL·업로드·목록 hydrate)
 * 폴더: file_data/illegal_usage_as/HCBJ_######/
 * 파일: HCBJ_######_접미사.ext
 */
import {
  RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
  RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
  RIVER_ILLEGAL_PHOTO_SLOTS,
  type RiverIllegalPhotoField,
} from "./riverIllegalOccupationConfig";
import { appFetch } from "@/lib/basePath";
import {
  serviceFileDataDownloadUrl,
  type ServiceFileDataRow,
} from "../../../_mapComponents/standard/useServiceFileData";
import type { RiverIllegalOccupationCard } from "./riverIllegalOccupationModel";
import {
  findRiverIllegalPhotoFile,
  riverIllegalFileKey,
  riverIllegalFileKeyLegacy,
  riverIllegalPhotoSaveFileName,
} from "./riverIllegalOccupationPhotoMatch";

export {
  RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
  RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
  RIVER_ILLEGAL_PHOTO_SLOTS,
};
export type { RiverIllegalPhotoField };
export {
  riverIllegalFileKey,
  riverIllegalFileKeyLegacy,
  riverIllegalPhotoFileStem,
  riverIllegalPhotoSaveFileName,
  findRiverIllegalPhotoFile,
} from "./riverIllegalOccupationPhotoMatch";

/** 신규 폴더(밑줄) 우선, 없으면 구형 폴더에서 사진 URL 해석 */
export function resolveRiverIllegalPhoto(
  primaryKey: string,
  primaryFiles: ServiceFileDataRow[],
  legacyKey: string | null,
  legacyFiles: ServiceFileDataRow[],
  field: RiverIllegalPhotoField
): { key: string; file: ServiceFileDataRow; url: string } | null {
  const key = riverIllegalFileKey(primaryKey);
  if (!key) return null;
  const hitPrimary = findRiverIllegalPhotoFile(primaryFiles, key, field);
  if (hitPrimary) {
    return {
      key,
      file: hitPrimary as ServiceFileDataRow,
      url: serviceFileDataDownloadUrl(
        RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
        RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
        key,
        hitPrimary.name
      ),
    };
  }
  const leg = legacyKey ? riverIllegalFileKey(legacyKey) : "";
  if (leg && leg !== key) {
    const hitLegacy = findRiverIllegalPhotoFile(legacyFiles, leg, field);
    if (hitLegacy) {
      return {
        key: leg,
        file: hitLegacy as ServiceFileDataRow,
        url: serviceFileDataDownloadUrl(
          RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
          RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
          leg,
          hitLegacy.name
        ),
      };
    }
  }
  return null;
}

export function riverIllegalPhotoDisplayUrl(
  files: ServiceFileDataRow[],
  mgmtNo: string,
  field: RiverIllegalPhotoField
): string {
  const resolved = resolveRiverIllegalPhoto(mgmtNo, files, null, [], field);
  return resolved?.url ?? "";
}

/** 업로드용 File — 원본 바이트 + 규정 파일명 */
export function riverIllegalNamedPhotoFile(
  file: File,
  mgmtNo: string,
  field: RiverIllegalPhotoField
): File {
  const name = riverIllegalPhotoSaveFileName(mgmtNo, field, file.name);
  return new File([file], name, { type: file.type || "image/jpeg" });
}

const PHOTO_URL_FIELDS = [
  "locationMapUrl",
  "photo1Url",
  "photo2Url",
  "completePhotoUrl",
] as const satisfies readonly RiverIllegalPhotoField[];

async function listRiverIllegalAttachFiles(keyValue: string): Promise<ServiceFileDataRow[]> {
  const key = String(keyValue ?? "").trim();
  if (!key) return [];
  const qs = new URLSearchParams({
    serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
    layer: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
    key,
    meta: "0",
  });
  try {
    const r = await appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" });
    if (!r.ok) return [];
    const data = (await r.json()) as { files?: ServiceFileDataRow[] };
    return Array.isArray(data.files) ? data.files : [];
  } catch {
    return [];
  }
}

/**
 * 목록·인쇄용 — 카드에 첨부 사진 URL을 채운다.
 */
export async function hydrateRiverIllegalCardPhotoUrls(
  card: RiverIllegalOccupationCard
): Promise<RiverIllegalOccupationCard> {
  const key = riverIllegalFileKey(card.mgmtNo);
  if (!key) return card;
  const legacy = riverIllegalFileKeyLegacy(card.mgmtNo);
  const [primaryFiles, legacyFiles] = await Promise.all([
    listRiverIllegalAttachFiles(key),
    legacy && legacy !== key ? listRiverIllegalAttachFiles(legacy) : Promise.resolve([]),
  ]);
  const next = { ...card };
  for (const field of PHOTO_URL_FIELDS) {
    const hit = resolveRiverIllegalPhoto(
      key,
      primaryFiles,
      legacy !== key ? legacy : null,
      legacyFiles,
      field
    );
    next[field] = hit?.url ?? "";
  }
  return next;
}
