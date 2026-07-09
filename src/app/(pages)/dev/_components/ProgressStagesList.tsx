export type StageState = 'pending' | 'active' | 'done' | 'error';

export type StageItem = {
  id: string;
  label: string;
  state: StageState;
  detail?: string;
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

export function ProgressStagesList({ stages }: { stages: StageItem[] }) {
  if (stages.length === 0) return null;
  return (
    <div className="rounded border px-3 py-2 text-xs">
      {stages.map((s) => (
        <div key={s.id} className="mb-1 flex items-center justify-between last:mb-0">
          <span className={stateClass(s.state)}>
            {stateLabel(s.state)} · {s.label}
          </span>
          <span
            className={`ml-3 max-w-[60%] truncate ${s.state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
            title={s.detail}
          >
            {s.detail ?? ''}
          </span>
        </div>
      ))}
    </div>
  );
}
