'use client';

import { AttributeQueryUI } from './AttributeQueryUI';

type StandardListProps = {
  activeTableName?: string;
  onOpenDataPanel?: (tableName: string) => void;
  onClearDataSelection?: () => void;
};

export default function StandardList({ activeTableName, onOpenDataPanel, onClearDataSelection }: StandardListProps) {
  return (
    <AttributeQueryUI
      activeTableName={activeTableName}
      onOpenDataPanel={onOpenDataPanel}
      onClearDataSelection={onClearDataSelection}
    />
  );
}
