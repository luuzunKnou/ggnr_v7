/**
 * layer 스키마에 있으나 tables.json에 정의되지 않은 geometry 테이블을 public_layer 스키마로 이전.
 * 사용: npx tsx scripts/migrate-layer-undefined-to-public-layer.ts [--dry-run]
 */
import * as fs from 'fs'
import * as path from 'path'
import { Pool } from 'pg'

const TABLES_JSON_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
)

function getDatabaseConfig(): { connectionString?: string; host?: string; port?: number; database?: string; user?: string; password?: string } {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL }
  }
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  if (!fs.existsSync(TABLES_JSON_PATH)) {
    console.error('tables.json not found:', TABLES_JSON_PATH)
    process.exit(1)
  }

  const raw = fs.readFileSync(TABLES_JSON_PATH, 'utf-8')
  const tables = JSON.parse(raw) as Array<{ define_table_name?: string }>
  if (!Array.isArray(tables)) {
    console.error('Invalid tables.json format')
    process.exit(1)
  }

  const definedNames = new Set<string>(
    tables
      .map((r) => String(r.define_table_name ?? '').trim())
      .filter((n) => n.length > 0)
  )
  console.log('tables.json define_table_name count:', definedNames.size)

  const pool = new Pool(getDatabaseConfig())

  try {
    const listRes = await pool.query<{ f_table_schema: string; f_table_name: string }>(
      `SELECT f_table_schema, f_table_name
       FROM geometry_columns
       WHERE f_table_schema = 'layer'
       ORDER BY f_table_name`
    )

    const toMove = listRes.rows.filter((r) => !definedNames.has(r.f_table_name))
    console.log('layer schema geometry tables:', listRes.rows.length)
    console.log('to move (not in tables.json):', toMove.length)

    if (toMove.length === 0) {
      console.log('Nothing to move. Exiting.')
      return
    }

    if (dryRun) {
      console.log('--dry-run: would move:')
      toMove.forEach((r) => console.log('  layer.' + r.f_table_name))
      return
    }

    await pool.query('CREATE SCHEMA IF NOT EXISTS public_layer')

    const results: { table: string; status: 'ok' | 'failed'; error?: string }[] = []
    for (const row of toMove) {
      const tableName = row.f_table_name
      const sql = `ALTER TABLE layer.${quoteIdent(tableName)} SET SCHEMA public_layer`
      try {
        await pool.query(sql)
        results.push({ table: tableName, status: 'ok' })
        console.log('OK:', tableName)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        results.push({ table: tableName, status: 'failed', error: msg })
        console.error('FAIL:', tableName, msg)
      }
    }

    const ok = results.filter((r) => r.status === 'ok').length
    const failed = results.filter((r) => r.status === 'failed').length
    console.log('Done. Moved:', ok, 'Failed:', failed)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
