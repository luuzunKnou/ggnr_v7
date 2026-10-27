/**
 * DXF 본문 디코딩 — 국내 수치지형도는 ANSI_949(CP949)인 경우가 많다.
 * `file.text()`(UTF-8)만 쓰면 한글 TEXT/MTEXT가 깨진다.
 */

function sniffCodePage(headerAscii: string): string | null {
  const m =
    /\$DWGCODEPAGE[\r\n]+3[\r\n]+([^\r\n]+)/i.exec(headerAscii) ??
    /\$CODEPAGE[\r\n]+3[\r\n]+([^\r\n]+)/i.exec(headerAscii);
  return m?.[1]?.trim() ?? null;
}

function isKoreanCodePage(cp: string | null): boolean {
  if (!cp) return false;
  return /949|KOREA|ANSI_949|ks_c_5601|dos949|cp949/i.test(cp);
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++;
  return n;
}

/** ArrayBuffer → DXF 문자열 (코드페이지 반영) */
export function decodeDxfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const headLen = Math.min(bytes.length, 128 * 1024);
  const headAscii = new TextDecoder('latin1').decode(bytes.subarray(0, headLen));
  const cp = sniffCodePage(headAscii);
  const korean = isKoreanCodePage(cp);

  if (korean) {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      /* fall through */
    }
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = countReplacement(utf8);
  // UTF-8로 읽었는데 대량 치환·깨짐이면 CP949 재시도 (코드페이지 누락 DXF)
  if (bad > 8 || (bad > 0 && /TEXT|MTEXT/i.test(headAscii))) {
    try {
      const kr = new TextDecoder('euc-kr').decode(bytes);
      if (countReplacement(kr) < bad) return kr;
    } catch {
      /* keep utf8 */
    }
  }
  return utf8;
}

export async function readDxfFileAsText(file: File): Promise<string> {
  return decodeDxfBytes(await file.arrayBuffer());
}
