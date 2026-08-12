import iconv from 'iconv-lite';

/**
 * Windows cmd(shell) 자식 프로세스 stdout/stderr 디코드.
 * cmd 한글 오류는 보통 CP949 — UTF-8로 읽으면 깨짐(치환 문자).
 */
export function decodeChildOutput(buf: Buffer, usedCmdShell = false): string {
  if (buf.length === 0) return '';
  if (usedCmdShell && process.platform === 'win32') {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return buf.toString('utf8');
    }
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return utf8;
    }
  }
  return utf8;
}
