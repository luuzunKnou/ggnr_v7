/**
 * 잘못 옮긴 종전/변경 → 첨부 폴더로 복구
 * (키 루트에 있던 기존 사진은 «첨부»에 보여야 함)
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'fs';
import { join } from 'path';
import { loadProjectEnv } from './load-project-env';

loadProjectEnv('build_yy', 'dev');

const LAYER = 'road_frontage_building';
const FROM = ['종전', '변경'] as const;
const TO = '첨부';

function resolveDataRoot(): string {
  const raw = String(process.env.GGNR_DATA_DIR ?? '').trim();
  if (!raw) throw new Error('GGNR_DATA_DIR 없음');
  return raw.replace(/[\\/]+$/, '');
}

function tryRmdir(dir: string) {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* ignore */
  }
}

function main() {
  const root = join(resolveDataRoot(), 'file_data', LAYER);
  if (!existsSync(root)) {
    console.error('없음:', root);
    process.exit(1);
  }

  let moved = 0;
  let skipped = 0;
  const keys = readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const key of keys) {
    const keyDir = join(root, key);
    const destDir = join(keyDir, TO);
    for (const folder of FROM) {
      const srcDir = join(keyDir, folder);
      if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;
      for (const name of readdirSync(srcDir)) {
        const src = join(srcDir, name);
        if (!statSync(src).isFile()) continue;
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const dest = join(destDir, name);
        if (existsSync(dest)) {
          console.warn('이미 있음:', dest);
          skipped++;
          continue;
        }
        renameSync(src, dest);
        moved++;
      }
      tryRmdir(srcDir);
    }
  }

  console.log({ root, keys: keys.length, moved, skipped, to: TO });
}

main();
