import { forwardRef } from 'react';

/**
 * 지도 DOM 렌더링 컴포넌트
 * 순수하게 지도가 렌더링될 div만 담당
 */
export const MapView = forwardRef<HTMLDivElement>(
  (props, ref) => {
    return <div ref={ref} className="w-full h-full" {...props} />;
  }
);

MapView.displayName = 'MapView';
