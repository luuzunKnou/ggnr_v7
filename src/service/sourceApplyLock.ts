/** 최신소스·ZIP 적용 동시 실행 방지 (단일 Node 프로세스) */
let applyInFlight = false;
let applyOwner: string | null = null;

export function isSourceApplyInFlight(): boolean {
  return applyInFlight;
}

export function getSourceApplyOwner(): string | null {
  return applyOwner;
}

/** @returns false 이미 다른 적용 진행 중 */
export function tryAcquireSourceApplyLock(owner: string): boolean {
  const key = owner.trim();
  if (!key) return false;
  if (applyInFlight) return false;
  applyInFlight = true;
  applyOwner = key;
  console.log(`[SourceCodeUpload] apply lock acquired: ${key}`);
  return true;
}

export function releaseSourceApplyLock(owner?: string): void {
  if (!applyInFlight) return;
  if (owner?.trim() && applyOwner !== owner.trim()) return;
  console.log(`[SourceCodeUpload] apply lock released: ${applyOwner ?? '-'}`);
  applyInFlight = false;
  applyOwner = null;
}
