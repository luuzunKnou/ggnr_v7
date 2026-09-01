/**
 * 지적 도형에 붙는 소유구분 칼럼.
 * 도형 단계에서 지적 테이블이 통째로 교체되므로 교체 직후 빈 칼럼을 만들어 두고,
 * 토지기본정보 적재가 끝난 뒤 값을 채운다.
 */
import { pool } from '@/database/db';

export const JIJUK_TABLE = 'jijuk';
export const JIJUK_OWN_GBN_COLUMN = 'own_gbn';

function qi(ident: string): string {
  const n = ident.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`잘못된 식별자: ${ident}`);
  return `"${n}"`;
}

/** 소유구분 칼럼·인덱스 보장. 이미 있으면 그대로 둔다 */
export async function ensureJijukOwnGbnColumn(
  schema: string,
  table: string = JIJUK_TABLE
): Promise<void> {
  // 폭을 코드 길이(2)에 맞추지 않는다. 원본에 규격 밖 값이 한 건이라도 오면 갱신 전체가 실패한다
  await pool.query(
    `alter table ${qi(schema)}.${qi(table)}
       add column if not exists ${qi(JIJUK_OWN_GBN_COLUMN)} varchar(10)`
  );
  await pool.query(
    `create index if not exists ${qi(`${table}_${JIJUK_OWN_GBN_COLUMN}_idx`)}
       on ${qi(schema)}.${qi(table)} (${qi(JIJUK_OWN_GBN_COLUMN)})`
  );
}
