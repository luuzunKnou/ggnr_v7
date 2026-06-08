/**
 * 폴더 내 파일명 일괄 변경: xxx_yyy_zzz_a9990013.shp → a9990013.shp
 * (마지막 _ 뒤 부분 + 확장자만 남김)
 */
const fs = require('fs').promises;
const path = require('path');

const dir = process.argv[2] || 'C:\\Users\\user\\Downloads\\파일명 변경_도로대장';

async function main() {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let count = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    const ext = path.extname(name);
    const baseWithoutExt = name.slice(0, -ext.length || undefined);
    const lastUnderscore = baseWithoutExt.lastIndexOf('_');
    if (lastUnderscore === -1) continue;
    const partAfterLastUnderscore = baseWithoutExt.slice(lastUnderscore + 1);
    const newName = partAfterLastUnderscore + ext;
    if (newName === name) continue;
    const oldPath = path.join(dir, name);
    const newPath = path.join(dir, newName);
    await fs.rename(oldPath, newPath);
    console.log(name, '->', newName);
    count++;
  }
  console.log('총', count, '개 파일 이름 변경됨.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
