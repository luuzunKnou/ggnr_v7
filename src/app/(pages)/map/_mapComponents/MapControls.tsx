'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function MapControls() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedWindows = searchParams.get('opened')?.split(',').filter(Boolean) || [];

  const toggleWindow = (windowName: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = openedWindows.includes(windowName)
      ? openedWindows.filter(w => w !== windowName)
      : [...openedWindows, windowName];
    
    if (opened.length > 0) {
      current.set('opened', opened.join(','));
    } else {
      current.delete('opened');
    }
    
    router.push(`/map?${current.toString()}`);
  };

  return (
    <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
      <button
        onClick={() => toggleWindow('standardList')}
        className={`px-4 py-2 rounded-lg shadow-lg backdrop-blur-md transition-all ${
          openedWindows.includes('standardList')
            ? 'bg-blue-600 text-white'
            : 'bg-white/90 text-gray-800 hover:bg-white'
        }`}
      >
        표준목록
      </button>
      <button
        onClick={() => toggleWindow('landInfo')}
        className={`px-4 py-2 rounded-lg shadow-lg backdrop-blur-md transition-all ${
          openedWindows.includes('landInfo')
            ? 'bg-blue-600 text-white'
            : 'bg-white/90 text-gray-800 hover:bg-white'
        }`}
      >
        필지정보
      </button>
    </div>
  );
}
