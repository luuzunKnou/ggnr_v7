/**
 * 사진·동영상·항공뷰 등록은 한 번에 하나만.
 * 화면 업로드와 폴더 확인이 같은 파일을 동시에 넣지 않게 한다.
 */
let held = 0;

export function isAerialWorkBusy(): boolean {
  return held > 0;
}

/** 이미 작업 중이면 false. 호출한 쪽에서 endAerialWork 로 반드시 푼다. */
export function tryBeginAerialWork(): boolean {
  if (held > 0) return false;
  held += 1;
  return true;
}

export function endAerialWork(): void {
  held = Math.max(0, held - 1);
}

/** 화면 업로드는 폴더 확인이 파일 하나를 끝낼 때까지 기다린 뒤 시작한다. */
export async function waitAerialWorkTurn(): Promise<void> {
  while (!tryBeginAerialWork()) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
