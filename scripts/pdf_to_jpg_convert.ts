/**
 * PDF → JPG 변환 CLI (Next.js 번들 밖에서 실행)
 * Usage: tsx scripts/pdf_to_jpg_convert.ts --job-name {작업명}
 *
 * 출력: PDFToJPG/{작업명}/JPG/{pdf파일명}/page-001.jpg
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./pdf_polyfill.cjs');

const PDF_ROOT_REL = 'PDFToJPG';
const PDF_INPUT_SUBDIR = 'PDF';
const JPG_OUTPUT_SUBDIR = 'JPG';
const RENDER_SCALE = 2;
const JPEG_QUALITY = 90;
const MIN_JPEG_BYTES = 512;
const MAX_CANVAS_PX = 8192;
const PDFJS_STANDARD_FONTS = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/');
const PDFJS_CMAPS = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/');

type PdfConvertFailure = { file: string; error: string };

function parseJobName(): string {
  const idx = process.argv.indexOf('--job-name');
  const value = idx >= 0 ? String(process.argv[idx + 1] ?? '').trim() : '';
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error('작업명이 올바르지 않습니다.');
  }
  return value;
}

function getBaseDir(): string {
  return path.normalize(process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir');
}

function pdfInputAbs(jobName: string): string {
  return path.join(getBaseDir(), PDF_ROOT_REL, jobName, PDF_INPUT_SUBDIR);
}

function pdfOutputAbs(jobName: string, pdfBaseName: string): string {
  return path.join(getBaseDir(), PDF_ROOT_REL, jobName, JPG_OUTPUT_SUBDIR, pdfBaseName);
}

async function listPdfFilesInDir(dirAbs: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function getPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function getCreateCanvas() {
  const mod = await import('@napi-rs/canvas');
  return mod.createCanvas;
}

function resolveRenderScale(page: { getViewport: (opts: { scale: number }) => { width: number; height: number } }): number {
  let scale = RENDER_SCALE;
  for (let i = 0; i < 8; i += 1) {
    const viewport = page.getViewport({ scale });
    const maxDim = Math.max(viewport.width, viewport.height);
    if (maxDim <= MAX_CANVAS_PX) return scale;
    scale *= MAX_CANVAS_PX / maxDim;
  }
  return scale;
}

async function validateOutputJpgs(outputDirAbs: string, expectedCount: number): Promise<void> {
  const entries = await fsPromises.readdir(outputDirAbs);
  const jpgs = entries.filter((name) => /\.jpe?g$/i.test(name));
  if (jpgs.length !== expectedCount) {
    throw new Error(`JPG ${jpgs.length}장 생성됨 (예상 ${expectedCount}장)`);
  }
  for (const name of jpgs) {
    const stat = await fsPromises.stat(path.join(outputDirAbs, name));
    if (stat.size < MIN_JPEG_BYTES) {
      throw new Error(`JPG 용량이 너무 작습니다: ${name} (${stat.size} bytes)`);
    }
  }
}

async function cleanupWorkDirs(parentDirAbs: string): Promise<void> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(parentDirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (/^\.__tmp__/u.test(entry.name) || /^\.__bak__/u.test(entry.name))
      )
      .map((entry) =>
        fsPromises.rm(path.join(parentDirAbs, entry.name), { recursive: true, force: true }).catch(() => {})
      )
  );
}

async function replaceDirAtomic(fromDir: string, toDir: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(toDir), { recursive: true });
  const backupDir = `${toDir}.__bak__`;
  await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  const hadTarget = fs.existsSync(toDir);
  if (hadTarget) {
    await fsPromises.rename(toDir, backupDir);
  }
  try {
    await fsPromises.rename(fromDir, toDir);
    await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    await fsPromises.rm(toDir, { recursive: true, force: true }).catch(() => {});
    if (hadTarget && fs.existsSync(backupDir)) {
      await fsPromises.rename(backupDir, toDir);
    }
    throw err;
  }
}

async function convertPdfFileToJpgs(params: {
  pdfAbsPath: string;
  outputDirAbs: string;
}): Promise<number> {
  const createCanvas = await getCreateCanvas();
  const pdfBytes = await fsPromises.readFile(params.pdfAbsPath);
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS,
    cMapUrl: PDFJS_CMAPS,
    cMapPacked: true,
    disableFontFace: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const expectedPages = pdf.numPages;
  if (expectedPages < 1) {
    await pdf.destroy().catch(() => {});
    throw new Error('PDF 페이지가 없습니다.');
  }

  const tempOutputDir = path.join(
    path.dirname(params.outputDirAbs),
    `.__tmp__${path.basename(params.outputDirAbs)}.${process.pid}`
  );
  await fsPromises.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
  await fsPromises.mkdir(tempOutputDir, { recursive: true });

  try {
    for (let pageNum = 1; pageNum <= expectedPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const scale = resolveRenderScale(page);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context를 생성하지 못했습니다.');
      }

      const renderTask = page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      });
      await renderTask.promise;

      const outName = `page-${String(pageNum).padStart(3, '0')}.jpg`;
      const outAbs = path.join(tempOutputDir, outName);
      const jpegBuffer = await canvas.encode('jpeg', JPEG_QUALITY);
      if (jpegBuffer.length < MIN_JPEG_BYTES) {
        throw new Error(`페이지 ${pageNum} JPG 생성 실패 (용량 ${jpegBuffer.length} bytes)`);
      }
      await fsPromises.writeFile(outAbs, jpegBuffer);
    }

    await validateOutputJpgs(tempOutputDir, expectedPages);
    await replaceDirAtomic(tempOutputDir, params.outputDirAbs);
    return expectedPages;
  } catch (err) {
    await fsPromises.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

async function main(): Promise<void> {
  const jobName = parseJobName();
  const pdfDir = pdfInputAbs(jobName);
  const jpgRootAbs = path.join(getBaseDir(), PDF_ROOT_REL, jobName, JPG_OUTPUT_SUBDIR);
  await fsPromises.mkdir(jpgRootAbs, { recursive: true });
  await cleanupWorkDirs(jpgRootAbs);

  const cleanupOnSignal = () => {
    void cleanupWorkDirs(jpgRootAbs);
  };
  process.once('SIGTERM', cleanupOnSignal);
  process.once('SIGINT', cleanupOnSignal);

  const pdfFiles = await listPdfFilesInDir(pdfDir);
  if (!pdfFiles.length) {
    throw new Error(`PDF 폴더가 비어 있습니다: ${PDF_ROOT_REL}/${jobName}/${PDF_INPUT_SUBDIR}`);
  }

  let convertedPdfCount = 0;
  let totalJpgCount = 0;
  const failures: PdfConvertFailure[] = [];

  for (let i = 0; i < pdfFiles.length; i += 1) {
    const pdfFile = pdfFiles[i]!;
    const base = path.parse(pdfFile).name;
    process.stderr.write(`[pdf_to_jpg] ${i + 1}/${pdfFiles.length} ${pdfFile}\n`);
    try {
      const pageCount = await convertPdfFileToJpgs({
        pdfAbsPath: path.join(pdfDir, pdfFile),
        outputDirAbs: pdfOutputAbs(jobName, base),
      });
      convertedPdfCount += 1;
      totalJpgCount += pageCount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ file: pdfFile, error: message });
      process.stderr.write(`[pdf_to_jpg] FAILED ${pdfFile}: ${message}\n`);
    }
  }

  if (convertedPdfCount === 0) {
    const detail = failures.map((f) => `${f.file}: ${f.error}`).join('\n');
    throw new Error(detail || '변환에 성공한 PDF가 없습니다.');
  }

  const result = {
    success: failures.length === 0,
    jobName,
    convertedPdfCount,
    failedPdfCount: failures.length,
    totalJpgCount,
    failures,
    message:
      failures.length === 0
        ? `PDF ${convertedPdfCount}개 -> JPG ${totalJpgCount}장 변환 완료 (${jobName})`
        : `PDF ${convertedPdfCount}/${pdfFiles.length}개 변환 완료, JPG ${totalJpgCount}장. 실패 ${failures.length}개: ${failures.map((f) => f.file).join(', ')}`,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await cleanupWorkDirs(jpgRootAbs);
  if (failures.length > 0) {
    process.exitCode = 2;
  }
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  try {
    const jobName = process.argv[process.argv.indexOf('--job-name') + 1];
    if (jobName) {
      const jpgRootAbs = path.join(getBaseDir(), PDF_ROOT_REL, jobName, JPG_OUTPUT_SUBDIR);
      await cleanupWorkDirs(jpgRootAbs);
    }
  } catch {
    // ignore cleanup errors on exit
  }
  process.exit(1);
});
