/**
 * GNMS base-data export용 로컬 파라미터 (시군구 코드·도형).
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { getSggCode } from '@/service/configService';

export const GNMS_BASE_DATA_FOLDERS = ['elevation', 'ri', 'emd', 'sgg'] as const;
export type GnmsBaseDataFolder = (typeof GNMS_BASE_DATA_FOLDERS)[number];

export const SGG_MISSING_FOR_ELEVATION_MSG =
  '시군구(sgg) 테이블이 없어 등고선(elevation)을 요청할 수 없습니다. 행정경계를 먼저 준비하세요.';

const SGG_SCHEMA = 'public_layer';
const SGG_TABLE = 'sgg';

type Params = Record<string, unknown>;

function esc(v: string): string {
  return String(v ?? '').replace(/'/g, "''");
}

export function isGnmsBaseDataFolder(v: unknown): v is GnmsBaseDataFolder {
  return GNMS_BASE_DATA_FOLDERS.includes(String(v ?? '').trim() as GnmsBaseDataFolder);
}

export function normalizeAdmSectCode(raw: unknown): string {
  return String(raw ?? '').trim();
}

/** 법정동/시군구 코드를 오른쪽 0으로 자릿수 맞춤 (예: 47730 → 4773000000) */
export function padBjdCde(code: string, len = 10): string {
  const t = normalizeAdmSectCode(code);
  if (!t) return t;
  if (t.length >= len) return t;
  return t.padEnd(len, '0');
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  try {
    const res = await db.execute(
      sql.raw(`SELECT to_regclass('${esc(schema)}.${esc(table)}') IS NOT NULL AS ok`)
    );
    const row = res.rows?.[0] as { ok?: boolean } | undefined;
    return row?.ok === true;
  } catch {
    return false;
  }
}

async function getGeomMeta(
  schema: string,
  table: string
): Promise<{ geomCol: string; srid: number } | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, COALESCE(srid, 0)::int AS srid
         FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!row?.name) return null;
    const srid = Number(row.srid) || 0;
    return { geomCol: String(row.name).trim(), srid: srid > 0 ? srid : 5181 };
  } catch {
    return null;
  }
}

function sggCodeWhere(code: string): string {
  const c = esc(code);
  const padded = esc(padBjdCde(code, 10));
  return `(
    trim(adm_sect_c::text) = '${c}'
    OR trim(adm_sect_c::text) LIKE '${c}' || '%'
    OR rpad(trim(adm_sect_c::text), 10, '0') = '${padded}'
  )`;
}

/** UI 사전 검사용 — public_layer.sgg 존재 여부 */
export async function checkPublicLayerSgg(_p: Params = {}) {
  const exists = await tableExists(SGG_SCHEMA, SGG_TABLE);
  return {
    exists,
    warning: exists ? '' : SGG_MISSING_FOR_ELEVATION_MSG,
  };
}

/** 시군구 코드·명은 public_layer.sgg 우선, 없으면 runtime SGG_CODE */
async function resolveAdmSectCodeFromSgg(preferred?: string): Promise<{
  admSectC: string;
  bjdCde: string;
  sggNm: string;
}> {
  const preferredCode = normalizeAdmSectCode(preferred) || normalizeAdmSectCode(getSggCode().sggCode);
  const exists = await tableExists(SGG_SCHEMA, SGG_TABLE);
  if (!exists) {
    if (!preferredCode) {
      throw new Error('시군구 코드(SGG_CODE / adm_sect_c)를 확인할 수 없습니다.');
    }
    return { admSectC: preferredCode, bjdCde: padBjdCde(preferredCode, 10), sggNm: '' };
  }

  const orderPrefer = preferredCode
    ? `CASE WHEN ${sggCodeWhere(preferredCode)} THEN 0 ELSE 1 END,`
    : '';
  const res = await db.execute(
    sql.raw(
      `SELECT trim(adm_sect_c::text) AS adm_sect_c,
              trim(COALESCE(sgg_nm::text, '')) AS sgg_nm
       FROM "${SGG_SCHEMA}"."${SGG_TABLE}"
       WHERE adm_sect_c IS NOT NULL AND trim(adm_sect_c::text) <> ''
       ORDER BY ${orderPrefer} 1
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { adm_sect_c?: unknown; sgg_nm?: unknown } | undefined;
  const admSectC = normalizeAdmSectCode(row?.adm_sect_c) || preferredCode;
  if (!admSectC) {
    throw new Error('시군구(sgg)에서 adm_sect_c 값을 찾지 못했습니다.');
  }
  return {
    admSectC,
    bjdCde: padBjdCde(admSectC, 10),
    sggNm: normalizeAdmSectCode(row?.sgg_nm),
  };
}

async function resolveSggGeomWkt5181(admSectC: string): Promise<string> {
  const exists = await tableExists(SGG_SCHEMA, SGG_TABLE);
  if (!exists) {
    throw new Error(SGG_MISSING_FOR_ELEVATION_MSG);
  }
  const meta = await getGeomMeta(SGG_SCHEMA, SGG_TABLE);
  if (!meta) {
    throw new Error('시군구(sgg) 도형 컬럼을 찾을 수 없습니다.');
  }
  const g = `"${meta.geomCol.replace(/"/g, '""')}"`;
  const stamped = `ST_SetSRID(${g}, ${meta.srid})`;
  const res = await db.execute(
    sql.raw(
      `SELECT ST_AsText(ST_Transform(ST_MakeValid(${stamped}), 5181)) AS wkt
       FROM "${SGG_SCHEMA}"."${SGG_TABLE}"
       WHERE ${g} IS NOT NULL
         AND ${sggCodeWhere(admSectC)}
       ORDER BY 1
       LIMIT 1`
    )
  );
  const wkt = String((res.rows?.[0] as { wkt?: unknown } | undefined)?.wkt ?? '').trim();
  if (!wkt) {
    throw new Error(`시군구(sgg)에서 코드(${admSectC})에 해당하는 도형을 찾지 못했습니다.`);
  }
  return wkt;
}

export type GnmsBaseDataExportParams = {
  folder: GnmsBaseDataFolder;
  bjd_cde: string;
  /** public_layer.sgg.adm_sect_c (없으면 runtime SGG_CODE) */
  adm_sect_c: string;
  sgg_nm: string;
  geom?: string;
  sggExists: boolean;
};

/** GNMS POST /api/base-data/export 용 로컬 파라미터 (keyword는 브라우저 입력값, sgg일 때 sgg_nm 권장) */
export async function getGnmsBaseDataExportParams(p: Params): Promise<GnmsBaseDataExportParams> {
  const folderRaw = String(p.folder ?? '').trim();
  if (!isGnmsBaseDataFolder(folderRaw)) {
    throw new Error(`folder는 ${GNMS_BASE_DATA_FOLDERS.join(' | ')} 중 하나여야 합니다.`);
  }
  const folder = folderRaw;
  const sggExists = await tableExists(SGG_SCHEMA, SGG_TABLE);

  if (folder === 'elevation' && !sggExists) {
    throw new Error(SGG_MISSING_FOR_ELEVATION_MSG);
  }

  const { admSectC, bjdCde, sggNm } = await resolveAdmSectCodeFromSgg(
    normalizeAdmSectCode(p.admSectC ?? p.sggCode)
  );

  if (folder === 'elevation') {
    const geom = await resolveSggGeomWkt5181(admSectC);
    return {
      folder,
      bjd_cde: bjdCde,
      adm_sect_c: admSectC,
      sgg_nm: sggNm,
      geom,
      sggExists,
    };
  }

  return {
    folder,
    bjd_cde: bjdCde,
    adm_sect_c: admSectC,
    sgg_nm: sggNm,
    sggExists,
  };
}
