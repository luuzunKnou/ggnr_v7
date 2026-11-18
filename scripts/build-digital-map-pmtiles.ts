/**
 * 수치지형도 PMTiles 생성 — 프로젝트명만 입력하면 축척별(폴더별) 파일을 만든다.
 *
 * 사용: npm run digital-map:pmtiles -- <프로젝트> [dev|demo|prod] [옵션]
 * 예)  npm run digital-map:pmtiles -- ggnr_ad
 *      npm run digital-map:pmtiles -- ggnr_ad dev --folder="수치지형도(25000)"
 *
 * 입력: GGNR_DATA_DIR/digital_map/수치지형도(1000)/*.dxf, (5000), (25000) …  (DXF 가 들어 있는 하위 폴더 전부)
 * 출력: GGNR_DATA_DIR/digital_map/수치지형도(1000).pmtiles, (5000).pmtiles, (25000).pmtiles
 *       → 운영에는 이 .pmtiles 파일만 올리면 서비스된다 (DXF·DB·색인 불필요).
 *
 * 옵션
 *   --folder=이름   해당 폴더만 (여러 번 지정 가능)
 *   --crs=5187      좌표계 직접 지정 (기본: 읍면동 경계와 겹침으로 자동 감지 — DB 접속 필요)
 *   --limit=N       도엽 앞 N장만 (시험용, --out-dir 와 함께 쓸 것)
 *   --out-dir=경로  출력 폴더 변경 (기본: digital_map)
 *   --work=경로     임시 작업 폴더 상위 (기본: OS 임시 폴더. 수 GB 필요)
 *
 * GDAL 3.8+ ogr2ogr(PMTiles 쓰기)가 필요하다 — QGIS 가 설치돼 있으면 자동으로 찾는다.
 * 같은 폴더를 다시 실행하면 새로 만들어 교체한다 (실패 시 기존 파일 유지).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';

function optValue(args: string[], key: string): string | undefined {
  return args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3).trim();
}

async function main() {
  const argv = process.argv.slice(2);
  const project = argv.find((a) => !a.startsWith('--'));
  if (!project) {
    console.error('사용: npm run digital-map:pmtiles -- <프로젝트> [dev|demo|prod] [--folder=이름] [--crs=5187]');
    process.exit(1);
  }
  const positional = argv.filter((a) => !a.startsWith('--'));
  const section = positional[1] && /^(dev|demo|prod)$/.test(positional[1]) ? positional[1] : 'dev';
  loadProjectEnv(project, section);

  const folderArgs = argv.filter((a) => a.startsWith('--folder=')).map((a) => a.slice(9).trim());
  const crs = optValue(argv, 'crs');
  const limit = Number(optValue(argv, 'limit') ?? 0);
  const outDirArg = optValue(argv, 'out-dir');
  const workBase = optValue(argv, 'work');

  const { digitalMapRootDir } = await import('../src/lib/digitalMapPmtiles');
  const { buildDigitalMapPmtiles } = await import('../src/lib/digitalMapPmtilesBuild');

  const root = digitalMapRootDir();
  if (!fs.existsSync(root)) throw new Error(`수치지형도 폴더가 없습니다: ${root}`);
  const outDir = outDirArg ? path.resolve(outDirArg) : root;

  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !folderArgs.length || folderArgs.includes(n))
    .filter((n) => fs.readdirSync(path.join(root, n)).some((f) => /\.dxf$/i.test(f)))
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  if (!folders.length) {
    throw new Error(`DXF 가 들어 있는 하위 폴더가 없습니다: ${root}`);
  }

  console.log(`프로젝트=${project}(${section}) 입력=${root}\n출력=${outDir}\n대상: ${folders.join(', ')}\n`);
  const summary: string[] = [];
  for (const folder of folders) {
    const dir = path.join(root, folder);
    let names = fs.readdirSync(dir).filter((n) => /\.dxf$/i.test(n)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    if (limit > 0) names = names.slice(0, limit);
    const outFile = path.join(outDir, `${folder}.pmtiles`);
    console.log(`=== ${folder} (도엽 ${names.length}장) → ${outFile}`);
    const res = await buildDigitalMapPmtiles({
      folder,
      dxfFiles: names.map((n) => path.join(dir, n)),
      crs: crs || undefined,
      outFile,
      workBase: workBase ? path.resolve(workBase) : undefined,
      log: (m) => console.log(m),
    });
    const line =
      `${folder}: 도엽 ${res.sheets}장, 객체 ${res.features.toLocaleString()}개, ` +
      `${(res.bytes / 1048576).toFixed(1)}MB, 최대줌 ${res.maxZoom}, EPSG:${res.crs}, ${Math.round(res.ms / 1000)}초`;
    console.log(`${line}\n`);
    summary.push(line);
  }
  console.log('=== 완료 ===');
  for (const s of summary) console.log(s);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
