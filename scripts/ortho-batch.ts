/**
 * 정사영상(GeoTIFF 그룹) → XYZ JPEG 일괄 변환 CLI.
 * Next(dev) 서버와 별도 프로세스에서 실행 — 서버 재시작·소스 수정과 무관.
 *
 * 사용:
 *   npx tsx scripts/ortho-batch.ts build_yy dev
 *   npx tsx scripts/ortho-batch.ts build_yy dev --dry-run
 *   npx tsx scripts/ortho-batch.ts build_yy dev --group=satellite_2011_5187
 *   npx tsx scripts/ortho-batch.ts build_yy dev --force
 *   npx tsx scripts/ortho-batch.ts build_yy dev --continue-on-error
 *   npm run ortho:batch -- build_yy dev
 *
 * 기본: 미변환 그룹만, 좌표계 있는 그룹만, 한 그룹 완료 후 다음.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';

const LOG = '[ortho-batch]';

type CliArgs = {
  project: string;
  type: string;
  groups: string[];
  tileSetId: string;
  jpegQuality: number;
  zoomMin: number;
  zoomMax: number;
  force: boolean;
  dryRun: boolean;
  continueOnError: boolean;
};

function usage(): never {
  console.log(`
Usage: npx tsx scripts/ortho-batch.ts <project> <type> [options]

  project   build_yy 등
  type      dev | demo | prod

Options:
  --group=NAME          특정 그룹만 (여러 번 지정 가능)
  --tile-set=ID         UI 타일셋 id (기본 aerial-2017)
  --jpeg-quality=N      1~100 (기본 80)
  --zoom-min=N          기본 6
  --zoom-max=N          기본 19
  --force               이미 tiles_jpg 가 있어도 다시 변환
  --dry-run             대상 목록만 출력
  --continue-on-error   실패해도 다음 그룹 계속
`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const groups: string[] = [];
  let tileSetId = 'aerial-2017';
  let jpegQuality = 80;
  let zoomMin = 6;
  let zoomMax = 19;
  let force = false;
  let dryRun = false;
  let continueOnError = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') usage();
    if (a === '--force') {
      force = true;
      continue;
    }
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--continue-on-error') {
      continueOnError = true;
      continue;
    }
    if (a.startsWith('--group=')) {
      const v = a.slice('--group='.length).trim();
      if (v) groups.push(v);
      continue;
    }
    if (a === '--group') {
      const v = (argv[++i] ?? '').trim();
      if (v) groups.push(v);
      continue;
    }
    if (a.startsWith('--tile-set=')) {
      tileSetId = a.slice('--tile-set='.length).trim() || tileSetId;
      continue;
    }
    if (a === '--tile-set') {
      tileSetId = (argv[++i] ?? '').trim() || tileSetId;
      continue;
    }
    if (a.startsWith('--jpeg-quality=')) {
      jpegQuality = Number(a.slice('--jpeg-quality='.length));
      continue;
    }
    if (a === '--jpeg-quality') {
      jpegQuality = Number(argv[++i] ?? jpegQuality);
      continue;
    }
    if (a.startsWith('--zoom-min=')) {
      zoomMin = Number(a.slice('--zoom-min='.length));
      continue;
    }
    if (a === '--zoom-min') {
      zoomMin = Number(argv[++i] ?? zoomMin);
      continue;
    }
    if (a.startsWith('--zoom-max=')) {
      zoomMax = Number(a.slice('--zoom-max='.length));
      continue;
    }
    if (a === '--zoom-max') {
      zoomMax = Number(argv[++i] ?? zoomMax);
      continue;
    }
    if (a.startsWith('-')) {
      console.error(`${LOG} unknown option: ${a}`);
      usage();
    }
    positional.push(a);
  }

  if (!positional[0] || !positional[1]) usage();

  return {
    project: positional[0]!,
    type: positional[1]!,
    groups,
    tileSetId,
    jpegQuality: Number.isFinite(jpegQuality) ? Math.floor(jpegQuality) : 80,
    zoomMin: Number.isFinite(zoomMin) ? Math.floor(zoomMin) : 6,
    zoomMax: Number.isFinite(zoomMax) ? Math.floor(zoomMax) : 19,
    force,
    dryRun,
    continueOnError,
  };
}

function loadRuntimeEnv(projectName: string): void {
  const dir = path.join(process.cwd(), 'src', 'config', 'projects');
  const apply = (filePath: string) => {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) (process.env as Record<string, string>)[key] = value;
    }
  };
  apply(path.join(dir, 'common.runtime.env'));
  apply(path.join(dir, `${projectName}.runtime.env`));
}

function formatEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return '약 1분 미만';
  const mins = Math.round(sec / 60);
  if (mins < 60) return `약 ${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `약 ${h}시간 ${m}분` : `약 ${h}시간`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  loadProjectEnv(args.project, args.type);
  loadRuntimeEnv(args.project);
  process.env.GGNR_PROJECT = args.project;
  process.env.GGNR_ENV = args.type;

  const dataDir = (process.env.GGNR_DATA_DIR ?? '').trim();
  console.log(
    `${LOG} project=${args.project} type=${args.type} dataDir=${dataDir || '(default)'} tileSet=${args.tileSetId} z=${args.zoomMin}-${args.zoomMax} q=${args.jpegQuality}`
  );

  // env 로드 후 서비스 import (DB 풀이 env를 읽음)
  const ortho = await import('../src/service/orthophotoService');

  const { groups } = await ortho.listSatelliteTifGroupedUploads();
  const outputs = await ortho.listOrthophotoTileOutputs();

  const hasOutput = (groupName: string) =>
    outputs.groups.some((g) => g.groupName === groupName && g.tileSetIds.length > 0) ||
    outputs.legacyTileSetIds.includes(groupName);

  let candidates = groups;
  if (args.groups.length) {
    const want = new Set(args.groups);
    candidates = groups.filter((g) => want.has(g.groupName));
    const missing = args.groups.filter((n) => !groups.some((g) => g.groupName === n));
    if (missing.length) {
      console.warn(`${LOG} 업로드 목록에 없음: ${missing.join(', ')}`);
    }
  }

  const queue: { groupName: string; sourceCrs: string; fileCount: number; skipReason?: string }[] = [];
  for (const g of candidates) {
    const converted = hasOutput(g.groupName);
    if (converted && !args.force) {
      queue.push({
        groupName: g.groupName,
        sourceCrs: g.sourceCrs ?? '',
        fileCount: g.files.length,
        skipReason: '이미 tiles_jpg 존재 (--force 로 재변환)',
      });
      continue;
    }
    const crs = (g.sourceCrs ?? '').trim();
    if (!/^EPSG:\d{4,5}$/i.test(crs)) {
      queue.push({
        groupName: g.groupName,
        sourceCrs: crs || '-',
        fileCount: g.files.length,
        skipReason: '원본 좌표계 없음 (정사영상관리에서 CRS 저장 후 재실행)',
      });
      continue;
    }
    queue.push({ groupName: g.groupName, sourceCrs: crs.toUpperCase(), fileCount: g.files.length });
  }

  const toRun = queue.filter((q) => !q.skipReason);
  const skipped = queue.filter((q) => q.skipReason);

  console.log(`${LOG} 대상 ${toRun.length}개 / 스킵 ${skipped.length}개 / 업로드 그룹 ${groups.length}개`);
  for (const s of skipped) {
    console.log(`${LOG}   skip ${s.groupName} — ${s.skipReason}`);
  }
  for (const r of toRun) {
    console.log(`${LOG}   run  ${r.groupName}  ${r.sourceCrs}  tif=${r.fileCount}`);
  }

  if (args.dryRun) {
    console.log(`${LOG} dry-run 종료`);
    return;
  }
  if (!toRun.length) {
    console.log(`${LOG} 변환할 그룹이 없습니다.`);
    return;
  }

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < toRun.length; i++) {
    const item = toRun[i]!;
    console.log(`\n${LOG} ========== [${i + 1}/${toRun.length}] ${item.groupName} 시작 ==========`);

    let lastLine = '';
    const poll = setInterval(() => {
      const raw = ortho.getOrthoJobProgress({ groupName: item.groupName });
      const p = raw && !Array.isArray(raw) ? raw : null;
      if (!p) return;
      const eta = formatEta(p.etaSeconds);
      const line = `${LOG}   ${p.phase} ${p.percent}% · ${p.message}${eta ? ` · ${eta}` : ''}`;
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
    }, 10_000);

    let result: Awaited<ReturnType<typeof ortho.runSatelliteTifGroupToXyzAndWait>>;
    try {
      result = await ortho.runSatelliteTifGroupToXyzAndWait({
        groupName: item.groupName,
        tileSetId: args.tileSetId,
        sourceCrs: item.sourceCrs,
        zoomMin: args.zoomMin,
        zoomMax: args.zoomMax,
        jpegQuality: args.jpegQuality,
      });
    } catch (e) {
      clearInterval(poll);
      const msg = e instanceof Error ? e.message : String(e);
      failCount += 1;
      console.error(`${LOG} FAIL ${item.groupName}: ${msg}`);
      if (!args.continueOnError) {
        console.error(`${LOG} 중단 (--continue-on-error 로 계속 가능)`);
        process.exitCode = 1;
        return;
      }
      continue;
    } finally {
      clearInterval(poll);
    }

    if (result.ok) {
      okCount += 1;
      console.log(`${LOG} OK ${item.groupName} · ${result.message}`);
    } else {
      failCount += 1;
      console.error(`${LOG} FAIL ${item.groupName} phase=${result.phase} · ${result.message}`);
      if (!args.continueOnError) {
        console.error(`${LOG} 중단 (--continue-on-error 로 계속 가능)`);
        process.exitCode = 1;
        return;
      }
    }

    // 다음 그룹 전 짧은 간격 (디스크/로그 flush)
    if (i + 1 < toRun.length) await sleep(2000);
  }

  console.log(`\n${LOG} 완료: 성공 ${okCount} · 실패 ${failCount} · 스킵 ${skipped.length}`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`${LOG} fatal`, e);
  process.exit(1);
});
