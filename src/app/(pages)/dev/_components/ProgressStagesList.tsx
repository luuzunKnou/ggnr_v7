export type StageState = 'pending' | 'active' | 'done' | 'warn' | 'error';

export type StageItem = {
  id: string;
  label: string;
  state: StageState;
  detail?: string;
  /** 스캔 등: 제외 건수 문구 (있으면 detail과 분리 표시) */
  detailExclude?: string;
  /** 제외 쪽에만 붙는 호버(경로 목록). detailExclude 없을 때는 상세 전체에 사용하지 않음 */
  title?: string;
};

function stateLabel(state: StageState): string {
  if (state === 'done') return '완료';
  if (state === 'warn') return '경고';
  if (state === 'error') return '실패';
  if (state === 'active') return '진행';
  return '대기';
}

function stateClass(state: StageState): string {
  if (state === 'done') return 'text-green-700 dark:text-green-400';
  if (state === 'warn') return 'text-amber-700 dark:text-amber-400';
  if (state === 'error') return 'text-red-700 dark:text-red-400';
  if (state === 'active') return 'text-blue-700 dark:text-blue-400';
  return 'text-muted-foreground';
}

function StageDetail({
  detail,
  detailExclude,
  title,
  toneClass,
}: {
  detail?: string;
  detailExclude?: string;
  title?: string;
  toneClass?: string;
}) {
  const tone = toneClass ?? 'text-muted-foreground';
  const detailTitle =
    title ||
    [detail, detailExclude].filter((x) => x != null && String(x).trim() !== '').join(' · ') ||
    undefined;

  if (detailExclude != null && detailExclude !== '') {
    return (
      <span
        className={`ml-2 flex min-w-0 max-w-[55%] shrink items-center gap-1.5 ${tone}`}
        title={detailTitle}
      >
        <span className="min-w-0 truncate whitespace-nowrap">{detail ?? ''}</span>
        <span className={`min-w-0 truncate whitespace-nowrap ${title ? 'cursor-help' : ''}`}>
          {detailExclude}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`ml-2 min-w-0 max-w-[55%] shrink truncate whitespace-nowrap ${tone}`}
      title={detail?.trim() ? detail : undefined}
    >
      {detail ?? ''}
    </span>
  );
}

/** 단계 목록 — 행은 한 줄 말줄임, 목록은 세로 스크롤 */
export function ProgressStagesList({
  stages,
  className,
}: {
  stages: StageItem[];
  /** 기본 max-h-48. 부모에서 높이·스크롤을 제어할 때 덮어씀 */
  className?: string;
}) {
  if (stages.length === 0) return null;
  return (
    <div
      className={
        className ??
        'max-h-48 min-h-0 overflow-y-auto rounded border px-3 py-2 text-xs'
      }
    >
      {stages.map((s) => {
        const left = `${stateLabel(s.state)} · ${s.label}`;
        return (
          <div key={s.id} className="mb-1 flex min-w-0 items-center justify-between gap-2 last:mb-0">
            <span
              className={`min-w-0 shrink truncate whitespace-nowrap ${stateClass(s.state)}`}
              title={left}
            >
              {left}
            </span>
            <StageDetail
              detail={s.detail}
              detailExclude={s.detailExclude}
              title={s.title}
              toneClass={
                s.state === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : s.state === 'warn'
                    ? 'text-amber-700 dark:text-amber-400'
                    : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
