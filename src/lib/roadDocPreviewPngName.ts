/**
 * CAD 상대 경로 → 같은 폴더에 두는 미리보기 PNG 상대 경로.
 * - `foo.dwg` → `_foo.png`
 * - `01.표준횡단면도/도면.dwg` → `01.표준횡단면도/_도면.png` (하위 폴더 유지)
 */
export function roadDocPreviewPngFileName(cadFileName: string): string {
  const norm = cadFileName.replace(/\\/g, "/").replace(/^\//, "");
  const lastSlash = norm.lastIndexOf("/");
  const dir = lastSlash >= 0 ? norm.slice(0, lastSlash) : "";
  const base = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;
  const i = base.lastIndexOf(".");
  const stem = i > 0 ? base.slice(0, i) : base;
  const leaf = `_${stem}.png`;
  return dir ? `${dir}/${leaf}` : leaf;
}
