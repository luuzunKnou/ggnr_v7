import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import iconv from 'iconv-lite';
import type { FmsLinkageConfig } from '@/lib/fmsLinkage/config';

const execFileAsync = promisify(execFile);
const LOG = '[fms-client]';

function projectRoot(): string {
  return process.cwd();
}

function javaFileName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function javaBinExists(dir: string): string | null {
  const candidate = path.join(dir, 'bin', javaFileName());
  return fs.existsSync(candidate) ? candidate : null;
}

const JAVA_NOT_FOUND =
  'Java를 찾을 수 없습니다. geoserver_modules/java 에 JDK를 두세요.';

function isSpawnEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT');
}

/** GeoServer start-geoserver.bat 과 동일: geoserver_modules/java/<첫 JDK>/bin/java */
function resolveJavaBin(): string | null {
  const javaDir = path.join(projectRoot(), 'geoserver_modules', 'java');
  if (!fs.existsSync(javaDir)) return null;
  for (const ent of fs.readdirSync(javaDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const fromDir = javaBinExists(path.join(javaDir, ent.name));
    if (fromDir) return fromDir;
  }
  return null;
}

function resolveKistecJar(config: FmsLinkageConfig): string | null {
  if (config.kistecJarPath && fs.existsSync(config.kistecJarPath)) {
    return config.kistecJarPath;
  }
  const candidates = [
    path.join(projectRoot(), 'lib', 'fms', 'kistec_v2.1.jar'),
    path.join(projectRoot(), '..', 'ggnr', 'src', 'main', 'resources', 'libs', 'kistec_v2.1.jar'),
  ];
  for (const p of candidates) {
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function bridgeClassDir(): string {
  return path.join(projectRoot(), 'scripts', 'fms');
}

function classPathFor(jarPath: string): string {
  const bridge = bridgeClassDir();
  return process.platform === 'win32' ? `${jarPath};${bridge}` : `${jarPath}:${bridge}`;
}

export type FmsResponseLine = {
  code: string;
  fmsKey: string;
  message: string;
  raw: string;
};

function decodeJavaStdout(buf: Buffer | string): string {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const asUtf8 = bytes.toString('utf8');
  if (!asUtf8.includes('\uFFFD')) return asUtf8;
  return iconv.decode(bytes, 'ms949');
}

export function parseFmsResponseLine(raw: string): FmsResponseLine {
  const line = String(raw ?? '').trim();
  if (!line) {
    return { code: 'E999', fmsKey: '', message: '빈 응답', raw: line };
  }
  const parts = line.split('|', 3);
  return {
    code: (parts[0] ?? 'E999').trim(),
    fmsKey: (parts[1] ?? '').trim(),
    message: (parts[2] ?? '').trim(),
    raw: line,
  };
}

/** kistec jar + FmsLinkBridge — 1차 POST 응답 첫 줄 */
export async function receiveFmsFirstLine(
  config: FmsLinkageConfig,
  identifier: string
): Promise<string> {
  const jarPath = resolveKistecJar(config);
  if (!jarPath) {
    throw new Error(
      'kistec_v2.1.jar 를 찾을 수 없습니다. lib/fms/kistec_v2.1.jar 또는 FMS_KISTEC_JAR 설정.'
    );
  }
  const bridgeClass = path.join(bridgeClassDir(), 'FmsLinkBridge.class');
  if (!fs.existsSync(bridgeClass)) {
    throw new Error(
      'FmsLinkBridge.class 가 없습니다. scripts/fms 에 javac -cp kistec_v2.1.jar FmsLinkBridge.java 실행.'
    );
  }

  const id = String(identifier ?? '').trim();
  if (!id) throw new Error('identifier 가 필요합니다.');

  const javaBin = resolveJavaBin();
  if (!javaBin) throw new Error(JAVA_NOT_FOUND);

  let stdout: Buffer | string;
  let stderr: Buffer | string;
  try {
    ({ stdout, stderr } = await execFileAsync(
      javaBin,
      [
        '-Dfile.encoding=UTF-8',
        '-cp',
        classPathFor(jarPath),
        'FmsLinkBridge',
        config.orgCode,
        config.userId,
        config.password,
        config.certiKey,
        id,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer' }
    ));
  } catch (err) {
    if (isSpawnEnoent(err)) throw new Error(JAVA_NOT_FOUND);
    throw err;
  }

  const out = decodeJavaStdout(stdout).trim();
  if (!out) {
    const err = decodeJavaStdout(stderr).trim();
    throw new Error(err || 'FMS 1차 POST 응답 없음');
  }
  console.info(`${LOG} identifier=${id} response=${out.slice(0, 120)}`);
  return out;
}

export function getResolvedKistecJarPath(config: FmsLinkageConfig): string | null {
  return resolveKistecJar(config);
}
