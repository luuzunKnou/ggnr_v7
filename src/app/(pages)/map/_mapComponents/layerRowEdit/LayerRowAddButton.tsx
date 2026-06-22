"use client";

import { LayerRowPanelButton } from "./LayerRowPanelButton";

type Props = {
  onClick: () => void;
  disabled?: boolean;
};

export function LayerRowAddButton({ onClick, disabled }: Props) {
  return (
    <LayerRowPanelButton onClick={onClick} disabled={disabled}>
      추가
    </LayerRowPanelButton>
  );
}
