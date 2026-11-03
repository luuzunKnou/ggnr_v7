/**
 * postinstall: node_modules 정적 자산을 public 으로 동기화.
 * 패키지 version(+동기화 대상 상대경로)이 marker 와 같으면 복사 skip.
 *
 * Usage:
 *   npx tsx scripts/sync-public-static-libs.ts
 *   npx tsx scripts/sync-public-static-libs.ts --force
 */
import fs from 'node:fs';
import path from 'node:path';

type SyncTarget = {
  id: string;
  packageName: string;
  /** node_modules/<packageName>/ 기준 상대 → public 상대 */
  copies: Array<{ fromRel: string; toRel: string; isDir?: boolean }>;
  markerRel: string;
};

const TARGETS: SyncTarget[] = [
  {
    id: 'cesium',
    packageName: 'cesium',
    markerRel: 'public/cesiumStatic/.lib-sync.json',
    copies: [
      { fromRel: 'Build/Cesium/Workers', toRel: 'public/cesiumStatic/Workers', isDir: true },
      { fromRel: 'Build/Cesium/ThirdParty', toRel: 'public/cesiumStatic/ThirdParty', isDir: true },
      { fromRel: 'Build/Cesium/Assets', toRel: 'public/cesiumStatic/Assets', isDir: true },
      { fromRel: 'Build/Cesium/Widgets', toRel: 'public/cesiumStatic/Widgets', isDir: true },
    ],
  },
  {
    id: 'pdfjs-dist',
    packageName: 'pdfjs-dist',
    markerRel: 'public/.pdfjs-worker-sync.json',
    copies: [
      {
        fromRel: 'build/pdf.worker.min.mjs',
        toRel: 'public/pdf.worker.min.mjs',
        isDir: false,
      },
    ],
  },
];

type Marker = {
  packageName: string;
  version: string;
  copies: string[];
};

function readPkgVersion(root: string, packageName: string): string | null {
  const pkgPath = path.join(root, 'node_modules', packageName, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

function readMarker(root: string, markerRel: string): Marker | null {
  const p = path.join(root, markerRel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Marker;
  } catch {
    return null;
  }
}

function writeMarker(root: string, markerRel: string, marker: Marker): void {
  const p = path.join(root, markerRel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

function destLooksPresent(root: string, target: SyncTarget): boolean {
  return target.copies.every((c) => fs.existsSync(path.join(root, c.toRel)));
}

function syncOne(root: string, target: SyncTarget, force: boolean): {
  id: string;
  action: 'skip' | 'copied' | 'missing';
  version: string | null;
  ms: number;
} {
  const t0 = Date.now();
  const version = readPkgVersion(root, target.packageName);
  if (!version) {
    return { id: target.id, action: 'missing', version: null, ms: Date.now() - t0 };
  }

  const copiesKey = target.copies.map((c) => `${c.fromRel}->${c.toRel}`).sort();
  const marker = readMarker(root, target.markerRel);
  const same =
    !force &&
    marker?.packageName === target.packageName &&
    marker.version === version &&
    Array.isArray(marker.copies) &&
    marker.copies.join('|') === copiesKey.join('|') &&
    destLooksPresent(root, target);

  if (same) {
    return { id: target.id, action: 'skip', version, ms: Date.now() - t0 };
  }

  const pkgRoot = path.join(root, 'node_modules', target.packageName);
  for (const c of target.copies) {
    const from = path.join(pkgRoot, c.fromRel);
    const to = path.join(root, c.toRel);
    if (!fs.existsSync(from)) {
      throw new Error(`[sync-public-static-libs] 원본 없음: ${from}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (c.isDir) {
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync(from, to, { recursive: true, force: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }

  writeMarker(root, target.markerRel, {
    packageName: target.packageName,
    version,
    copies: copiesKey,
  });

  return { id: target.id, action: 'copied', version, ms: Date.now() - t0 };
}

function main(): void {
  const root = process.cwd();
  const force = process.argv.includes('--force');
  const results = TARGETS.map((t) => syncOne(root, t, force));
  for (const r of results) {
    if (r.action === 'missing') {
      console.log(`[sync-public-static-libs] ${r.id}: package 없음 — skip`);
      continue;
    }
    console.log(
      `[sync-public-static-libs] ${r.id}@${r.version}: ${r.action} (${r.ms}ms)${force ? ' [force]' : ''}`
    );
  }
}

main();
