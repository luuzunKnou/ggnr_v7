export type StageState = 'pending' | 'active' | 'done' | 'error';

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
  if (state === 'error') return '실패';
  if (state === 'active') return '진행';
  return '대기';
}

function stateClass(state: StageState): string {
  if (state === 'done') return 'text-green-700 dark:text-green-400';
  if (state === 'error') return 'text-red-700 dark:text-red-400';
  if (state === 'active') return 'text-blue-700 dark:text-blue-400';
  return 'text-muted-foreground';
}

function StageDetail({
  detail,
  detailExclude,
  title,
  isError,
}: {
  detail?: string;
  detailExclude?: string;
  title?: string;
  isError?: boolean;
}) {
  const tone = isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
  if (detailExclude != null && detailExclude !== '') {
    return (
      <span className={`ml-3 flex max-w-[60%] items-center gap-1.5 truncate ${tone}`}>
        <span className="truncate">{detail ?? ''}</span>
        <span
          className={`truncate ${title ? 'cursor-help' : ''}`}
          title={title || undefined}
        >
          {detailExclude}
        </span>
      </span>
    );
  }
  return (
    <span className={`ml-3 max-w-[60%] truncate ${tone}`}>{detail ?? ''}</span>
  );
}

export function ProgressStagesList({ stages }: { stages: StageItem[] }) {
  if (stages.length === 0) return null;
  return (
    <div className="rounded border px-3 py-2 text-xs">
      {stages.map((s) => (
        <div key={s.id} className="mb-1 flex items-center justify-between last:mb-0">
          <span className={stateClass(s.state)}>
            {stateLabel(s.state)} · {s.label}
          </span>
          <StageDetail
            detail={s.detail}
            detailExclude={s.detailExclude}
            title={s.title}
            isError={s.state === 'error'}
          />
        </div>
      ))}
    </div>
  );
}
