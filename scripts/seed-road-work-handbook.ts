/**
 * 하드코딩된 대상여부 검토·설계실무요령 자료를 layer 테이블에 적재
 * 사용: npx tsx scripts/seed-road-work-handbook.ts [project] [env] [review|all]
 * 세 번째 인자 review 이면 대상여부 검토만 다시 넣는다.
 */
import { loadProjectEnv } from './load-project-env';

const project = String(process.argv[2] ?? 'build_yy').trim() || 'build_yy';
const env = String(process.argv[3] ?? 'dev').trim() || 'dev';
const only = String(process.argv[4] ?? 'all').trim() || 'all';
loadProjectEnv(project, env);

function formulaOf(
  kind: string | undefined
): Record<string, unknown> | null {
  switch (kind) {
    case 'newWiden':
      return { kind: 'newWiden', new_km: 4, widen_km: 10 };
    case 'zoneArea':
      return {
        kind: 'zoneArea',
        zones: {
          보전관리: 5000,
          생산관리: 7500,
          계획관리: 10000,
          농림: 7500,
          자연환경보전: 5000,
        },
      };
    case 'newLen5':
      return { kind: 'newLen5', new_km: 5 };
    case 'roadTypeLen':
      return { kind: 'roadTypeLen', roads: { 국도: 5, 지방도: 3, 시도: 1 } };
    case 'disaster':
      return {
        kind: 'disaster',
        eval_area: 50000,
        review_area: 5000,
        eval_km: 10,
        review_km: 2,
      };
    case 'area30000':
      return { kind: 'area30000', area: 30000 };
    case 'cost100':
      return { kind: 'cost100', cost: 100 };
    case 'cost50':
      return { kind: 'cost50', cost: 50 };
    case 'facilityOrCost':
      return { kind: 'facilityOrCost', cost: 300 };
    default:
      return null;
  }
}

async function main() {
  const { pool } = await import('../src/database/db');
  const { ensureRoadWorkHandbookTables } = await import('../src/service/ensureLayerAppTables');
  const { HANDBOOK_PROCEDURES } = await import(
    '../src/app/(pages)/map/_mapContents/road/roadWorkHandbook/roadWorkHandbookProcedures.seed'
  );
  const { HANDBOOK_MATERIALS, getHandbookLawXmlApiUrl } = await import(
    '../src/app/(pages)/map/_mapContents/road/roadWorkHandbook/roadWorkHandbookMaterials'
  );

  try {
    const ensured = await ensureRoadWorkHandbookTables();
    if (ensured.errors.length > 0) {
      console.error(ensured);
      process.exitCode = 1;
      return;
    }

    const reviewOnly = only === 'review';
    if (reviewOnly) {
      await pool.query('TRUNCATE layer.rd_work_target_review RESTART IDENTITY');
    } else {
      await pool.query('TRUNCATE layer.rd_work_target_review, layer.rd_hbook_mat RESTART IDENTITY');
    }

    for (const proc of HANDBOOK_PROCEDURES) {
      await pool.query(
        `INSERT INTO layer.rd_work_target_review
          (seq_no, title, criteria, law, timing, tgt_content, impl_org, remark, formula)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          proc.no,
          proc.name,
          proc.criteria,
          proc.law,
          proc.when,
          proc.criteriaItems.join('\n'),
          proc.org,
          proc.note ?? null,
          formulaOf(proc.exampleKind) == null ? null : JSON.stringify(formulaOf(proc.exampleKind)),
        ]
      );
    }

    if (!reviewOnly) {
      for (let i = 0; i < HANDBOOK_MATERIALS.length; i++) {
        const mat = HANDBOOK_MATERIALS[i];
        const matUrl = mat.files
          .map((f) => String(f.url ?? '').trim())
          .filter(Boolean)
          .join('\n');
        await pool.query(
          `INSERT INTO layer.rd_hbook_mat
            (seq_no, category, title, remark, mat_url, xml_url, orig_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            i + 1,
            mat.chapter,
            mat.name,
            mat.source,
            matUrl || null,
            getHandbookLawXmlApiUrl(mat.id),
            String(mat.lawViewUrl ?? '').trim() || null,
          ]
        );
      }
    }

    const review = await pool.query('SELECT count(*)::int AS c FROM layer.rd_work_target_review');
    const mats = await pool.query('SELECT count(*)::int AS c FROM layer.rd_hbook_mat');
    const formula = await pool.query(
      `SELECT count(*)::int AS c FROM layer.rd_work_target_review WHERE formula IS NOT NULL`
    );
    console.log(
      JSON.stringify(
        {
          review: review.rows[0]?.c,
          materials: mats.rows[0]?.c,
          formula: formula.rows[0]?.c,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
