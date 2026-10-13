import { loadProjectEnv } from './load-project-env';
import { Pool } from 'pg';

loadProjectEnv('build_uj', 'dev');

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

async function main() {
  console.log('db', process.env.DATABASE_HOST, process.env.DATABASE_NAME);
  const cols = await pool.query(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='layer' AND table_name='memo'
    ORDER BY ordinal_position
  `);
  console.log('columns', JSON.stringify(cols.rows, null, 2));
  const gc = await pool.query(`
    SELECT f_table_name, f_geometry_column, type, srid, coord_dimension
    FROM geometry_columns
    WHERE f_table_schema='layer' AND f_table_name='memo'
  `);
  console.log('geometry_columns', JSON.stringify(gc.rows, null, 2));
  const cons = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'layer.memo'::regclass
  `);
  console.log('constraints', JSON.stringify(cons.rows, null, 2));
  try {
    await pool.query(`
      INSERT INTO layer.memo (memo_title, memo_contents, memo_create_date, memo_create_user, memo_create_group, memo_is_del, address, geom)
      VALUES ('__probe__', '테스트', '2026-09-08', '슈퍼관리자', '시스템', false, 'probe',
        ST_SetSRID(ST_GeomFromText('POINT(413664.0563131919 390418.38407516055)'), 5181))
      RETURNING memo_key
    `);
    console.log('insert ok — rolling back');
    await pool.query(`DELETE FROM layer.memo WHERE memo_title = '__probe__'`);
  } catch (e) {
    console.log('insert fail:', e instanceof Error ? e.message : e);
    if (e && typeof e === 'object' && 'code' in e) console.log('code', (e as { code?: string }).code);
    if (e && typeof e === 'object' && 'detail' in e) console.log('detail', (e as { detail?: string }).detail);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
