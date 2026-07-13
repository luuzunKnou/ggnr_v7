/**
 * GeoServer 프로세스 기동·중지 (Windows bat)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GeoServer 실행 (백그라운드로 시작)
 */
export async function startGeoServer() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer start is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'start-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };
    let settled = false;

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      child.removeAllListeners();
      resolve(ok ? { success: true } : { success: false, error: err });
    };

    child.on('close', (code) => {
      if (code !== 0) {
        const errText = chunks.err.join('').trim() || chunks.out.join('').trim();
        finish(false, errText || `스크립트 종료 코드: ${code}`);
      } else {
        finish(true);
      }
    });

    child.on('error', (e) => finish(false, e.message));
    child.unref();

    // 스크립트가 빠르게 끝나지 않으면 성공으로 간주 (java 프로세스 시작됨)
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        finish(true);
      }
    }, 3000);
  });
}

/**
 * GeoServer 종료
 */
export async function stopGeoServer() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer stop is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'stop-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string; output?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const getOutput = () => [chunks.out.join(''), chunks.err.join('')].filter(Boolean).join('\n').trim();

    child.on('close', (code) => {
      const output = getOutput();
      resolve(code === 0 ? { success: true, output } : { success: false, error: output || `종료 코드: ${code}`, output });
    });

    child.on('error', (e) => resolve({ success: false, error: e.message }));
  });
}
