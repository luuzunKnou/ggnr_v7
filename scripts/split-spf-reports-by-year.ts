/**
 * spf_check.surv_date 연도별로 spf_report 를 만들고 report_id 를 다시 연결한다.
 * 사용: npx tsx scripts/split-spf-reports-by-year.ts --project ggnr_sy --env dev
 */
import { loadProjectEnv } from './load-project-env'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

async function main() {
  const project = argValue('--project') || 'ggnr_sy'
  const env = argValue('--env') || 'dev'
  loadProjectEnv(project, env)

  const { pool } = await import('../src/database/db')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const yearsRes = await client.query<{ y: number; n: number }>(`
      SELECT
        COALESCE(
          NULLIF(substring(trim(surv_date) from 1 for 4), '')::int,
          2020
        ) AS y,
        count(*)::int AS n
      FROM layer.spf_check
      GROUP BY 1
      ORDER BY 1
    `)
    console.log('[split-report] years', yearsRes.rows)

    await client.query('DELETE FROM layer.spf_report')
    await client.query(`SELECT setval(pg_get_serial_sequence('layer.spf_report','id'), 1, false)`)

    const yearToId = new Map<number, number>()
    for (const row of yearsRes.rows) {
      const year = Number(row.y)
      const ins = await client.query<{ id: number }>(
        `INSERT INTO layer.spf_report (year, write_date, title, agency, author, target_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          year,
          `${year}-12-31`,
          `소규모 공공시설 안전점검 ${year}년`,
          '',
          '',
          row.n,
        ]
      )
      yearToId.set(year, ins.rows[0]!.id)
      console.log('[split-report] report', ins.rows[0]!.id, 'year', year, 'n', row.n)
    }

    for (const [year, reportId] of yearToId) {
      const upd = await client.query(
        `UPDATE layer.spf_check
         SET report_id = $1
         WHERE COALESCE(NULLIF(substring(trim(surv_date) from 1 for 4), '')::int, 2020) = $2`,
        [reportId, year]
      )
      console.log('[split-report] linked checks year', year, '→ report', reportId, 'rows', upd.rowCount)
    }

    await client.query('COMMIT')
    const verify = await client.query(`
      SELECT r.id, r.year, r.title, r.target_count,
             (SELECT count(*)::int FROM layer.spf_check c WHERE c.report_id = r.id) AS linked
      FROM layer.spf_report r
      ORDER BY r.year`)
    console.log('[split-report] done', verify.rows)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
