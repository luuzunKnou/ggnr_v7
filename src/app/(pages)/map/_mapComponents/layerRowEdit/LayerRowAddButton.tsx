'use client';

import { Plus } from 'lucide-react';
import { LayerRowPanelButton } from './LayerRowPanelButton';

type Props = {
  onClick: () => void;
  disabled?: boolean;
};

export function LayerRowAddButton({ onClick, disabled }: Props) {
  return (
    <LayerRowPanelButton onClick={onClick} disabled={disabled}>
      <Plus className="h-3 w-3 shrink-0" aria-hidden />
      추가
    </LayerRowPanelButton>
  );
}
