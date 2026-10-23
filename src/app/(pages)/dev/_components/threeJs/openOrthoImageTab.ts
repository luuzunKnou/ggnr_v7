/**
 * 3면도 PNG를 새 탭에서 크게 보기.
 * - `window.open(..., 'noopener')` 는 탭이 열려도 반환값이 null 이라 오탐 alert가 난다.
 * - async fetch 전에 about:blank 를 동기 open 해야 팝업 차단을 피한다.
 */
export async function openOrthoImageInNewTab(dataUrl: string, title: string): Promise<void> {
  if (!dataUrl.trim()) return;

  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    window.alert('새 탭을 열 수 없습니다. 팝업 차단을 해제해 주세요.');
    return;
  }

  try {
    tab.document.title = title;
    tab.document.body.style.cssText =
      'margin:0;background:#1a1a1e;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:sans-serif;color:#94a3b8';
    tab.document.body.textContent = '불러오는 중…';
  } catch {
    /* about:blank 접근 실패 시 location 만 교체 */
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const objectUrl = URL.createObjectURL(blob);
    tab.location.replace(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
  } catch {
    try {
      const doc = tab.document;
      doc.title = title;
      doc.body.style.cssText =
        'margin:0;background:#1a1a1e;display:flex;min-height:100vh;align-items:center;justify-content:center';
      doc.body.replaceChildren();
      const img = doc.createElement('img');
      img.src = dataUrl;
      img.alt = title;
      img.style.cssText = 'max-width:100%;max-height:100vh;object-fit:contain';
      doc.body.appendChild(img);
    } catch {
      try {
        tab.close();
      } catch {
        /* ignore */
      }
      window.alert('이미지를 표시할 수 없습니다.');
    }
  }
}
