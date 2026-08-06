import pg from 'pg';

const c = new pg.Client({
  host: '192.168.127.32',
  port: 5433,
  database: 'build_uj',
  user: 'build_uj',
  password: 'build_uj',
  connectionTimeoutMillis: 8000,
});

await c.connect();
const col = await c.query(`
  SELECT column_name, data_type, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='layer_history' AND column_name='lh_create_user'
`);
console.log('column', col.rows);

const stats = await c.query(`
  SELECT COUNT(*)::int AS total,
         COUNT(lh_create_user)::int AS non_null,
         COUNT(*) FILTER (WHERE lh_create_user IS NULL)::int AS nulls
  FROM layer_history
`);
console.log('stats', stats.rows[0]);

const sample = await c.query(`
  SELECT lh_key, lh_create_user, pg_typeof(lh_create_user)::text AS typeof
  FROM layer_history
  ORDER BY lh_key
  LIMIT 10
`);
console.log('sample', sample.rows);

// show what bare ALTER without USING does
try {
  await c.query('BEGIN');
  await c.query('ALTER TABLE layer_history ALTER COLUMN lh_create_user TYPE integer');
  console.log('bare ALTER: OK');
  await c.query('ROLLBACK');
} catch (e) {
  console.log('bare ALTER fail:', e.message);
  await c.query('ROLLBACK');
}

try {
  await c.query('BEGIN');
  await c.query('ALTER TABLE layer_history ALTER COLUMN lh_create_user TYPE integer USING lh_create_user::integer');
  console.log('USING ALTER: OK');
  await c.query('ROLLBACK');
} catch (e) {
  console.log('USING ALTER fail:', e.message);
  await c.query('ROLLBACK');
}

await c.end();
