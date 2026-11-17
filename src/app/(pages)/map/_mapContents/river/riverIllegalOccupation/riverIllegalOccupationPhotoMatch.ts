/**
 * 불법점용 첨부 파일명·폴더 키 매칭 (서버·클라이언트 공용)
 */
import {
  RIVER_ILLEGAL_PHOTO_SLOTS,
  type RiverIllegalPhotoField,
} from "./riverIllegalOccupationConfig";
import { isImageServiceFileName } from "@/lib/serviceFileName";

export type RiverIllegalAttachFileRow = { name: string; size?: number; modified?: string };

/** 첨부 폴더·파일 접두 — 관리번호 그대로 (HCBJ_000002) */
export function riverIllegalFileKey(mgmtNo: string): string {
  return String(mgmtNo ?? "").trim();
}

/** 구형 파일명용 (HCBJ000002) */
export function riverIllegalFileKeyLegacy(mgmtNo: string): string {
  return riverIllegalFileKey(mgmtNo).replace(/_/g, "");
}

function riverIllegalPhotoStemCandidates(mgmtNo: string, field: RiverIllegalPhotoField): string[] {
  const suffix = RIVER_ILLEGAL_PHOTO_SLOTS[field].fileSuffix;
  const key = riverIllegalFileKey(mgmtNo);
  const noUs = riverIllegalFileKeyLegacy(mgmtNo);
  const out = new Set<string>();
  for (const base of [key, noUs]) {
    if (!base) continue;
    out.add(`${base}${suffix}`);
    out.add(`${base}_${suffix}`);
  }
  return [...out];
}

/** 저장 stem — HCBJ_000001_현황사진1 */
export function riverIllegalPhotoFileStem(mgmtNo: string, field: RiverIllegalPhotoField): string {
  const key = riverIllegalFileKey(mgmtNo);
  const suffix = RIVER_ILLEGAL_PHOTO_SLOTS[field].fileSuffix;
  return `${key}_${suffix}`;
}

export function riverIllegalPhotoSaveFileName(
  mgmtNo: string,
  field: RiverIllegalPhotoField,
  sourceName: string
): string {
  const stem = riverIllegalPhotoFileStem(mgmtNo, field);
  const m = String(sourceName ?? "").match(/(\.[a-zA-Z0-9]+)$/);
  const ext = m?.[1] && isImageServiceFileName(`x${m[1]}`) ? m[1]!.toLowerCase() : ".jpg";
  return `${stem}${ext}`;
}

export function findRiverIllegalPhotoFile(
  files: RiverIllegalAttachFileRow[],
  mgmtNo: string,
  field: RiverIllegalPhotoField
): RiverIllegalAttachFileRow | null {
  const suffix = RIVER_ILLEGAL_PHOTO_SLOTS[field].fileSuffix.toLowerCase();
  const wants = new Set(riverIllegalPhotoStemCandidates(mgmtNo, field).map((s) => s.toLowerCase()));
  let bySuffixOnly: RiverIllegalAttachFileRow | null = null;
  for (const f of files) {
    const name = String(f.name ?? "").trim();
    if (!name || !isImageServiceFileName(name)) continue;
    const base = name.replace(/\.[^.]+$/, "").toLowerCase();
    if (wants.has(base)) return f;
    if (!bySuffixOnly && base === suffix) bySuffixOnly = f;
  }
  return bySuffixOnly;
}
