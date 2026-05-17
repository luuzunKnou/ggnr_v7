import path from "path";

/** 서버 전용: `roadDoc/file` 업로드 정적 파일 디렉터리 (업무메뉴얼) */
export function getRoadDocFileDir(): string {
  return path.join(
    process.cwd(),
    "src/app/(pages)/map/_mapContents/road/roadDoc/file"
  );
}

/** 서버 전용: 도면(CAD) 정적 파일 — `roadDoc/cad` */
export function getRoadCadFileDir(): string {
  return path.join(
    process.cwd(),
    "src/app/(pages)/map/_mapContents/road/roadDoc/cad"
  );
}

/**
 * `roadDoc/file` → 8단계 상위 = 저장소 루트 (cwd와 무관하게 동일 트리 전제).
 * QCAD_modules 등 루트 고정 폴더에 사용.
 */
export function getProjectRoot(): string {
  return path.resolve(
    getRoadDocFileDir(),
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    ".."
  );
}

/**
 * QCAD 배치(dwg2bmp.bat) 루트 후보 (dwg2bmp가 있는 디렉터리 = QCAD 설치 루트 또는 QCAD_modules).
 * - `GGNR_QCAD_HOME`: 수동 지정 (예: `C:\\Program Files\\QCAD`)
 * - 프로젝트 `QCAD_modules`
 * - Windows: `Program Files\\QCAD`, `Program Files\\QCAD Professional` 등 표준 설치 경로
 */
export function getQcadModulesDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (dir: string): void => {
    const key = path.resolve(dir);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(dir);
  };

  const env = process.env.GGNR_QCAD_HOME?.trim();
  if (env) push(env);

  push(path.join(process.cwd(), "QCAD_modules"));
  push(path.join(getProjectRoot(), "QCAD_modules"));

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pfx86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    push(path.join(pf, "QCAD"));
    push(path.join(pf, "QCAD Professional"));
    push(path.join(pfx86, "QCAD"));
  }

  return out;
}

/** 첫 번째 후보 (호환용) */
export function getQcadModulesDir(): string {
  return getQcadModulesDirs()[0] ?? path.join(process.cwd(), "QCAD_modules");
}

/**
 * `baseDir` 아래의 상대 경로만 허용 (`..`·절대 경로 차단). CAD 하위 폴더 파일용.
 */
export function resolveSafeRelativeUnderBase(baseDir: string, raw: string): string | null {
  const base = path.resolve(baseDir);
  let s = raw.trim().replace(/\\/g, "/");
  if (!s || s.startsWith("/")) return null;
  const parts = s.split("/").filter((p) => p.length > 0);
  for (const p of parts) {
    if (p === ".." || p === ".") return null;
  }
  const target = path.resolve(base, ...parts);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}
