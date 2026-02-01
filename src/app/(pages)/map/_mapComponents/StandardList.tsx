// src/app/(pages)/map/_mapComponents/StandardList.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function StandardList({ tableName }: { tableName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleClose = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
    const filtered = opened.filter(w => w !== 'standardList');
    
    if (filtered.length > 0) {
      current.set('opened', filtered.join(','));
    } else {
      current.delete('opened');
    }
    
    router.push(`/map?${current.toString()}`);
  };

  return (
    <div className="w-[350px] h-[500px] bg-white/95 backdrop-blur-md shadow-2xl rounded-xl border border-slate-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 bg-slate-800 text-white flex justify-between items-center">
        <span className="font-bold">{tableName} 속성조회</span>
        <button onClick={handleClose} className="hover:text-red-400 transition-colors">✕</button>
      </div>
      <div className="p-4 overflow-y-auto flex-1">
        {/* 여기에 나중에 call('getStandardList') 데이터가 들어옵니다. */}
        <div className="animate-pulse flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-slate-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}