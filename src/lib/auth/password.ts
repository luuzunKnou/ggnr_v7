import bcrypt from 'bcrypt';
import { tempPasswordCandidates } from '@/lib/auth/hangulQwerty';

const SALT_ROUNDS = 10;

export async function verifyPassword(stored: string | null, plain: string): Promise<boolean> {
  if (!stored || !plain) return false;
  if (stored.startsWith('$2')) {
    try {
      return await bcrypt.compare(plain, stored);
    } catch {
      return false;
    }
  }
  return stored === plain;
}

/** 평문이었으면 true — 로그인 후 재해시 권장 */
export function isPlaintextPassword(stored: string | null): boolean {
  return !!stored && !stored.startsWith('$2');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** 저장된 값이 성명 또는 영문 자판 임시 비밀번호이면 true */
export async function isTemporaryPassword(stored: string | null, usrId: string): Promise<boolean> {
  for (const candidate of tempPasswordCandidates(usrId)) {
    if (await verifyPassword(stored, candidate)) return true;
  }
  return false;
}

export function isForbiddenNewPassword(nextPwd: string, usrId: string): boolean {
  return tempPasswordCandidates(usrId).includes(nextPwd);
}
