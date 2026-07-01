/**
 * sessionStart hook: Cursor 로그인 user_email을 로컬 캐시에 저장 (보고서 작성자용)
 * stdin: Cursor hook JSON (user_email 포함)
 */
import fs from 'node:fs';
import path from 'node:path';

async function main(): Promise<void> {
  const raw = fs.readFileSync(0, 'utf-8');
  let payload: { user_email?: string | null } = {};
  try {
    payload = JSON.parse(raw) as { user_email?: string | null };
  } catch {
    process.exit(0);
  }

  const email = String(payload.user_email ?? '').trim();
  if (!email) {
    process.exit(0);
  }

  const dir = path.join(process.cwd(), '.cursor', 'local');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'report-author.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ email, cachedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

main().catch(() => process.exit(0));
