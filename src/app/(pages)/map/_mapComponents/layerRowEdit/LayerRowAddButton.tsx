'use client';

import { Plus } from 'lucide-react';
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess';
import { LayerRowPanelButton } from './LayerRowPanelButton';

type Props = {
  onClick: () => void;
  disabled?: boolean;
  /** 지정 시 해당 서비스 쓰기 권한 기준. 없으면 SerWriteAccessProvider */
  serEng?: string;
};

export function LayerRowAddButton({ onClick, disabled, serEng }: Props) {
  const canWrite = useSerWriteAccess(serEng);
  if (!canWrite) return null;

  return (
    <LayerRowPanelButton onClick={onClick} disabled={disabled}>
      <Plus className="h-3 w-3 shrink-0" aria-hidden />
      추가
    </LayerRowPanelButton>
  );
}
