'use client';

import type { UploadProgressSnapshot } from './aerialUploadProgressStore';

type Props = {
  jobs: UploadProgressSnapshot[];
  title?: string;
};

function statusTitle(job: UploadProgressSnapshot, fallback: string): string {
  if (job.status === 'done') return '업로드 완료';
  if (job.status === 'failed') return '업로드 실패';
  return fallback;
}

export function UploadProgressBanner({ jobs, title = '업로드 진행 중' }: Props) {
  if (jobs.length === 0) return null;

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className={
            job.status === 'failed'
              ? 'rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-950'
              : job.status === 'done'
                ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-950'
                : 'rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[10px] text-sky-950'
          }
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className={
                job.status === 'failed'
                  ? 'font-semibold text-rose-900'
                  : job.status === 'done'
                    ? 'font-semibold text-emerald-900'
                    : 'font-semibold text-sky-900'
              }
            >
              {statusTitle(job, title)}
            </p>
            <span
              className={
                job.status === 'failed'
                  ? 'tabular-nums font-medium text-rose-800'
                  : job.status === 'done'
                    ? 'tabular-nums font-medium text-emerald-800'
                    : 'tabular-nums font-medium text-sky-800'
              }
            >
              {job.percent}%
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] font-medium text-slate-800">{job.workName}</p>
          <p className="mt-0.5 text-slate-600">
            파일 {job.fileIndex}/{job.fileTotal}
            {job.currentFileName ? ` · ${job.currentFileName}` : ''}
            {job.chunkTotal > 0
              ? ` · 청크 ${job.chunkIndex}/${job.chunkTotal}`
              : ''}
          </p>
          <div
            className={
              job.status === 'failed'
                ? 'mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-100'
                : job.status === 'done'
                  ? 'mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-100'
                  : 'mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100'
            }
          >
            <div
              className={
                job.status === 'failed'
                  ? 'h-full rounded-full bg-rose-500 transition-[width] duration-150'
                  : job.status === 'done'
                    ? 'h-full rounded-full bg-emerald-500 transition-[width] duration-150'
                    : 'h-full rounded-full bg-sky-500 transition-[width] duration-150'
              }
              style={{ width: `${job.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
