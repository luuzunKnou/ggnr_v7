import pg from 'pg';
import fs from 'fs';
import path from 'path';

function parseEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/\[dev\]([\s\S]*?)(?=\n\[|$)/);
  if (!m) return null;
  const block = m[1];
  const get = (k) => {
    const r = block.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return r ? r[1].trim() : '';
  };
  return {
    host: get('DATABASE_HOST'),
    port: Number(get('DATABASE_PORT') || 5432),
    database: get('DATABASE_NAME'),
    user: get('DATABASE_USER'),
    password: get('DATABASE_PASSWORD'),
  };
}

const projects = ['build_yy', 'ggnr_yj', 'river_yd', 'ggnr_ad'];
for (const p of projects) {
  const cfg = parseEnv(path.join('src/config/projects', `${p}.env`));
  if (!cfg?.host || !cfg.database) {
    console.log(p, 'skip no db');
    continue;
  }
  const c = new pg.Client({ ...cfg, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const r = await c.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='layer' AND lower(table_name) LIKE 'memo%'
      ORDER BY 1`);
    console.log(p, cfg.database, r.rows.map((x) => x.table_name));
    if (r.rows.length) {
      const t = r.rows[0].table_name;
      const cols = await c.query(
        `SELECT column_name, data_type, udt_name
         FROM information_schema.columns
         WHERE table_schema='layer' AND table_name=$1
         ORDER BY ordinal_position`,
        [t],
      );
      console.log(' sample', t, cols.rows);
      try {
        const g = await c.query(
          `SELECT type, srid FROM geometry_columns WHERE f_table_schema='layer' AND f_table_name=$1`,
          [t],
        );
        console.log(' geom', g.rows);
      } catch {}
    }
    await c.end();
  } catch (e) {
    console.log(p, 'fail', e.message);
    try { await c.end(); } catch {}
  }
}
