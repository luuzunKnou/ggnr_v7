import bcrypt from 'bcrypt';

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
