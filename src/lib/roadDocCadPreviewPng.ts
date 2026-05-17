/**
 * 서버 전용: roadDoc CAD(dwg/dxf) → 미리보기용 `_${stem}.png` (투명 배경)
 * 저장소 루트의 `QCAD_modules` 아래 QCAD(dwg2bmp.bat) 필요.
 *
 * - `roadDoc/file` 경로의 `(pages)`·한글·괄호는 QCAD 인자에서 깨질 수 있어, 입력/출력은
 *   저장소 루트의 `.cad-preview-work`(ASCII)에서 처리한 뒤 최종 경로로 복사한다.
 * - `%TEMP%`에 한글 사용자명 등이 있으면 QCAD가 PNG를 쓰지 않고 exit 0만 나오는 경우가 있어
 *   OS 임시 폴더는 쓰지 않는다.
 */
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { copyFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getQcadModulesDirs } from "@/lib/roadDocServerPaths";

const RASTER_W = 2480;
const RASTER_H = 3508;
const SPAWN_MS = 240_000;
/** exit 0 직후 디스크 반영 지연 대비 */
const POST_EXIT_WAIT_MS = 45_000;
const POST_EXIT_POLL_MS = 250;

function cadPreviewWorkDir(): string {
  return path.join(process.cwd(), ".cad-preview-work");
}

/** `scripts/qcad-dwg-dxf2png.ps1` 과 같이 `dwg2bmp.bat` 존재만 본다 (qcadcmd·Pro 스크립트는 미검사). */
function resolveDwg2BmpBat(): string | null {
  for (const root of getQcadModulesDirs()) {
    for (const rel of ["dwg2bmp.bat", path.join("bin", "dwg2bmp.bat")]) {
      const batPath = path.join(root, rel);
      try {
        if (existsSync(batPath)) {
          console.log(`[roadDocCadPreviewPng] dwg2bmp: ${batPath}`);
          return batPath;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

async function waitForFile(filePath: string, maxMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return existsSync(filePath);
}

export type CadPreviewResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * @returns QCAD 없음/실패 시 ok:false + reason (업로드 자체는 유지)
 */
export async function tryGenerateCadPreviewPng(inputAbs: string, outputAbs: string): Promise<CadPreviewResult> {
  if (process.platform !== "win32") {
    const msg = "QCAD 미리보기는 Windows 서버에서만 지원됩니다.";
    console.warn(`[roadDocCadPreviewPng] ${msg}`);
    return { ok: false, reason: msg };
  }

  const bat = resolveDwg2BmpBat();
  if (!bat) {
    const tried = getQcadModulesDirs().join(" | ");
    const msg = `dwg2bmp.bat을 찾지 못했습니다. 시도한 루트: ${tried}. 환경변수 GGNR_QCAD_HOME 으로 QCAD 폴더를 지정할 수 있습니다.`;
    console.warn(`[roadDocCadPreviewPng] ${msg}`);
    return { ok: false, reason: msg };
  }

  const qcadWorkDir = path.dirname(bat);
  const batLeaf = path.basename(bat);
  const id = randomUUID();
  const workDir = cadPreviewWorkDir();
  const ext = path.extname(inputAbs) || ".dwg";
  const tmpIn = path.join(workDir, `in-${id}${ext}`);
  const tmpOut = path.join(workDir, `out-${id}.png`);

  try {
    await mkdir(workDir, { recursive: true });
    await copyFile(inputAbs, tmpIn);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[roadDocCadPreviewPng] work copy in: ${msg}`);
    return { ok: false, reason: `CAD 원본을 작업 폴더로 복사하지 못했습니다: ${msg}` };
  }

  /**
   * `scripts/qcad-dwg-dxf2png.ps1` 과 동일: `cmd.exe /c "<한 줄>"` 만 사용한다.
   * 경로를 항상 `"..."` 로 감싸면 Dwg2Bmp.js 가 `QCAD_modules` cwd 와 잘못 이어붙여
   * `.../QCAD_modules/"D:\...\.dwg"` 처럼 깨진 import 경로가 된다. 공백 등이 있을 때만 따옴표.
   * 백슬래시는 cmd/QCAD 호환을 위해 `/` 로 통일.
   */
  const toCmdPath = (abs: string) => abs.replace(/\\/g, "/");
  const quoteIfNeeded = (abs: string) => {
    const p = toCmdPath(abs);
    return /[\s]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
  };
  const outArg = quoteIfNeeded(tmpOut);
  const inArg = quoteIfNeeded(tmpIn);
  const inner = [
    `${batLeaf} -f -b transparent -color-correction -zoom-all`,
    `-x ${RASTER_W} -y ${RASTER_H}`,
    `-outfile=${outArg}`,
    inArg,
  ].join(" ");

  const { code, stderr, stdout } = await new Promise<{ code: number; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const p = spawn(process.env.ComSpec || "cmd.exe", ["/c", inner], {
        cwd: qcadWorkDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const errChunks: Buffer[] = [];
      const outChunks: Buffer[] = [];
      p.stderr?.on("data", (d: Buffer) => errChunks.push(d));
      p.stdout?.on("data", (d: Buffer) => outChunks.push(d));
      const timer = setTimeout(() => {
        try {
          p.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, SPAWN_MS);
      p.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      p.on("close", (c) => {
        clearTimeout(timer);
        const errText = Buffer.concat(errChunks).toString("utf8").trim();
        const outText = Buffer.concat(outChunks).toString("utf8").trim();
        resolve({ code: c ?? 1, stderr: errText, stdout: outText });
      });
    }
  ).catch((e: unknown) => {
    console.error("[roadDocCadPreviewPng] spawn", e);
    return { code: -1, stderr: e instanceof Error ? e.message : String(e), stdout: "" };
  });

  const cleanupTemp = async (): Promise<void> => {
    await Promise.all(
      [tmpIn, tmpOut].map(async (p) => {
        try {
          if (existsSync(p)) await unlink(p);
        } catch {
          /* ignore */
        }
      })
    );
  };

  if (code !== 0) {
    const tail = stderr.slice(-2000);
    const outTail = stdout.slice(-2000);
    console.error(
      `[roadDocCadPreviewPng] exit ${code} stderr:\n${tail || "(empty)"}\nstdout:\n${outTail || "(empty)"}`
    );
    await cleanupTemp();
    return {
      ok: false,
      reason: `dwg2bmp 실패 (exit ${code})${tail ? `: ${tail.slice(0, 400)}` : ""}`,
    };
  }

  try {
    const appeared = await waitForFile(tmpOut, POST_EXIT_WAIT_MS, POST_EXIT_POLL_MS);
    if (!appeared) {
      const outTail = stdout.slice(-1500);
      const errTail = stderr.slice(-1500);
      console.error(
        `[roadDocCadPreviewPng] PNG missing after exit 0 (waited ${POST_EXIT_WAIT_MS}ms). stdout:\n${outTail || "(empty)"}\nstderr:\n${errTail || "(empty)"}`
      );
      await cleanupTemp();
      return {
        ok: false,
        reason: `PNG가 작업 폴더에 생성되지 않았습니다. QCAD(체험판) 제한·DWG 형식을 확인하거나 서버 로그 전체를 확인하세요.${errTail ? ` …${errTail.slice(-300)}` : ""}`,
      };
    }
    await mkdir(path.dirname(outputAbs), { recursive: true });
    await copyFile(tmpOut, outputAbs);
    await cleanupTemp();
    if (existsSync(outputAbs)) {
      return { ok: true };
    }
    return { ok: false, reason: `PNG 복사 후에도 파일이 없습니다: ${outputAbs}` };
  } catch (e) {
    await cleanupTemp();
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `PNG 저장 실패: ${msg}` };
  }
}
