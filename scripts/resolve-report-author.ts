/**
 * 작업 보고서 작성자 표시명 resolve (stdout 한 줄)
 * 우선순위: Cursor 로그인 email + git name(동일 email) → git name → Cursor email → git email → 미확인
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function gitConfig(key: string): string {
  try {
    return execSync(`git config ${key}`, { encoding: 'utf-8', cwd: process.cwd() }).trim();
  } catch {
    return '';
  }
}

function readCursorEmail(): string {
  const filePath = path.join(process.cwd(), '.cursor', 'local', 'report-author.json');
  try {
    if (!fs.existsSync(filePath)) return '';
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { email?: string };
    return String(parsed.email ?? '').trim();
  } catch {
    return '';
  }
}

function main(): void {
  const cursorEmail = readCursorEmail();
  const gitName = gitConfig('user.name');
  const gitEmail = gitConfig('user.email');

  let author = '';

  if (cursorEmail && gitName && gitEmail && gitEmail.toLowerCase() === cursorEmail.toLowerCase()) {
    author = gitName;
  } else if (gitName) {
    author = gitName;
  } else if (cursorEmail) {
    author = cursorEmail;
  } else if (gitEmail) {
    author = gitEmail;
  } else {
    author = '미확인';
  }

  if (/^cursor\s*agent$/i.test(author)) {
    author = cursorEmail || gitEmail || '미확인';
  }

  process.stdout.write(author);
}

main();
