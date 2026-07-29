'use client';

import type { UploadProgressSnapshot } from './aerialUploadProgressStore';

type Props = {
  jobs: UploadProgressSnapshot[];
  title?: string;
};

export function UploadProgressBanner({ jobs, title = '업로드 진행 중' }: Props) {
  if (jobs.length === 0) return null;

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[10px] text-sky-950"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-sky-900">{title}</p>
            <span className="tabular-nums font-medium text-sky-800">{job.percent}%</span>
          </div>
          <p className="mt-1 truncate text-[11px] font-medium text-slate-800">{job.workName}</p>
          <p className="mt-0.5 text-slate-600">
            파일 {job.fileIndex}/{job.fileTotal} · {job.currentFileName} · 청크 {job.chunkIndex}/
            {job.chunkTotal}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-150"
              style={{ width: `${job.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
