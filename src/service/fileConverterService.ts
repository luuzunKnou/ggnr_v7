/**
 * File Converter Service
 * - 3dtiles_obj/{dataset} -> 3dtiles_b3dm/{dataset}
 * - OBJ source is interpreted in a projected CRS (e.g. EPSG:5187)
 * - mesh is re-centered to local ENU-like coordinates and placed via tileset transform
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import iconv from 'iconv-lite';
import proj4 from 'proj4';
import { appendUploadConvertHistory } from './fileManagerService';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const OBJ_TO_B3DM_TIMEOUT_MS = 30 * 60 * 1000;
const OBJ_CHUNK_TO_B3DM_TIMEOUT_MS = 60 * 60 * 1000;
const OBJ_CHUNK_SIZE = 128;
const OBJ_SOURCE_ROOT_REL = GGNR_DATA_PATHS.dtilesObj;
const OBJ_OUTPUT_ROOT_REL = GGNR_DATA_PATHS.dtilesB3dm;
const BLENDER_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'blender_obj_to_glb.py');
const LOCAL_BLENDER_DIR = path.join(process.cwd(), 'modules_blender');
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const SUPPORTED_SOURCE_CRS_CODES = [
  '4326',
  '5174',
  '5176',
  '5179',
  '5180',
  '5181',
  '5182',
  '5183',
  '5184',
  '5185',
  '5186',
  '5187',
  '5188',
] as const;
type SupportedSourceCrsCode = (typeof SUPPORTED_SOURCE_CRS_CODES)[number];
type SupportedSourceCrs = `EPSG:${SupportedSourceCrsCode}`;
type ObjSpatialStats = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
};

type GeneratedB3dmTile = {
  contentUri: string;
  radius: number;
  transform: number[];
  ecefCenter: [number, number, number];
};

type ObjChunkItem = {
  objRelativePath: string;
  stats: ObjSpatialStats;
  ecefCenter: [number, number, number];
};

const SUPPORTED_SOURCE_CRS_LABELS: Record<SupportedSourceCrs, string> = {
  'EPSG:4326': 'WGS84 위경도',
  'EPSG:5174': 'Bessel 중부원점 500k',
  'EPSG:5176': 'Bessel 동부원점 500k',
  'EPSG:5179': 'KGD2002 / Unified',
  'EPSG:5180': 'KGD2002 / West Belt',
  'EPSG:5181': 'KGD2002 / Central Belt',
  'EPSG:5182': 'KGD2002 / Jeju Belt',
  'EPSG:5183': 'KGD2002 / East Belt',
  'EPSG:5184': 'KGD2002 / Ulleung Belt',
  'EPSG:5185': 'KGD2002 / West Belt 2010',
  'EPSG:5186': 'KGD2002 / Central Belt 2010',
  'EPSG:5187': 'KGD2002 / East Belt 2010',
  'EPSG:5188': 'KGD2002 / Ulleung Belt 2010',
};

const PROJ4_DEFS: Record<SupportedSourceCrs, string> = {
  'EPSG:4326': '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees',
  'EPSG:5174': '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs',
  'EPSG:5176': '+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs',
  'EPSG:5179': '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:5180': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5181': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5182': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=550000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5183': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5184': '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5185': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5186': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5187': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5188': '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
};

let proj4DefsInitialized = false;

export type ObjB3dmDatasetRow = {
  datasetName: string;
  sourceRelativeDir: string;
  outputRelativeDir: string;
  objFileName: string | null;
  objFileCount: number;
  fileCount: number;
  hasTileset: boolean;
  hasB3dm: boolean;
  detectedSourceCrs: SupportedSourceCrs | null;
  detectedSourceCrsLabel: string | null;
  modified?: string;
};

function getBaseDir(): string {
  return path.normalize(GGNR_DATA_DIR);
}

function getSourceRootAbs(): string {
  return path.join(getBaseDir(), ...OBJ_SOURCE_ROOT_REL.split('/'));
}

function getOutputRootAbs(): string {
  return path.join(getBaseDir(), ...OBJ_OUTPUT_ROOT_REL.split('/'));
}

function assertSafeDatasetName(datasetName: string): string {
  const trimmed = String(datasetName ?? '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error('데이터셋 이름이 올바르지 않습니다.');
  }
  if (/[\\/]/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) {
    throw new Error('데이터셋 이름이 올바르지 않습니다.');
  }
  return trimmed;
}

function sourceDatasetRelative(datasetName: string): string {
  return `${OBJ_SOURCE_ROOT_REL}/${assertSafeDatasetName(datasetName)}`.replace(/\\/g, '/');
}

function outputDatasetRelative(datasetName: string): string {
  return `${OBJ_OUTPUT_ROOT_REL}/${assertSafeDatasetName(datasetName)}`.replace(/\\/g, '/');
}

function sourceDatasetAbs(datasetName: string): string {
  return path.join(getSourceRootAbs(), assertSafeDatasetName(datasetName));
}

function outputDatasetAbs(datasetName: string): string {
  return path.join(getOutputRootAbs(), assertSafeDatasetName(datasetName));
}

function outputChunkDatasetRelative(datasetName: string, chunkSize: number): string {
  return `${OBJ_OUTPUT_ROOT_REL}/${assertSafeDatasetName(datasetName)}_${chunkSize}`.replace(/\\/g, '/');
}

function outputChunkDatasetAbs(datasetName: string, chunkSize: number): string {
  return path.join(getOutputRootAbs(), `${assertSafeDatasetName(datasetName)}_${chunkSize}`);
}

function ensureProj4Definitions(): void {
  if (proj4DefsInitialized) return;
  for (const [code, def] of Object.entries(PROJ4_DEFS)) {
    proj4.defs(code, def);
  }
  proj4DefsInitialized = true;
}

function lonLatHeightToEcef(lonDeg: number, latDeg: number, heightM: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  const x = (n + heightM) * cl * Math.cos(lon);
  const y = (n + heightM) * cl * Math.sin(lon);
  const z = (n * (1 - WGS84_E2) + heightM) * sl;
  return [x, y, z];
}

function getEnuToEcefRotation(lonDeg: number, latDeg: number): number[] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  return [
    -sLon,
    cLon,
    0,
    -sLat * cLon,
    -sLat * sLon,
    cLat,
    cLat * cLon,
    cLat * sLon,
    sLat,
  ];
}

function buildEcefTransform(lonDeg: number, latDeg: number, heightM: number): number[] {
  const [ex, ey, ez] = lonLatHeightToEcef(lonDeg, latDeg, heightM);
  const rotation = getEnuToEcefRotation(lonDeg, latDeg);
  return [
    rotation[0], rotation[1], rotation[2], 0,
    rotation[3], rotation[4], rotation[5], 0,
    rotation[6], rotation[7], rotation[8], 0,
    ex, ey, ez, 1,
  ];
}

function buildRootBoundingSphere(children: GeneratedB3dmTile[]): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    const [x, y, z] = child.ecefCenter;
    const radius = Math.max(child.radius, 1);
    minX = Math.min(minX, x - radius);
    maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - radius);
    maxY = Math.max(maxY, y + radius);
    minZ = Math.min(minZ, z - radius);
    maxZ = Math.max(maxZ, z + radius);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  let radius = 1;
  for (const child of children) {
    const [x, y, z] = child.ecefCenter;
    const edgeDistance =
      Math.hypot(x - centerX, y - centerY, z - centerZ) + Math.max(child.radius, 1);
    if (edgeDistance > radius) radius = edgeDistance;
  }
  return [centerX, centerY, centerZ, Math.max(radius, 1)];
}

function normalizeSourceCrs(sourceCrs?: string | null): SupportedSourceCrs | null {
  const raw = String(sourceCrs ?? '').trim().toUpperCase();
  if (!raw) return null;
  const numeric = raw.replace(/^EPSG:/, '');
  if (!SUPPORTED_SOURCE_CRS_CODES.includes(numeric as SupportedSourceCrsCode)) return null;
  return `EPSG:${numeric}` as SupportedSourceCrs;
}

function detectSourceCrsFromDatasetName(datasetName: string): SupportedSourceCrs | null {
  const trimmed = String(datasetName ?? '').trim();
  const match = /(?:^|[_-])(\d{4,5})$/u.exec(trimmed);
  if (!match) return null;
  return normalizeSourceCrs(match[1]);
}

export function getSupportedObjSourceCrsOptions(): {
  options: { value: SupportedSourceCrs; label: string }[];
} {
  return {
    options: SUPPORTED_SOURCE_CRS_CODES.map((code) => {
      const value = `EPSG:${code}` as SupportedSourceCrs;
      return { value, label: `${value} - ${SUPPORTED_SOURCE_CRS_LABELS[value]}` };
    }),
  };
}

function decodeChildOutput(buf: Buffer, usedCmdShell: boolean): string {
  if (buf.length === 0) return '';
  if (usedCmdShell && process.platform === 'win32') {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return buf.toString('utf8');
    }
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return utf8;
    }
  }
  return utf8;
}

function pushChunk(chunks: Buffer[], data: Buffer | string | Uint8Array): void {
  chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  childEnv: NodeJS.ProcessEnv = process.env
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const exeLooksResolved =
      path.isAbsolute(cmd) || (isWin && /^[A-Za-z]:[\\/]/.test(cmd)) || cmd.includes(path.sep);
    const usedCmdShell = isWin && !exeLooksResolved;
    const child = usedCmdShell
      ? spawn('cmd.exe', ['/c', cmd, ...args], {
          cwd,
          windowsHide: true,
          shell: false,
          env: childEnv,
        })
      : spawn(cmd, args, {
          cwd,
          windowsHide: true,
          shell: false,
          env: childEnv,
        });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    if (child.stdout) child.stdout.on('data', (d) => pushChunk(stdoutChunks, d as Buffer));
    if (child.stderr) child.stderr.on('data', (d) => pushChunk(stderrChunks, d as Buffer));
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const stdout = decodeChildOutput(Buffer.concat(stdoutChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(stderrChunks), usedCmdShell);
      resolve({ code: -1, stdout, stderr: `${stderr}\n[타임아웃 ${timeoutMs}ms]`.trim() });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timeout);
      const stdout = decodeChildOutput(Buffer.concat(stdoutChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(stderrChunks), usedCmdShell);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function getBlenderBin(): string {
  const bundledExe = process.platform === 'win32'
    ? path.join(LOCAL_BLENDER_DIR, 'blender.exe')
    : path.join(LOCAL_BLENDER_DIR, 'blender');
  if (fs.existsSync(bundledExe)) {
    return bundledExe;
  }
  const raw = String(process.env.GGNR_BLENDER_BIN ?? 'blender').trim();
  if (!raw) return 'blender';
  if (raw === 'blender') return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function getLocalBlenderVersionDir(): string | null {
  try {
    const entries = fs.readdirSync(LOCAL_BLENDER_DIR, { withFileTypes: true });
    const versionDir = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
      .find((name) => /^\d+(?:\.\d+)*$/.test(name));
    return versionDir ? path.join(LOCAL_BLENDER_DIR, versionDir) : null;
  } catch {
    return null;
  }
}

function buildBlenderEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const versionDir = getLocalBlenderVersionDir();
  if (!versionDir) return env;
  const scriptsDir = path.join(versionDir, 'scripts');
  const datafilesDir = path.join(versionDir, 'datafiles');
  if (fs.existsSync(scriptsDir)) env.BLENDER_SYSTEM_SCRIPTS = scriptsDir;
  if (fs.existsSync(datafilesDir)) env.BLENDER_SYSTEM_DATAFILES = datafilesDir;
  return env;
}

function getBlenderMissingHint(): string {
  const bundledExe = process.platform === 'win32'
    ? path.join(LOCAL_BLENDER_DIR, 'blender.exe')
    : path.join(LOCAL_BLENDER_DIR, 'blender');
  if (fs.existsSync(LOCAL_BLENDER_DIR) && !fs.existsSync(bundledExe)) {
    return `modules_blender 는 있지만 실행 파일이 없습니다. ${bundledExe} 를 확인하세요.`;
  }
  return 'Blender 실행 파일을 찾을 수 없습니다. modules_blender/blender.exe 또는 GGNR_BLENDER_BIN 을 확인하세요.';
}

async function collectRelativeFilesRecursively(rootAbs: string, prefix = ''): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(rootAbs, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFilesRecursively(full, rel)));
    } else if (entry.isFile()) {
      files.push(rel.replace(/\\/g, '/'));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function listImmediateDatasetDirs(): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(getSourceRootAbs(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function padBuffer(buf: Buffer, alignment: number, fill = 0x20): Buffer {
  const padding = (alignment - (buf.length % alignment)) % alignment;
  if (padding === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(padding, fill)]);
}

function buildB3dmBuffer(glbBuffer: Buffer): Buffer {
  const featureTableJson = padBuffer(Buffer.from('{"BATCH_LENGTH":0}', 'utf8'), 8, 0x20);
  const featureTableBinary = Buffer.alloc(0);
  const batchTableJson = Buffer.alloc(0);
  const batchTableBinary = Buffer.alloc(0);
  const byteLength =
    28 +
    featureTableJson.length +
    featureTableBinary.length +
    batchTableJson.length +
    batchTableBinary.length +
    glbBuffer.length;
  const header = Buffer.alloc(28);
  header.write('b3dm', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(byteLength, 8);
  header.writeUInt32LE(featureTableJson.length, 12);
  header.writeUInt32LE(featureTableBinary.length, 16);
  header.writeUInt32LE(batchTableJson.length, 20);
  header.writeUInt32LE(batchTableBinary.length, 24);
  return Buffer.concat([
    header,
    featureTableJson,
    featureTableBinary,
    batchTableJson,
    batchTableBinary,
    glbBuffer,
  ]);
}

async function readObjSpatialStats(objAbsPath: string): Promise<ObjSpatialStats> {
  if (!fs.existsSync(objAbsPath)) {
    throw new Error('OBJ 파일을 찾을 수 없습니다.');
  }
  const stream = fs.createReadStream(objAbsPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const vertexPattern =
    /^\s*v\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let vertexCount = 0;
  try {
    for await (const line of rl) {
      const match = vertexPattern.exec(line);
      if (!match) continue;
      const x = Number(match[1]);
      const y = Number(match[2]);
      const z = Number(match[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      vertexCount += 1;
    }
  } finally {
    rl.close();
    stream.close();
  }
  if (vertexCount === 0) {
    throw new Error('OBJ 정점 정보를 읽지 못했습니다.');
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const dx = (maxX - minX) / 2;
  const dy = (maxY - minY) / 2;
  const dz = (maxZ - minZ) / 2;
  const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
  return { minX, maxX, minY, maxY, minZ, maxZ, centerX, centerY, centerZ, radius };
}

function buildTilesetJson(children: GeneratedB3dmTile[]): Record<string, unknown> {
  const [centerX, centerY, centerZ, radius] = buildRootBoundingSphere(children);
  return {
    asset: { version: '1.0', gltfUpAxis: 'Z' },
    geometricError: Math.max(radius * 2, 1),
    root: {
      boundingVolume: {
        sphere: [centerX, centerY, centerZ, Math.max(radius, 1)],
      },
      geometricError: Math.max(radius * 2, 1),
      refine: 'ADD',
      children: children.map((child) => ({
        boundingVolume: {
          sphere: [0, 0, 0, Math.max(child.radius, 1)],
        },
        geometricError: 0,
        transform: child.transform,
        content: { uri: child.contentUri },
      })),
    },
  };
}

function replaceExtension(filePath: string, nextExt: string): string {
  return filePath.replace(/\.[^.]+$/u, nextExt);
}

async function removeGeneratedOutputs(outputDir: string): Promise<void> {
  const files = await collectRelativeFilesRecursively(outputDir);
  const generated = files.filter((file) =>
    file === 'tileset.json' || /\.(?:b3dm|glb)$/i.test(file)
  );
  await Promise.all(
    generated.map((file) =>
      fsPromises.rm(path.join(outputDir, ...file.split('/')), { force: true }).catch(() => {})
    )
  );
}

async function clearOutputDir(outputDir: string): Promise<void> {
  await fsPromises.mkdir(outputDir, { recursive: true });
  const entries = await fsPromises.readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(outputDir, entry.name);
      await fsPromises.rm(target, { recursive: true, force: true });
    })
  );
}

function projectedCenterToLonLat(
  sourceCrs: SupportedSourceCrs,
  centerX: number,
  centerY: number
): [number, number] {
  if (sourceCrs === 'EPSG:4326') {
    return [centerX, centerY];
  }
  return proj4(sourceCrs, 'EPSG:4326', [centerX, centerY]) as [number, number];
}

async function buildObjChunkItems(
  sourceDir: string,
  objFiles: string[],
  sourceCrs: SupportedSourceCrs
): Promise<ObjChunkItem[]> {
  const items: ObjChunkItem[] = [];
  for (const objRelativePath of objFiles) {
    const sourceObjAbs = path.join(sourceDir, ...objRelativePath.split('/'));
    const stats = await readObjSpatialStats(sourceObjAbs);
    const [originLon, originLat] = projectedCenterToLonLat(sourceCrs, stats.centerX, stats.centerY);
    if (!Number.isFinite(originLon) || !Number.isFinite(originLat)) {
      throw new Error(`좌표계 변환에 실패했습니다: ${sourceCrs} (${objRelativePath})`);
    }
    items.push({
      objRelativePath,
      stats,
      ecefCenter: lonLatHeightToEcef(originLon, originLat, stats.centerZ),
    });
  }
  return items;
}

function sortObjChunkItems(items: ObjChunkItem[]): ObjChunkItem[] {
  return [...items].sort((a, b) => {
    const ax = a.ecefCenter[0];
    const ay = a.ecefCenter[1];
    const bx = b.ecefCenter[0];
    const by = b.ecefCenter[1];
    if (ax !== bx) return ax - bx;
    if (ay !== by) return ay - by;
    return a.objRelativePath.localeCompare(b.objRelativePath);
  });
}

function chunkObjItems(items: ObjChunkItem[], chunkSize: number): ObjChunkItem[][] {
  const chunks: ObjChunkItem[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function computeChunkProjectedCenter(chunk: ObjChunkItem[]): {
  centerX: number;
  centerY: number;
  centerZ: number;
} {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const item of chunk) {
    sx += item.stats.centerX;
    sy += item.stats.centerY;
    sz += item.stats.centerZ;
  }
  const n = chunk.length || 1;
  return { centerX: sx / n, centerY: sy / n, centerZ: sz / n };
}

function computeChunkRadius(
  chunk: ObjChunkItem[],
  chunkCenterX: number,
  chunkCenterY: number,
  chunkCenterZ: number
): number {
  let radius = 1;
  for (const item of chunk) {
    const dx = item.stats.centerX - chunkCenterX;
    const dy = item.stats.centerY - chunkCenterY;
    const dz = item.stats.centerZ - chunkCenterZ;
    const edgeDistance = Math.hypot(dx, dy, dz) + Math.max(item.stats.radius, 1);
    if (edgeDistance > radius) radius = edgeDistance;
  }
  return Math.max(radius, 1);
}

async function runBlenderChunkExport(params: {
  chunk: ObjChunkItem[];
  sourceDir: string;
  chunkCenterX: number;
  chunkCenterY: number;
  chunkCenterZ: number;
  outputGlbAbs: string;
}): Promise<void> {
  const manifestAbs = path.join(
    os.tmpdir(),
    'ggnr_obj_to_b3dm',
    `manifest_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );
  await fsPromises.mkdir(path.dirname(manifestAbs), { recursive: true });
  await fsPromises.mkdir(path.dirname(params.outputGlbAbs), { recursive: true });
  const manifest = {
    inputs: params.chunk.map((item) => ({
      path: path.join(params.sourceDir, ...item.objRelativePath.split('/')),
      shift_x: item.stats.centerX - params.chunkCenterX,
      shift_y: item.stats.centerY - params.chunkCenterY,
      shift_z: item.stats.centerZ - params.chunkCenterZ,
    })),
  };
  await fsPromises.writeFile(manifestAbs, JSON.stringify(manifest), 'utf8');
  const blenderArgs = [
    '--background',
    '--factory-startup',
    '--python',
    BLENDER_SCRIPT_PATH,
    '--',
    '--input-manifest',
    manifestAbs,
    '--output',
    params.outputGlbAbs,
  ];
  try {
    const blenderResult = await runProcess(
      getBlenderBin(),
      blenderArgs,
      process.cwd(),
      OBJ_CHUNK_TO_B3DM_TIMEOUT_MS,
      buildBlenderEnv()
    );
    if (blenderResult.code !== 0 || !fs.existsSync(params.outputGlbAbs)) {
      const message = [blenderResult.stderr.trim(), blenderResult.stdout.trim()]
        .filter(Boolean)
        .join('\n')
        .slice(0, 500);
      throw new Error(message || `Blender CLI 실행에 실패했습니다. ${getBlenderMissingHint()}`);
    }
  } finally {
    await fsPromises.rm(manifestAbs, { force: true }).catch(() => {});
  }
}

export async function listObjB3dmDatasets(params?: {
  limit?: number;
}): Promise<{ rows: ObjB3dmDatasetRow[]; sourceRoot: string; outputRoot: string }> {
  const datasetNames = await listImmediateDatasetDirs();
  const rows: ObjB3dmDatasetRow[] = [];
  for (const datasetName of datasetNames) {
    const sourceDir = sourceDatasetAbs(datasetName);
    const outputDir = outputDatasetAbs(datasetName);
    const sourceFiles = await collectRelativeFilesRecursively(sourceDir);
    const outputFiles = await collectRelativeFilesRecursively(outputDir);
    const objFiles = sourceFiles.filter((file) => /\.obj$/i.test(file));
    const b3dmFiles = outputFiles.filter((file) => /\.b3dm$/i.test(file));
    const detectedSourceCrs = detectSourceCrsFromDatasetName(datasetName);
    const stats = await Promise.all([
      fsPromises.stat(sourceDir).catch(() => null),
      fsPromises.stat(path.join(outputDir, 'tileset.json')).catch(() => null),
      fsPromises.stat(outputDir).catch(() => null),
    ]);
    const latest = stats
      .map((stat) => stat?.mtime?.getTime() ?? 0)
      .reduce((max, value) => (value > max ? value : max), 0);
    rows.push({
      datasetName,
      sourceRelativeDir: sourceDatasetRelative(datasetName),
      outputRelativeDir: outputDatasetRelative(datasetName),
      objFileName: objFiles[0] ?? null,
      objFileCount: objFiles.length,
      fileCount: sourceFiles.length,
      hasTileset: Boolean(stats[1]?.isFile()),
      hasB3dm: b3dmFiles.length > 0,
      detectedSourceCrs,
      detectedSourceCrsLabel: detectedSourceCrs ? SUPPORTED_SOURCE_CRS_LABELS[detectedSourceCrs] : null,
      modified: latest > 0 ? new Date(latest).toISOString() : undefined,
    });
  }
  return {
    rows: rows.slice(0, params?.limit ?? 100),
    sourceRoot: OBJ_SOURCE_ROOT_REL,
    outputRoot: OBJ_OUTPUT_ROOT_REL,
  };
}

export async function runObjToB3dmConversion(params: {
  datasetName: string;
  sourceCrs?: string | null;
  chunkSize?: number | null;
}): Promise<{
  success: boolean;
  message: string;
  sourceRelativeDir: string;
  outputRelativeDir: string;
  tilesetRelativePath: string;
  b3dmRelativePath: string;
  sourceCrs: SupportedSourceCrs;
}> {
  const chunkSize = params.chunkSize ?? null;
  if (chunkSize === OBJ_CHUNK_SIZE) {
    return runObjToB3dmChunkConversion(params);
  }
  if (chunkSize != null) {
    throw new Error(`chunkSize ${chunkSize}는 지원하지 않습니다.`);
  }

  const datasetName = assertSafeDatasetName(params.datasetName);
  const sourceCrs = normalizeSourceCrs(params.sourceCrs) ?? detectSourceCrsFromDatasetName(datasetName);
  if (!sourceCrs) {
    throw new Error('좌표계를 확인할 수 없습니다. 작업 시작 전에 좌표계를 선택하세요.');
  }
  ensureProj4Definitions();
  const sourceDir = sourceDatasetAbs(datasetName);
  const outputDir = outputDatasetAbs(datasetName);
  const sourceFiles = await collectRelativeFilesRecursively(sourceDir);
  const objFiles = sourceFiles.filter((file) => /\.obj$/i.test(file));
  if (!sourceFiles.length) {
    throw new Error(`소스 폴더가 비어 있습니다: ${sourceDatasetRelative(datasetName)}`);
  }
  if (objFiles.length === 0) {
    throw new Error(`OBJ 파일이 없습니다: ${sourceDatasetRelative(datasetName)}`);
  }
  const tilesetAbs = path.join(outputDir, 'tileset.json');
  await fsPromises.mkdir(outputDir, { recursive: true });
  await removeGeneratedOutputs(outputDir);

  let historyStatus: '완료' | '실패' = '완료';
  let historyNote = '';
  try {
    const childTiles: GeneratedB3dmTile[] = [];
    for (const objRelativePath of objFiles) {
      const sourceObjAbs = path.join(sourceDir, ...objRelativePath.split('/'));
      const stats = await readObjSpatialStats(sourceObjAbs);
      const [originLon, originLat] =
        sourceCrs === 'EPSG:4326'
          ? [stats.centerX, stats.centerY]
          : (proj4(sourceCrs, 'EPSG:4326', [stats.centerX, stats.centerY]) as [number, number]);
      if (!Number.isFinite(originLon) || !Number.isFinite(originLat)) {
        throw new Error(`좌표계 변환에 실패했습니다: ${sourceCrs} (${objRelativePath})`);
      }

      const outputB3dmRel = replaceExtension(objRelativePath, '.b3dm');
      const outputGlbAbs = path.join(
        os.tmpdir(),
        'ggnr_obj_to_b3dm',
        `${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(replaceExtension(objRelativePath, '.glb'))}`
      );
      const outputB3dmAbs = path.join(outputDir, ...outputB3dmRel.split('/'));
      await fsPromises.mkdir(path.dirname(outputGlbAbs), { recursive: true });
      await fsPromises.mkdir(path.dirname(outputB3dmAbs), { recursive: true });

      const blenderArgs = [
        '--background',
        '--factory-startup',
        '--python',
        BLENDER_SCRIPT_PATH,
        '--',
        '--input',
        sourceObjAbs,
        '--output',
        outputGlbAbs,
        '--shift-x',
        String(stats.centerX),
        '--shift-y',
        String(stats.centerY),
        '--shift-z',
        String(stats.centerZ),
      ];
      const blenderResult = await runProcess(
        getBlenderBin(),
        blenderArgs,
        process.cwd(),
        OBJ_TO_B3DM_TIMEOUT_MS,
        buildBlenderEnv()
      );
      if (blenderResult.code !== 0 || !fs.existsSync(outputGlbAbs)) {
        const message = [blenderResult.stderr.trim(), blenderResult.stdout.trim()]
          .filter(Boolean)
          .join('\n')
          .slice(0, 500);
        throw new Error(
          message || `Blender CLI 실행에 실패했습니다. ${getBlenderMissingHint()} (${objRelativePath})`
        );
      }

      try {
        const glbBuffer = await fsPromises.readFile(outputGlbAbs);
        const b3dmBuffer = buildB3dmBuffer(glbBuffer);
        await fsPromises.writeFile(outputB3dmAbs, b3dmBuffer);
      } finally {
        await fsPromises.rm(outputGlbAbs, { force: true }).catch(() => {});
      }

      const transform = buildEcefTransform(originLon, originLat, stats.centerZ);
      childTiles.push({
        contentUri: outputB3dmRel.replace(/\\/g, '/'),
        radius: stats.radius,
        transform,
        ecefCenter: lonLatHeightToEcef(originLon, originLat, stats.centerZ),
      });
    }

    const tilesetJson = buildTilesetJson(childTiles);
    await fsPromises.writeFile(tilesetAbs, JSON.stringify(tilesetJson, null, 2), 'utf8');

    historyNote = `dataset=${datasetName}, crs=${sourceCrs}, objs=${objFiles.length}`;
    return {
      success: true,
      message: `OBJ ${objFiles.length}개 -> B3DM ${objFiles.length}개 변환 완료 (${datasetName}, ${sourceCrs})`,
      sourceRelativeDir: sourceDatasetRelative(datasetName),
      outputRelativeDir: outputDatasetRelative(datasetName),
      tilesetRelativePath: `${outputDatasetRelative(datasetName)}/tileset.json`,
      b3dmRelativePath: `${outputDatasetRelative(datasetName)}/${replaceExtension(objFiles[0]!, '.b3dm')}`,
      sourceCrs,
    };
  } catch (err) {
    historyStatus = '실패';
    const rawMessage = err instanceof Error ? err.message : String(err);
    historyNote = rawMessage;
    if (/ENOENT|not found|찾을 수 없습니다/i.test(rawMessage)) {
      throw new Error(`${rawMessage}\n${getBlenderMissingHint()}`);
    }
    throw err;
  } finally {
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_b3dm',
      sourceFile: objFiles.length === 1 ? path.basename(objFiles[0]!) : `${objFiles.length} OBJ files`,
      pathOrResult: outputDatasetRelative(datasetName),
      status: historyStatus,
      note: historyNote.slice(0, 200),
    }).catch((appendErr) => {
      console.error('[fileConverterService] appendUploadConvertHistory failed:', appendErr);
    });
  }
}

async function runObjToB3dmChunkConversion(params: {
  datasetName: string;
  sourceCrs?: string | null;
}): Promise<{
  success: boolean;
  message: string;
  sourceRelativeDir: string;
  outputRelativeDir: string;
  tilesetRelativePath: string;
  b3dmRelativePath: string;
  sourceCrs: SupportedSourceCrs;
}> {
  const datasetName = assertSafeDatasetName(params.datasetName);
  const chunkSize = OBJ_CHUNK_SIZE;
  const outputDatasetName = `${datasetName}_${chunkSize}`;
  const sourceCrs = normalizeSourceCrs(params.sourceCrs) ?? detectSourceCrsFromDatasetName(datasetName);
  if (!sourceCrs) {
    throw new Error('좌표계를 확인할 수 없습니다. 작업 시작 전에 좌표계를 선택하세요.');
  }
  ensureProj4Definitions();
  const sourceDir = sourceDatasetAbs(datasetName);
  const outputDir = outputChunkDatasetAbs(datasetName, chunkSize);
  const sourceFiles = await collectRelativeFilesRecursively(sourceDir);
  const objFiles = sourceFiles.filter((file) => /\.obj$/i.test(file));
  if (!sourceFiles.length) {
    throw new Error(`소스 폴더가 비어 있습니다: ${sourceDatasetRelative(datasetName)}`);
  }
  if (objFiles.length === 0) {
    throw new Error(`OBJ 파일이 없습니다: ${sourceDatasetRelative(datasetName)}`);
  }

  const tilesetAbs = path.join(outputDir, 'tileset.json');
  await clearOutputDir(outputDir);

  let historyStatus: '완료' | '실패' = '완료';
  let historyNote = '';
  try {
    const sortedItems = sortObjChunkItems(await buildObjChunkItems(sourceDir, objFiles, sourceCrs));
    const chunks = chunkObjItems(sortedItems, chunkSize);
    const childTiles: GeneratedB3dmTile[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const { centerX, centerY, centerZ } = computeChunkProjectedCenter(chunk);
      const [originLon, originLat] = projectedCenterToLonLat(sourceCrs, centerX, centerY);
      if (!Number.isFinite(originLon) || !Number.isFinite(originLat)) {
        throw new Error(`좌표계 변환에 실패했습니다: ${sourceCrs} (chunk ${i})`);
      }

      const contentUri = `block_${String(i).padStart(4, '0')}.b3dm`;
      const outputGlbAbs = path.join(
        os.tmpdir(),
        'ggnr_obj_to_b3dm',
        `${Date.now()}_${Math.random().toString(36).slice(2)}_${contentUri.replace(/\.b3dm$/i, '.glb')}`
      );
      const outputB3dmAbs = path.join(outputDir, contentUri);

      await runBlenderChunkExport({
        chunk,
        sourceDir,
        chunkCenterX: centerX,
        chunkCenterY: centerY,
        chunkCenterZ: centerZ,
        outputGlbAbs,
      });

      try {
        const glbBuffer = await fsPromises.readFile(outputGlbAbs);
        const b3dmBuffer = buildB3dmBuffer(glbBuffer);
        await fsPromises.writeFile(outputB3dmAbs, b3dmBuffer);
      } finally {
        await fsPromises.rm(outputGlbAbs, { force: true }).catch(() => {});
      }

      const transform = buildEcefTransform(originLon, originLat, centerZ);
      childTiles.push({
        contentUri,
        radius: computeChunkRadius(chunk, centerX, centerY, centerZ),
        transform,
        ecefCenter: lonLatHeightToEcef(originLon, originLat, centerZ),
      });

      if ((i + 1) % 10 === 0 || i + 1 === chunks.length) {
        console.info(`[fileConverterService] ${outputDatasetName}: ${i + 1}/${chunks.length} blocks`);
      }
    }

    const tilesetJson = buildTilesetJson(childTiles);
    await fsPromises.writeFile(tilesetAbs, JSON.stringify(tilesetJson, null, 2), 'utf8');

    historyNote = `dataset=${outputDatasetName}, crs=${sourceCrs}, objs=${objFiles.length}, chunk=${chunkSize}`;
    return {
      success: true,
      message: `OBJ ${objFiles.length.toLocaleString()}개 -> B3DM ${childTiles.length.toLocaleString()}개 변환 완료 (${outputDatasetName}, ${sourceCrs})`,
      sourceRelativeDir: sourceDatasetRelative(datasetName),
      outputRelativeDir: outputChunkDatasetRelative(datasetName, chunkSize),
      tilesetRelativePath: `${outputChunkDatasetRelative(datasetName, chunkSize)}/tileset.json`,
      b3dmRelativePath: `${outputChunkDatasetRelative(datasetName, chunkSize)}/block_0000.b3dm`,
      sourceCrs,
    };
  } catch (err) {
    historyStatus = '실패';
    const rawMessage = err instanceof Error ? err.message : String(err);
    historyNote = rawMessage;
    if (/ENOENT|not found|찾을 수 없습니다/i.test(rawMessage)) {
      throw new Error(`${rawMessage}\n${getBlenderMissingHint()}`);
    }
    throw err;
  } finally {
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_b3dm',
      sourceFile: objFiles.length === 1 ? path.basename(objFiles[0]!) : `${objFiles.length} OBJ files`,
      pathOrResult: outputChunkDatasetRelative(datasetName, chunkSize),
      status: historyStatus,
      note: historyNote.slice(0, 200),
    }).catch((appendErr) => {
      console.error('[fileConverterService] appendUploadConvertHistory failed:', appendErr);
    });
  }
}
